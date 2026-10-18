import { z } from "zod";
import { idSchema, paginationQuery } from "../../lib/schemas.ts";

const movieFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  // Just a URL string for now. Only http(s), so "javascript:..." can't sneak in.
  posterUrl: z.url({ protocol: /^https?$/ }).max(2000).nullable(),
  durationMinutes: z.number().int().min(1).max(600),
  // Duplicates are removed: [1, 1] would break the movie_genres primary key.
  genreIds: z
    .array(idSchema)
    .max(10)
    .transform((ids) => [...new Set(ids)]),
};

export const createMovieBody = z.strictObject({
  ...movieFields,
  posterUrl: movieFields.posterUrl.default(null),
  genreIds: movieFields.genreIds.default([]),
});

// PATCH: every field is optional, but an empty body is almost certainly a client bug.
export const updateMovieBody = z
  .strictObject(movieFields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Provide at least one field to update" });

export const listMoviesQuery = paginationQuery.extend({
  genre: idSchema.optional(),
});

export type CreateMovieInput = z.output<typeof createMovieBody>;
export type UpdateMovieInput = z.output<typeof updateMovieBody>;
export type ListMoviesQuery = z.output<typeof listMoviesQuery>;
