import { describe, expect, it } from "vitest";
import { fromBeforeTo, idSchema, paginationQuery, timeZoneSchema } from "../../src/lib/schemas.ts";
import { loginBody, signupBody } from "../../src/modules/auth/auth.schemas.ts";
import { createMovieBody, updateMovieBody } from "../../src/modules/movies/movies.schemas.ts";
import { createReservationBody } from "../../src/modules/reservations/reservations.schemas.ts";
import { createShowtimeBody, scheduleQuery } from "../../src/modules/showtimes/showtimes.schemas.ts";

// Zod schemas are the API's first line of defense, and they're pure, so they're
// cheap to test directly: safeParse(input) → { success, data | error }.

describe("shared schemas", () => {
  it("coerces ids from strings (URL params arrive as text)", () => {
    expect(idSchema.parse("42")).toBe(42);
    expect(idSchema.safeParse("abc").success).toBe(false);
    expect(idSchema.safeParse("0").success).toBe(false);
  });

  it("defaults and limits pagination", () => {
    expect(paginationQuery.parse({})).toEqual({ page: 1, limit: 20 });
    expect(paginationQuery.safeParse({ limit: "500" }).success).toBe(false);
  });

  it("accepts real IANA timezones only", () => {
    expect(timeZoneSchema.safeParse("America/Mexico_City").success).toBe(true);
    expect(timeZoneSchema.safeParse("UTC").success).toBe(true);
    expect(timeZoneSchema.safeParse("Mars/Olympus").success).toBe(false);
  });

  it("checks that from is before to", () => {
    const a = new Date("2026-01-01T00:00:00Z");
    const b = new Date("2026-02-01T00:00:00Z");
    expect(fromBeforeTo({ from: a, to: b })).toBe(true);
    expect(fromBeforeTo({ from: b, to: a })).toBe(false);
    expect(fromBeforeTo({ from: a, to: a })).toBe(false);
    expect(fromBeforeTo({ from: a })).toBe(true);
  });
});

describe("auth schemas", () => {
  it("trims and lowercases the email", () => {
    const data = signupBody.parse({ email: "  Ana@Example.COM ", password: "correct-horse", name: " Ana " });
    expect(data).toEqual({ email: "ana@example.com", password: "correct-horse", name: "Ana" });
  });

  it("never trims passwords", () => {
    expect(signupBody.parse({ email: "a@b.co", password: " spaced pw ", name: "A" }).password).toBe(" spaced pw ");
  });

  it("rejects a role in the signup body", () => {
    const result = signupBody.safeParse({ email: "a@b.co", password: "password1", name: "A", role: "admin" });
    expect(result.success).toBe(false);
  });

  it("requires 8+ character passwords on signup but not on login", () => {
    expect(signupBody.safeParse({ email: "a@b.co", password: "short", name: "A" }).success).toBe(false);
    expect(loginBody.safeParse({ email: "a@b.co", password: "short" }).success).toBe(true);
  });
});

describe("movie schemas", () => {
  const valid = { title: "Arrival", description: "Aliens.", durationMinutes: 116 };

  it("fills defaults and removes duplicate genre ids", () => {
    expect(createMovieBody.parse(valid)).toMatchObject({ posterUrl: null, genreIds: [] });
    expect(createMovieBody.parse({ ...valid, genreIds: [4, 3, 4] }).genreIds).toEqual([4, 3]);
  });

  it("only accepts http(s) poster URLs", () => {
    expect(createMovieBody.safeParse({ ...valid, posterUrl: "https://x.com/p.jpg" }).success).toBe(true);
    expect(createMovieBody.safeParse({ ...valid, posterUrl: "javascript:alert(1)" }).success).toBe(false);
  });

  it("rejects an empty PATCH body", () => {
    expect(updateMovieBody.safeParse({}).success).toBe(false);
    expect(updateMovieBody.safeParse({ title: "New" }).success).toBe(true);
  });
});

describe("showtime schemas", () => {
  it("requires a timezone in startsAt and converts it to a Date", () => {
    const base = { movieId: 1, hallId: 1, priceCents: 1000 };
    const parsed = createShowtimeBody.parse({ ...base, startsAt: "2026-10-19T16:00:00-06:00" });
    expect(parsed.startsAt.toISOString()).toBe("2026-10-19T22:00:00.000Z");
    expect(createShowtimeBody.safeParse({ ...base, startsAt: "2026-10-19T16:00:00" }).success).toBe(false);
  });

  it("rejects a client-sent endsAt", () => {
    const body = { movieId: 1, hallId: 1, priceCents: 1000, startsAt: "2026-10-19T16:00:00Z", endsAt: "x" };
    expect(createShowtimeBody.safeParse(body).success).toBe(false);
  });

  it("expects a calendar date for the day schedule", () => {
    expect(scheduleQuery.safeParse({ date: "2026-10-19" }).success).toBe(true);
    expect(scheduleQuery.safeParse({ date: "2026-13-45" }).success).toBe(false);
  });
});

describe("reservation schema", () => {
  it("rejects duplicate seats, no seats, and a client-sent total", () => {
    expect(createReservationBody.safeParse({ showtimeId: 1, seatIds: [5, 5] }).success).toBe(false);
    expect(createReservationBody.safeParse({ showtimeId: 1, seatIds: [] }).success).toBe(false);
    expect(createReservationBody.safeParse({ showtimeId: 1, seatIds: [5], totalCents: 1 }).success).toBe(false);
    expect(createReservationBody.safeParse({ showtimeId: 1, seatIds: [5, 6] }).success).toBe(true);
  });
});
