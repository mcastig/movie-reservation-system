import { asc } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { genres } from "../../db/schema.ts";
import { ConflictError, isPgError, PG_UNIQUE_VIOLATION } from "../../lib/errors.ts";
import type { CreateGenreInput } from "./genres.schemas.ts";

export function listGenres() {
  return db.select().from(genres).orderBy(asc(genres.name));
}

export async function createGenre(input: CreateGenreInput) {
  // No "does it exist?" query first: two requests could both pass that check.
  // We insert and let the UNIQUE constraint decide, then translate its error.
  try {
    const [genre] = await db.insert(genres).values(input).returning();
    return genre!;
  } catch (err) {
    if (isPgError(err, PG_UNIQUE_VIOLATION)) {
      throw new ConflictError("GENRE_EXISTS", `Genre "${input.name}" already exists`);
    }
    throw err;
  }
}
