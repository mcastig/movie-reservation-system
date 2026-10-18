import { and, asc, eq, gt, gte, lt, sql } from "drizzle-orm";
import { env } from "../../config/env.ts";
import { db } from "../../db/client.ts";
import { halls, movies, reservationSeats, reservations, seats, showtimes } from "../../db/schema.ts";
import {
  ConflictError,
  isPgError,
  NotFoundError,
  PG_EXCLUSION_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
  PG_INVALID_PARAMETER_VALUE,
  ValidationError,
} from "../../lib/errors.ts";
import { genresByMovie } from "../movies/movies.service.ts";
import { computeEndsAt } from "./schedule.ts";
import type { CreateShowtimeInput, ScheduleQuery, UpdateShowtimeInput } from "./showtimes.schemas.ts";

type Executor = Pick<typeof db, "select">;

export async function getShowtime(id: number) {
  const [row] = await db
    .select({
      id: showtimes.id,
      startsAt: showtimes.startsAt,
      endsAt: showtimes.endsAt,
      priceCents: showtimes.priceCents,
      movie: { id: movies.id, title: movies.title, durationMinutes: movies.durationMinutes },
      hall: { id: halls.id, name: halls.name },
    })
    .from(showtimes)
    .innerJoin(movies, eq(movies.id, showtimes.movieId))
    .innerJoin(halls, eq(halls.id, showtimes.hallId))
    .where(eq(showtimes.id, id));
  if (!row) throw new NotFoundError(`Showtime ${id} not found`);
  return row;
}

function assertInFuture(startsAt: Date) {
  if (startsAt.getTime() <= Date.now()) {
    throw new ValidationError([{ path: "body.startsAt", message: "Must be in the future" }]);
  }
}

// Returns the movie's duration, which ends_at is computed from.
async function movieDuration(executor: Executor, movieId: number) {
  const [movie] = await executor
    .select({ durationMinutes: movies.durationMinutes })
    .from(movies)
    .where(eq(movies.id, movieId));
  if (!movie) throw new ValidationError([{ path: "body.movieId", message: `Unknown movie id: ${movieId}` }]);
  return movie.durationMinutes;
}

async function assertHallExists(executor: Executor, hallId: number) {
  const [hall] = await executor.select({ id: halls.id }).from(halls).where(eq(halls.id, hallId));
  if (!hall) throw new ValidationError([{ path: "body.hallId", message: `Unknown hall id: ${hallId}` }]);
}

// The overlap rule lives in the database (the exclusion constraint from Phase 1).
// The service doesn't check for overlaps itself; it translates the violation.
function translateOverlap(err: unknown): never {
  if (isPgError(err, PG_EXCLUSION_VIOLATION)) {
    throw new ConflictError("HALL_BUSY", "Hall is busy at that time");
  }
  throw err;
}

export async function createShowtime({ movieId, hallId, startsAt, priceCents }: CreateShowtimeInput) {
  assertInFuture(startsAt);
  const durationMinutes = await movieDuration(db, movieId);
  await assertHallExists(db, hallId);

  const [created] = await db
    .insert(showtimes)
    .values({ movieId, hallId, startsAt, endsAt: computeEndsAt(startsAt, durationMinutes), priceCents })
    .returning({ id: showtimes.id })
    .catch(translateOverlap);
  return getShowtime(created!.id);
}

// Rules:
// - A showtime that has already started can't be changed at all.
// - The price can always change: each reservation keeps the price it was booked at.
// - Movie, hall and time can change only while there are NO reservations (in any
//   status). Moving a showtime would move people's bookings, or rewrite their history.
export async function updateShowtime(id: number, input: UpdateShowtimeInput) {
  await db
    .transaction(async (tx) => {
      // FOR UPDATE locks this showtime row until the transaction ends. A reservation
      // being inserted for it must take a lock on the same row for its foreign key
      // check, so it waits for us (or we wait for it). That way the "no reservations"
      // check below can't be outdated by the time we update.
      const [current] = await tx.select().from(showtimes).where(eq(showtimes.id, id)).for("update");
      if (!current) throw new NotFoundError(`Showtime ${id} not found`);
      if (current.startsAt.getTime() <= Date.now()) {
        throw new ConflictError("SHOWTIME_STARTED", "This showtime has already started and can't be changed");
      }

      const { movieId, hallId, startsAt, priceCents } = input;
      const changes: Partial<typeof showtimes.$inferInsert> = { priceCents };

      if (movieId !== undefined || hallId !== undefined || startsAt !== undefined) {
        const bookings = await tx.$count(reservations, eq(reservations.showtimeId, id));
        if (bookings > 0) {
          throw new ConflictError(
            "SHOWTIME_HAS_RESERVATIONS",
            "This showtime has reservations; only its price can be changed",
          );
        }
        if (startsAt) assertInFuture(startsAt);
        if (hallId) await assertHallExists(tx, hallId);

        const newStart = startsAt ?? current.startsAt;
        const duration = await movieDuration(tx, movieId ?? current.movieId);
        Object.assign(changes, { movieId, hallId, startsAt, endsAt: computeEndsAt(newStart, duration) });
      }

      // Drizzle skips keys whose value is undefined, so only the given fields change.
      await tx.update(showtimes).set(changes).where(eq(showtimes.id, id));
    })
    .catch(translateOverlap);

  return getShowtime(id);
}

