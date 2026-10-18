import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { api, query, seatId, utcDay } from "./helpers.ts";

// Phase 5: the day schedule and the seat map.

type ScheduleMovie = { title: string; showtimes: { id: number; startsAt: string; seatsAvailable: number }[] };

describe("GET /movies/showtimes", () => {
  it("lists tomorrow's showtimes grouped by movie, with free seats", async () => {
    const res = await api().get(`/movies/showtimes?date=${utcDay(1)}`).expect(200);
    const movies: ScheduleMovie[] = res.body.movies;

    expect(movies.map((m) => m.title)).toEqual(["Inception", "Spirited Away", "The Grand Budapest Hotel"]);
    expect(movies[0]!.showtimes.map((s) => [s.id, s.seatsAvailable])).toEqual([
      [1, 38], // A1 + A2 are booked
      [4, 24],
    ]);
  });

  it("uses the requested timezone's day", async () => {
    // Tokyo is UTC+9: its day ends at 15:00 UTC, so only the 14:00Z show is on it.
    const res = await api().get(`/movies/showtimes?date=${utcDay(1)}&tz=Asia/Tokyo`).expect(200);
    const ids = res.body.movies.flatMap((m: ScheduleMovie) => m.showtimes.map((s) => s.id));
    expect(ids).toEqual([1]);
  });

  it("returns nothing for a past day and 400 for bad input", async () => {
    const past = await api().get("/movies/showtimes?date=2020-01-01").expect(200);
    expect(past.body.movies).toEqual([]);
    await api().get("/movies/showtimes").expect(400);
    await api().get("/movies/showtimes?date=2026-10-19&tz=Mars/Olympus").expect(400);
  });

  it("doesn't break GET /movies/:id (route order)", async () => {
    await api().get("/movies/1").expect(200);
  });
});

describe("GET /showtimes/:id/seats (Phase 5 'done when')", () => {
  const rowC = async () => {
    const res = await api().get("/showtimes/2/seats").expect(200);
    return {
      available: res.body.availableSeats as number,
      c5: res.body.rows[2].seats[4].available as boolean,
    };
  };

  it("shows the seeded booking", async () => {
    const res = await api().get("/showtimes/1/seats").expect(200);
    expect(res.body).toMatchObject({ totalSeats: 40, availableSeats: 38 });
    expect(res.body.rows[0].seats.slice(0, 3).map((s: { available: boolean }) => s.available)).toEqual([false, false, true]);
  });

  it("changes after a reservation is inserted by hand, and again after it's cancelled", async () => {
    expect(await rowC()).toEqual({ available: 40, c5: true });

    const [r] = await query<{ id: number }>(sql`
      insert into reservations (user_id, showtime_id, total_cents) values (2, 2, 1000) returning id`);
    await query(sql`
      insert into reservation_seats (reservation_id, showtime_id, hall_id, seat_id, price_cents)
      values (${r!.id}, 2, 1, ${seatId(1, "C5")}, 1000)`);
    expect(await rowC()).toEqual({ available: 39, c5: false });

    await query(sql`update reservation_seats set active = false where reservation_id = ${r!.id}`);
    expect(await rowC()).toEqual({ available: 40, c5: true });
  });

  it("404s for an unknown showtime", async () => {
    await api().get("/showtimes/999/seats").expect(404);
  });
});
