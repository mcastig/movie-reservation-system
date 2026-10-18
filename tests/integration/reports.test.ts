import { beforeEach, describe, expect, it } from "vitest";
import { adminToken, api, bearer, seatId, signUpAndLogIn, userToken, utcAt } from "./helpers.ts";

// Phase 7: the reports must match numbers calculated by hand.

let admin: string;
beforeEach(async () => {
  admin = await adminToken();
});

const report = (path: string) => api().get(path).set(bearer(admin)).expect(200);

describe("access", () => {
  it("is admin only", async () => {
    await api().get("/admin/reports/showtimes").expect(401);
    await api().get("/admin/reports/showtimes").set(bearer(await userToken())).expect(403);
  });
});

describe("with only the seed data", () => {
  // 3 days x (2 Hall 1 shows x 40 seats + 2 Hall 2 shows x 24 seats) = 384 seats.
  // One booking: A1 + A2 at showtime 1, 1200 each.
  it("matches the hand calculation", async () => {
    const showtimes = await report("/admin/reports/showtimes");
    expect(showtimes.body.totals).toEqual({
      showtimes: 12,
      capacity: 384,
      ticketsSold: 2,
      occupancyPct: 0.5,
      revenueCents: 2400,
      cancelledReservations: 0,
    });

    const movies = await report("/admin/reports/movies");
    expect(movies.body.movies.map((m: { title: string; showtimes: number; capacity: number }) => [m.title, m.showtimes, m.capacity])).toEqual([
      ["Inception", 6, 192],
      ["Spirited Away", 3, 72],
      ["The Grand Budapest Hotel", 3, 120],
    ]);
  });
});

describe("after bookings, a cancellation and a price change", () => {
  beforeEach(async () => {
    const user = await userToken();
    const bob = await signUpAndLogIn("bob@example.com", "Bob");
    const book = (token: string, showtimeId: number, labels: string[], hall: 1 | 2) =>
      api()
        .post("/reservations")
        .set(bearer(token))
        .send({ showtimeId, seatIds: labels.map((l) => seatId(hall, l)) })
        .expect(201);

    await book(bob, 2, ["C1", "C2", "C3"], 1); // 3 x 1000 = 3000
    await book(user, 3, ["A1", "A2", "A3", "A4"], 2); // 4 x 900 = 3600
    const cancelled = await book(bob, 4, ["B1", "B2"], 2); // 2800, then cancelled
    await api().post(`/reservations/${cancelled.body.id}/cancel`).set(bearer(bob)).expect(200);
    await api().patch("/showtimes/1").set(bearer(admin)).send({ priceCents: 2000 }).expect(200);
    await book(user, 1, ["D1"], 1); // 1 x 2000 = 2000 (the seed's 2400 stays)
  });

  it("reports per showtime, excluding the cancelled booking", async () => {
    const res = await report(`/admin/reports/showtimes?from=${utcAt(1, "00:00")}&to=${utcAt(2, "00:00")}`);
    type Row = { id: number; ticketsSold: number; revenueCents: number; occupancyPct: number; cancelledReservations: number };
    const byId = Object.fromEntries(res.body.showtimes.map((s: Row) => [s.id, s]));

    expect(byId[1]).toMatchObject({ ticketsSold: 3, revenueCents: 4400, occupancyPct: 7.5 });
    expect(byId[2]).toMatchObject({ ticketsSold: 3, revenueCents: 3000, occupancyPct: 7.5 });
    expect(byId[3]).toMatchObject({ ticketsSold: 4, revenueCents: 3600, occupancyPct: 16.7 });
    expect(byId[4]).toMatchObject({ ticketsSold: 0, revenueCents: 0, cancelledReservations: 1 });
    expect(res.body.totals).toMatchObject({ showtimes: 4, capacity: 128, ticketsSold: 10, revenueCents: 11000 });
  });

  it("reports per movie, sorted by revenue", async () => {
    const res = await report("/admin/reports/movies");
    type Row = { title: string; ticketsSold: number; revenueCents: number };
    expect(res.body.movies.map((m: Row) => [m.title, m.ticketsSold, m.revenueCents])).toEqual([
      ["Inception", 3, 4400],
      ["Spirited Away", 4, 3600],
      ["The Grand Budapest Hotel", 3, 3000],
    ]);
    expect(res.body.totals).toEqual({ ticketsSold: 10, revenueCents: 11000 });
  });

  it("lists movies with no showtimes in the range as zeros", async () => {
    const res = await report("/admin/reports/movies?from=2030-01-01T00:00:00Z&to=2031-01-01T00:00:00Z");
    expect(res.body.movies.map((m: { showtimes: number; revenueCents: number }) => [m.showtimes, m.revenueCents])).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
  });

  it("filters the admin reservations list", async () => {
    const all = await report("/admin/reservations");
    expect(all.body.pagination.total).toBe(5);
    expect(all.body.data[0].user).toMatchObject({ email: expect.any(String) });

    const cancelled = await report("/admin/reservations?status=cancelled");
    expect(cancelled.body.pagination.total).toBe(1);

    const first = await report("/admin/reservations?showtimeId=1");
    expect(first.body.pagination.total).toBe(2);

    await api().get(`/admin/reservations?from=${utcAt(2, "00:00")}&to=${utcAt(1, "00:00")}`).set(bearer(admin)).expect(400);
  });
});
