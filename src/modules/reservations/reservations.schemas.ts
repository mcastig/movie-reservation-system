import { z } from "zod";
import { reservationStatus } from "../../db/schema.ts";
import { fromBeforeTo, fromBeforeToError, idSchema, paginationQuery, timeRangeFields } from "../../lib/schemas.ts";

export const createReservationBody = z.strictObject({
  showtimeId: z.number().int().positive(),
  seatIds: z
    .array(z.number().int().positive())
    .min(1)
    .max(10)
    // Asking for the same seat twice is a client bug, so it's an error, not silently fixed.
    .refine((ids) => new Set(ids).size === ids.length, { message: "Seat ids must be unique" }),
  // No price here: the server computes the total. Never trust a price sent by the client.
});

export const adminReservationsQuery = paginationQuery
  .extend({
    showtimeId: idSchema.optional(),
    status: z.enum(reservationStatus.enumValues).optional(),
    ...timeRangeFields,
  })
  .refine(fromBeforeTo, fromBeforeToError);

export type CreateReservationInput = z.output<typeof createReservationBody>;
export type AdminReservationsQuery = z.output<typeof adminReservationsQuery>;
