import { z } from "zod";

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

export type CreateReservationInput = z.output<typeof createReservationBody>;
