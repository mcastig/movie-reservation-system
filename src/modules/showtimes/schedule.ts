import { env } from "../../config/env.ts";

// When the hall is free again: the movie's running time plus the cleaning buffer.
// This is the value stored in showtimes.ends_at, so the overlap constraint keeps
// the buffer free too. Used by the service and the seed, so both agree.
export function computeEndsAt(startsAt: Date, durationMinutes: number): Date {
  const minutes = durationMinutes + env.CLEANING_BUFFER_MINUTES;
  return new Date(startsAt.getTime() + minutes * 60 * 1000);
}
