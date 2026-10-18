import { z } from "zod";

const showtimeFields = {
  movieId: z.number().int().positive(),
  hallId: z.number().int().positive(),
  // An ISO 8601 date-time WITH a timezone: "2026-10-20T19:00:00Z" or
  // "2026-10-20T19:00:00-06:00". "2026-10-20T19:00" is rejected, because 19:00
  // in Mexico City and 19:00 in Madrid are different moments.
  startsAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  priceCents: z.number().int().min(0).max(100_000),
};

export const createShowtimeBody = z.strictObject(showtimeFields);

export const updateShowtimeBody = z
  .strictObject(showtimeFields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Provide at least one field to update" });

export type CreateShowtimeInput = z.output<typeof createShowtimeBody>;
export type UpdateShowtimeInput = z.output<typeof updateShowtimeBody>;
