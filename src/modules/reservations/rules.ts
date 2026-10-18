import { ConflictError } from "../../lib/errors.ts";

// Pure business rules: no database, no HTTP. They take plain values (including
// "now", so tests can pick the time) and either return a result or throw.

// The total is always computed on the server from the showtime's price.
export function reservationTotal(priceCents: number, seatCount: number): number {
  if (!Number.isInteger(priceCents) || priceCents < 0) throw new RangeError("priceCents must be a non-negative integer");
  if (!Number.isInteger(seatCount) || seatCount < 1) throw new RangeError("seatCount must be a positive integer");
  return priceCents * seatCount;
}

// A reservation can be cancelled while it's confirmed and its showtime hasn't started.
export function assertCancellable(
  reservation: { status: "confirmed" | "cancelled"; startsAt: Date },
  now: Date = new Date(),
): void {
  if (reservation.status === "cancelled") {
    throw new ConflictError("ALREADY_CANCELLED", "This reservation is already cancelled");
  }
  if (reservation.startsAt.getTime() <= now.getTime()) {
    throw new ConflictError("SHOWTIME_STARTED", "Only upcoming reservations can be cancelled");
  }
}
