import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  adminToken,
  api,
  bearer,
  insertPastShowtimeWithReservation,
  query,
  seatId,
  signUpAndLogIn,
  userToken,
} from "./helpers.ts";

// Phase 6: booking, viewing and cancelling.

let user: string; // the demo user (owns reservation 1: A1 + A2 at showtime 1)
let bob: string;
beforeEach(async () => {
  user = await userToken();
  bob = await signUpAndLogIn("bob@example.com", "Bob");
});

const book = (token: string, showtimeId: number, seatIds: number[]) =>
  api().post("/reservations").set(bearer(token)).send({ showtimeId, seatIds });

const countReservations = async () =>
  Number((await query<{ n: string }>(sql`select count(*) as n from reservations`))[0]!.n);

describe("booking", () => {
  it("books seats with a server-computed total", async () => {
    const res = await book(user, 1, [seatId(1, "B1"), seatId(1, "B2")]).expect(201);
    expect(res.headers.location).toBe(`/reservations/${res.body.id}`);
    expect(res.body).toMatchObject({ status: "confirmed", totalCents: 2400, showtime: { id: 1 } });
    expect(res.body.seats.map((s: { row: string; number: number }) => `${s.row}${s.number}`)).toEqual(["B1", "B2"]);
  });

  it("returns 409 naming the taken seats, and leaves nothing behind", async () => {
    const before = await countReservations();
    const res = await book(bob, 1, [seatId(1, "B2"), seatId(1, "A1")]).expect(409);
    expect(res.body.error).toEqual({ code: "SEATS_TAKEN", message: "Seat(s) already taken: A1" });
    expect(await countReservations()).toBe(before); // the whole transaction rolled back
  });

  it("rejects a client-sent price, seats from another hall and unknown showtimes", async () => {
    await api().post("/reservations").set(bearer(bob)).send({ showtimeId: 1, seatIds: [20], totalCents: 1 }).expect(400);
    const wrongHall = await book(bob, 1, [seatId(2, "A1")]).expect(400);
    expect(wrongHall.body.error.details[0].message).toMatch(/not in this showtime's hall: 41/);
    await book(bob, 999, [1]).expect(400);
  });

  it("refuses showtimes that already started", async () => {
    const { showtimeId } = await insertPastShowtimeWithReservation();
    const res = await book(bob, showtimeId, [seatId(2, "B1")]).expect(409);
    expect(res.body.error.code).toBe("SHOWTIME_STARTED");
  });

  it("keeps the booked price when the showtime price changes later", async () => {
    await book(bob, 1, [seatId(1, "C1")]).expect(201);
    await api().patch("/showtimes/1").set(bearer(await adminToken())).send({ priceCents: 2000 }).expect(200);
    const mine = await api().get("/reservations/me").set(bearer(bob)).expect(200);
    expect(mine.body.data[0]).toMatchObject({ totalCents: 1200, seats: [{ priceCents: 1200 }] });
  });
});

describe("viewing", () => {
  it("lists only my reservations", async () => {
    const res = await api().get("/reservations/me").set(bearer(user)).expect(200);
    expect(res.body.pagination.total).toBe(1);
    const bobs = await api().get("/reservations/me").set(bearer(bob)).expect(200);
    expect(bobs.body.data).toEqual([]);
  });

  it("hides other users' reservations with a 404 (admins can see them)", async () => {
    await api().get("/reservations/1").set(bearer(bob)).expect(404);
    await api().get("/reservations/1").set(bearer(await adminToken())).expect(200);
  });
});

describe("cancelling (Phase 6 'done when')", () => {
  it("cancels my upcoming reservation and frees its seats", async () => {
    const res = await api().post("/reservations/1/cancel").set(bearer(user)).expect(200);
    expect(res.body).toMatchObject({ status: "cancelled" });
    expect(res.body.cancelledAt).not.toBeNull();

    await api().post("/reservations/1/cancel").set(bearer(user)).expect(409); // twice
    await book(bob, 1, [seatId(1, "A1")]).expect(201); // the seat is free again
  });

  it("returns 404 when cancelling someone else's reservation", async () => {
    await api().post("/reservations/1/cancel").set(bearer(bob)).expect(404);
  });

  it("refuses to cancel a reservation for a past showtime", async () => {
    const { reservationId } = await insertPastShowtimeWithReservation();
    const res = await api().post(`/reservations/${reservationId}/cancel`).set(bearer(user)).expect(409);
    expect(res.body.error.code).toBe("SHOWTIME_STARTED");
  });
});
