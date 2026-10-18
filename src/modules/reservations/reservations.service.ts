import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { halls, movies, reservationSeats, reservations, seats, showtimes } from "../../db/schema.ts";
import { NotFoundError } from "../../lib/errors.ts";
import { type Pagination, paginate } from "../../lib/schemas.ts";
import type { AuthUser } from "../auth/tokens.ts";

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