// Rule: only a showtime with no reservations (in any status) can be deleted.
// reservations.showtime_id is ON DELETE RESTRICT, so the database enforces it.
export async function deleteShowtime(id: number) {
  try {
    const deleted = await db.delete(showtimes).where(eq(showtimes.id, id)).returning({ id: showtimes.id });
    if (deleted.length === 0) throw new NotFoundError(`Showtime ${id} not found`);
  } catch (err) {
    if (isPgError(err, PG_FOREIGN_KEY_VIOLATION)) {
      throw new ConflictError("SHOWTIME_HAS_RESERVATIONS", `Showtime ${id} has reservations and can't be deleted`);
    }
    throw err;
  }
}

// --- Browsing (public) ---

// Movies with their upcoming showtimes on one calendar day, in the given timezone.
export async function getDaySchedule({ date, tz = env.THEATER_TIMEZONE }: ScheduleQuery) {
  // Where the day starts and ends, as UTC instants. "timestamp AT TIME ZONE tz" reads
  // a local wall-clock time in that zone. Postgres does the math, so a day with a
  // daylight-saving change is correctly 23 or 25 hours long.
  const dayStart = sql`(${date}::date)::timestamp at time zone ${tz}`;
  const dayEnd = sql`(${date}::date + 1)::timestamp at time zone ${tz}`;

  // Free seats = seats in the hall - active bookings for this showtime.
  // Correlated subqueries: each one runs once per showtime row.
  const seatsAvailable = sql<number>`(
    (select count(*) from ${seats} where ${seats.hallId} = ${showtimes.hallId})
    - (select count(*) from ${reservationSeats}
       where ${reservationSeats.showtimeId} = ${showtimes.id} and ${reservationSeats.active})
  )`.mapWith(Number);

  const rows = await db
    .select({
      movie: {
        id: movies.id,
        title: movies.title,
        description: movies.description,
        posterUrl: movies.posterUrl,
        durationMinutes: movies.durationMinutes,
      },
      showtime: {
        id: showtimes.id,
        startsAt: showtimes.startsAt,
        endsAt: showtimes.endsAt,
        priceCents: showtimes.priceCents,
        seatsAvailable,
      },
      hall: { id: halls.id, name: halls.name },
    })
    .from(showtimes)
    .innerJoin(movies, eq(movies.id, showtimes.movieId))
    .innerJoin(halls, eq(halls.id, showtimes.hallId))
    .where(
      and(
        // A range on starts_at (not "date(starts_at) = ..."), so the index can be used.
        gte(showtimes.startsAt, dayStart),
        lt(showtimes.startsAt, dayEnd),
        // Only showtimes you can still book.
        gt(showtimes.startsAt, sql`now()`),
      ),
    )
    .orderBy(asc(movies.title), asc(movies.id), asc(showtimes.startsAt))
    .catch((err: unknown) => {
      // Intl and Postgres don't know exactly the same zone names; if Postgres
      // rejects one that Intl accepted, it's still the client's input.
      if (isPgError(err, PG_INVALID_PARAMETER_VALUE)) {
        throw new ValidationError([{ path: "query.tz", message: `Unknown timezone: ${tz}` }]);
      }
      throw err;
    });

  // The query returns one row per showtime; nest them under their movie.
  type MovieRow = (typeof rows)[number]["movie"];
  type ShowtimeRow = (typeof rows)[number]["showtime"] & { hall: (typeof rows)[number]["hall"] };
  const byMovie = new Map<number, MovieRow & { showtimes: ShowtimeRow[] }>();
  for (const { movie, showtime, hall } of rows) {
    const entry = byMovie.get(movie.id) ?? { ...movie, showtimes: [] };
    entry.showtimes.push({ ...showtime, hall });
    byMovie.set(movie.id, entry);
  }

  const genres = await genresByMovie([...byMovie.keys()]);
  return {
    date,
    timezone: tz,
    movies: [...byMovie.values()].map((m) => ({ ...m, genres: genres.get(m.id) ?? [] })),
  };
}

// Every seat in the showtime's hall, each marked available or not.
export async function getSeatMap(id: number) {
  const showtime = await getShowtime(id);

  // The booking conditions go in the JOIN's ON clause, not in WHERE. With LEFT JOIN,
  // a seat with no matching booking still appears (with NULLs). A WHERE on
  // reservation_seats columns would drop those rows: exactly the free seats.
  const rows = await db
    .select({
      id: seats.id,
      rowLabel: seats.rowLabel,
      seatNumber: seats.seatNumber,
      available: sql<boolean>`${reservationSeats.seatId} is null`,
    })
    .from(seats)
    .leftJoin(
      reservationSeats,
      and(
        eq(reservationSeats.seatId, seats.id),
        eq(reservationSeats.showtimeId, id),
        eq(reservationSeats.active, true),
      ),
    )
    .where(eq(seats.hallId, showtime.hall.id))
    .orderBy(asc(seats.rowLabel), asc(seats.seatNumber));

  // Group into rows (A, B, C...) so a client can draw the map directly.
  const seatRows: { row: string; seats: { id: number; number: number; available: boolean }[] }[] = [];
  for (const seat of rows) {
    let row = seatRows.at(-1);
    if (row?.row !== seat.rowLabel) {
      row = { row: seat.rowLabel, seats: [] };
      seatRows.push(row);
    }
    row.seats.push({ id: seat.id, number: seat.seatNumber, available: seat.available });
  }

  return {
    showtime,
    totalSeats: rows.length,
    availableSeats: rows.filter((s) => s.available).length,
    rows: seatRows,
  };
}
