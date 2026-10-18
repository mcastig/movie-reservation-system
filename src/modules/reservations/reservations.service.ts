import { and, asc, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { halls, movies, reservationSeats, reservations, seats, showtimes } from "../../db/schema.ts";
import {
  ConflictError,
  isPgError,
  NotFoundError,
  PG_UNIQUE_VIOLATION,
  ValidationError,
} from "../../lib/errors.ts";
import { type Pagination, paginate } from "../../lib/schemas.ts";
import type { AuthUser } from "../auth/tokens.ts";
import type { CreateReservationInput } from "./reservations.schemas.ts";

// --- Reading ---

// Loads reservations matching `where`, each with its showtime, movie, hall and seats.
// Two queries in total (reservations, then all their seats), like genresByMovie.
async function findReservations(where: SQL | undefined, page?: Pagination) {
  const query = db
    .select({
      id: reservations.id,
      userId: reservations.userId,
      status: reservations.status,
      totalCents: reservations.totalCents,
      createdAt: reservations.createdAt,
      cancelledAt: reservations.cancelledAt,
      showtime: { id: showtimes.id, startsAt: showtimes.startsAt, endsAt: showtimes.endsAt },
      movie: { id: movies.id, title: movies.title },
      hall: { id: halls.id, name: halls.name },
    })
    .from(reservations)
    .innerJoin(showtimes, eq(showtimes.id, reservations.showtimeId))
    .innerJoin(movies, eq(movies.id, showtimes.movieId))
    .innerJoin(halls, eq(halls.id, showtimes.hallId))
    .where(where)
    // Latest showtime first; id breaks ties so pages are stable.
    .orderBy(desc(showtimes.startsAt), desc(reservations.id))
    .$dynamic();
  const rows = page ? await query.limit(page.limit).offset((page.page - 1) * page.limit) : await query;

  const ids = rows.map((r) => r.id);
  const seatRows = ids.length
    ? await db
        .select({
          reservationId: reservationSeats.reservationId,
          id: seats.id,
          row: seats.rowLabel,
          number: seats.seatNumber,
          priceCents: reservationSeats.priceCents,
        })
        .from(reservationSeats)
        .innerJoin(seats, eq(seats.id, reservationSeats.seatId))
        .where(inArray(reservationSeats.reservationId, ids))
        .orderBy(asc(seats.rowLabel), asc(seats.seatNumber))
    : [];

  return rows.map(({ showtime, movie, hall, ...reservation }) => ({
    ...reservation,
    showtime: { ...showtime, movie, hall },
    seats: seatRows
      .filter((s) => s.reservationId === reservation.id)
      .map(({ reservationId: _, ...seat }) => seat),
  }));
}

// Someone else's reservation is a 404, not a 403: a 403 would confirm that
// reservation 42 exists. Admins can see every reservation.
function visibleTo(user: AuthUser) {
  return user.role === "admin" ? undefined : eq(reservations.userId, user.id);
}

export async function getReservation(user: AuthUser, id: number) {
  const [reservation] = await findReservations(and(eq(reservations.id, id), visibleTo(user)));
  if (!reservation) throw new NotFoundError(`Reservation ${id} not found`);
  return reservation;
}

export async function listMyReservations(user: AuthUser, page: Pagination) {
  const mine = eq(reservations.userId, user.id);
  const [data, total] = await Promise.all([findReservations(mine, page), db.$count(reservations, mine)]);
  return paginate(data, page, total);
}

// --- Booking ---

export async function createReservation(user: AuthUser, { showtimeId, seatIds }: CreateReservationInput) {
  let reservationId: number;
  try {
    // One transaction: if any step fails, nothing is saved (atomicity).
    reservationId = await db.transaction(async (tx) => {
      // 1. The showtime exists and hasn't started. FOR SHARE lets many bookings
      //    for this showtime run at once, but makes an admin's change to its price
      //    or time (Phase 4, FOR UPDATE) wait until we commit, so the price we
      //    charge is the price at the moment we book.
      const [showtime] = await tx
        .select({ hallId: showtimes.hallId, startsAt: showtimes.startsAt, priceCents: showtimes.priceCents })
        .from(showtimes)
        .where(eq(showtimes.id, showtimeId))
        .for("share");
      if (!showtime) {
        throw new ValidationError([{ path: "body.showtimeId", message: `Unknown showtime id: ${showtimeId}` }]);
      }
      if (showtime.startsAt.getTime() <= Date.now()) {
        throw new ConflictError("SHOWTIME_STARTED", "This showtime has already started");
      }

      // 2. Every seat is in this showtime's hall. The composite FK would reject a
      //    wrong one too, but this says which.
      const found = await tx
        .select({ id: seats.id })
        .from(seats)
        .where(and(eq(seats.hallId, showtime.hallId), inArray(seats.id, seatIds)));
      const foundIds = new Set(found.map((s) => s.id));
      const wrong = seatIds.filter((id) => !foundIds.has(id));
      if (wrong.length > 0) {
        throw new ValidationError([
          { path: "body.seatIds", message: `Seat id(s) not in this showtime's hall: ${wrong.join(", ")}` },
        ]);
      }

      // 3. Insert. There is deliberately NO "are these seats free?" query first:
      //    two requests could both see "free" and both insert. The partial unique
      //    index (one active booking per seat per showtime) decides instead.
      //    4. The total comes from the database's price, never from the client.
      const [reservation] = await tx
        .insert(reservations)
        .values({ userId: user.id, showtimeId, totalCents: showtime.priceCents * seatIds.length })
        .returning({ id: reservations.id });
      await tx.insert(reservationSeats).values(
        seatIds.map((seatId) => ({
          reservationId: reservation!.id,
          showtimeId,
          hallId: showtime.hallId,
          seatId,
          priceCents: showtime.priceCents,
        })),
      );
      return reservation!.id;
    });
  } catch (err) {
    // The index fired: the whole transaction, reservation row included, was rolled back.
    if (isPgError(err, PG_UNIQUE_VIOLATION)) {
      const taken = await takenSeatLabels(showtimeId, seatIds);
      throw new ConflictError(
        "SEATS_TAKEN",
        taken.length > 0 ? `Seat(s) already taken: ${taken.join(", ")}` : "Seat(s) already taken",
      );
    }
    throw err;
  }
  return getReservation(user, reservationId);
}

// Only for the error message, after the fact. It isn't part of the guarantee.
async function takenSeatLabels(showtimeId: number, seatIds: number[]) {
  const rows = await db
    .select({ label: sql<string>`${seats.rowLabel} || ${seats.seatNumber}` })
    .from(reservationSeats)
    .innerJoin(seats, eq(seats.id, reservationSeats.seatId))
    .where(
      and(
        eq(reservationSeats.showtimeId, showtimeId),
        eq(reservationSeats.active, true),
        inArray(reservationSeats.seatId, seatIds),
      ),
    )
    .orderBy(asc(seats.rowLabel), asc(seats.seatNumber));
  return rows.map((r) => r.label);
}
