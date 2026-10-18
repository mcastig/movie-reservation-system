import { describe, expect, it } from "vitest";
import { ConflictError } from "../../src/lib/errors.ts";
import { assertCancellable, reservationTotal } from "../../src/modules/reservations/rules.ts";
import { computeEndsAt } from "../../src/modules/showtimes/schedule.ts";

describe("reservationTotal", () => {
  it("multiplies the showtime price by the number of seats", () => {
    expect(reservationTotal(1200, 1)).toBe(1200);
    expect(reservationTotal(1200, 3)).toBe(3600);
  });

  it("allows free showtimes", () => {
    expect(reservationTotal(0, 4)).toBe(0);
  });

  it("rejects values that would produce a nonsense total", () => {
    expect(() => reservationTotal(-100, 2)).toThrow(RangeError);
    expect(() => reservationTotal(12.5, 2)).toThrow(RangeError);
    expect(() => reservationTotal(1200, 0)).toThrow(RangeError);
  });
});

describe("assertCancellable", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  const later = new Date("2026-10-19T14:00:00Z");
  const earlier = new Date("2026-10-19T10:00:00Z");

  it("allows a confirmed reservation for an upcoming showtime", () => {
    expect(() => assertCancellable({ status: "confirmed", startsAt: later }, now)).not.toThrow();
  });

  it("refuses an already cancelled reservation", () => {
    expect(() => assertCancellable({ status: "cancelled", startsAt: later }, now)).toThrow(
      expect.objectContaining({ code: "ALREADY_CANCELLED", status: 409 }),
    );
  });

  it("refuses once the showtime has started", () => {
    expect(() => assertCancellable({ status: "confirmed", startsAt: earlier }, now)).toThrow(ConflictError);
    expect(() => assertCancellable({ status: "confirmed", startsAt: earlier }, now)).toThrow(
      expect.objectContaining({ code: "SHOWTIME_STARTED" }),
    );
  });

  it("treats the exact start time as started (boundary)", () => {
    expect(() => assertCancellable({ status: "confirmed", startsAt: now }, now)).toThrow(
      expect.objectContaining({ code: "SHOWTIME_STARTED" }),
    );
  });
});

describe("computeEndsAt", () => {
  it("adds the movie duration and the cleaning buffer (15 min in tests)", () => {
    const start = new Date("2026-10-19T14:00:00Z");
    // Inception: 148 min + 15 min buffer = 163 min → 16:43.
    expect(computeEndsAt(start, 148).toISOString()).toBe("2026-10-19T16:43:00.000Z");
  });

  it("works across midnight", () => {
    expect(computeEndsAt(new Date("2026-10-19T23:00:00Z"), 99).toISOString()).toBe("2026-10-20T00:54:00.000Z");
  });
});
