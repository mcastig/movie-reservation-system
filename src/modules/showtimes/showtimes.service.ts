import { eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { halls, movies, reservations, showtimes } from "../../db/schema.ts";
import {
  ConflictError,
  isPgError,
  NotFoundError,
  PG_EXCLUSION_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
  ValidationError,
} from "../../lib/errors.ts";
import { computeEndsAt } from "./schedule.ts";
import type { CreateShowtimeInput, UpdateShowtimeInput } from "./showtimes.schemas.ts";

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
