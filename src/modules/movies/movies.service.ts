import { and, asc, eq, exists, inArray } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { genres, movieGenres, movies } from "../../db/schema.ts";
import {
  ConflictError,
  isPgError,
  NotFoundError,
  PG_FOREIGN_KEY_VIOLATION,
  ValidationError,
} from "../../lib/errors.ts";
import { paginate } from "../../lib/schemas.ts";
import type { CreateMovieInput, ListMoviesQuery, UpdateMovieInput } from "./movies.schemas.ts";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Genre = { id: number; name: string };

// Loads the genres of many movies in ONE query, instead of one query per movie
// (the "N+1 queries" problem), and groups them by movie id.
async function genresByMovie(movieIds: number[]) {
  const byMovie = new Map<number, Genre[]>();
  if (movieIds.length === 0) return byMovie;

  const rows = await db
    .select({ movieId: movieGenres.movieId, id: genres.id, name: genres.name })
    .from(movieGenres)
    .innerJoin(genres, eq(genres.id, movieGenres.genreId))
    .where(inArray(movieGenres.movieId, movieIds))
    .orderBy(asc(genres.name));

  for (const { movieId, ...genre } of rows) {
    byMovie.set(movieId, [...(byMovie.get(movieId) ?? []), genre]);
  }
  return byMovie;
}

export async function listMovies({ genre, ...pagination }: ListMoviesQuery) {
  // "Movies that have at least one movie_genres row for this genre."
  // EXISTS doesn't duplicate rows the way a JOIN would.
  const where = genre
    ? exists(
        db
          .select()
          .from(movieGenres)
          .where(and(eq(movieGenres.movieId, movies.id), eq(movieGenres.genreId, genre))),
      )
    : undefined;

  const [rows, total] = await Promise.all([
    db
      .select()
      .from(movies)
      .where(where)
      // id breaks ties, so pages stay stable when two movies share a title.
      .orderBy(asc(movies.title), asc(movies.id))
      .limit(pagination.limit)
      .offset((pagination.page - 1) * pagination.limit),
    db.$count(movies, where),
  ]);

  const genresMap = await genresByMovie(rows.map((m) => m.id));
  const data = rows.map((m) => ({ ...m, genres: genresMap.get(m.id) ?? [] }));
  return paginate(data, pagination, total);
}

export async function getMovie(id: number) {
  const [movie] = await db.select().from(movies).where(eq(movies.id, id));
  if (!movie) throw new NotFoundError(`Movie ${id} not found`);

  const genresMap = await genresByMovie([id]);
  return { ...movie, genres: genresMap.get(id) ?? [] };
}

// A foreign key would also reject unknown ids, but its error can't say which ones.
async function assertGenresExist(tx: Tx, genreIds: number[]) {
  if (genreIds.length === 0) return;
  const found = await tx.select({ id: genres.id }).from(genres).where(inArray(genres.id, genreIds));
  const foundIds = new Set(found.map((g) => g.id));
  const missing = genreIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    throw new ValidationError([
      { path: "body.genreIds", message: `Unknown genre id(s): ${missing.join(", ")}` },
    ]);
  }
}

async function setGenres(tx: Tx, movieId: number, genreIds: number[]) {
  await assertGenresExist(tx, genreIds);
  await tx.delete(movieGenres).where(eq(movieGenres.movieId, movieId));
  if (genreIds.length > 0) {
    await tx.insert(movieGenres).values(genreIds.map((genreId) => ({ movieId, genreId })));
  }
}

export async function createMovie({ genreIds, ...fields }: CreateMovieInput) {
  // The movie and its genres are saved together or not at all.
  const id = await db.transaction(async (tx) => {
    const [movie] = await tx.insert(movies).values(fields).returning({ id: movies.id });
    await setGenres(tx, movie!.id, genreIds);
    return movie!.id;
  });
  return getMovie(id);
}

export async function updateMovie(id: number, { genreIds, ...fields }: UpdateMovieInput) {
  await db.transaction(async (tx) => {
    const [movie] =
      Object.keys(fields).length > 0
        ? await tx.update(movies).set(fields).where(eq(movies.id, id)).returning({ id: movies.id })
        : await tx.select({ id: movies.id }).from(movies).where(eq(movies.id, id));
    if (!movie) throw new NotFoundError(`Movie ${id} not found`);

    // genreIds replaces the whole list; leaving it out keeps the current genres.
    if (genreIds !== undefined) await setGenres(tx, id, genreIds);
  });
  return getMovie(id);
}

// Rule: a movie that has any showtimes (past or future) can't be deleted, because
// that would erase reservation history. The FK's ON DELETE RESTRICT enforces it;
// we only translate the error. Delete its showtimes first (Phase 4) if needed.
export async function deleteMovie(id: number) {
  try {
    const deleted = await db.delete(movies).where(eq(movies.id, id)).returning({ id: movies.id });
    if (deleted.length === 0) throw new NotFoundError(`Movie ${id} not found`);
  } catch (err) {
    if (isPgError(err, PG_FOREIGN_KEY_VIOLATION)) {
      throw new ConflictError("MOVIE_HAS_SHOWTIMES", `Movie ${id} has showtimes and can't be deleted`);
    }
    throw err;
  }
}
