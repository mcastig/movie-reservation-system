import { beforeEach, describe, expect, it } from "vitest";
import { adminToken, api, bearer, insertPastShowtimeWithReservation, utcAt } from "./helpers.ts";

// Phase 4: scheduling. Tomorrow (day 1): Hall 1 is busy 14:00–16:43 and 18:00–19:54,
// Hall 2 is busy 15:00–17:20 and 19:00–21:43 (ends include the 15 min buffer).

let admin: string;
beforeEach(async () => {
  admin = await adminToken();
});

const create = (body: object) => api().post("/showtimes").set(bearer(admin)).send(body);
const budapest = (hallId: number, time: string) => ({ movieId: 3, hallId, startsAt: utcAt(1, time), priceCents: 1000 });

describe("creating showtimes (Phase 4 'done when')", () => {
  it("returns 409 for an overlap in the same hall", async () => {
    // 17:00 + 99 min + 15 min = 18:54, but Hall 1 has a show at 18:00.
    const res = await create(budapest(1, "17:00")).expect(409);
    expect(res.body.error).toEqual({ code: "HALL_BUSY", message: "Hall is busy at that time" });
  });

  it("allows the same time in different halls", async () => {
    await create(budapest(1, "22:00")).expect(201);
    await create(budapest(2, "22:00")).expect(201);
  });

  it("computes endsAt on the server and allows back-to-back shows", async () => {
    const first = await create(budapest(2, "22:00")).expect(201);
    expect(first.body.endsAt).toBe(new Date(utcAt(1, "23:54")).toISOString());

    await create(budapest(2, "23:53")).expect(409); // one minute too early
    await create(budapest(2, "23:54")).expect(201); // exactly when the hall is free
  });

  it("rejects past times and times without a timezone", async () => {
    await create({ movieId: 1, hallId: 1, startsAt: "2020-01-01T10:00:00Z", priceCents: 1000 }).expect(400);
    await create({ movieId: 1, hallId: 1, startsAt: utcAt(1, "10:00").replace("Z", ""), priceCents: 1000 }).expect(400);
  });
});

describe("updating and deleting showtimes", () => {
  it("allows a price change on a booked showtime, but not moving it", async () => {
    await api().patch("/showtimes/1").set(bearer(admin)).send({ priceCents: 1300 }).expect(200);
    const res = await api().patch("/showtimes/1").set(bearer(admin)).send({ startsAt: utcAt(1, "13:00") }).expect(409);
    expect(res.body.error.code).toBe("SHOWTIME_HAS_RESERVATIONS");
  });

  it("recomputes endsAt when a free showtime moves or changes movie", async () => {
    const moved = await api().patch("/showtimes/2").set(bearer(admin)).send({ movieId: 1 }).expect(200);
    // 18:00 + 148 + 15 = 20:43
    expect(moved.body.endsAt).toBe(new Date(utcAt(1, "20:43")).toISOString());
  });

  it("returns 409 when a move would overlap", async () => {
    await api().patch("/showtimes/2").set(bearer(admin)).send({ hallId: 2 }).expect(409);
  });

  it("refuses to change a showtime that already started", async () => {
    const { showtimeId } = await insertPastShowtimeWithReservation();
    const res = await api().patch(`/showtimes/${showtimeId}`).set(bearer(admin)).send({ priceCents: 1 }).expect(409);
    expect(res.body.error.code).toBe("SHOWTIME_STARTED");
  });

  it("deletes only showtimes without reservations", async () => {
    await api().delete("/showtimes/1").set(bearer(admin)).expect(409);
    await api().delete("/showtimes/2").set(bearer(admin)).expect(204);
    await api().delete("/showtimes/2").set(bearer(admin)).expect(404);
  });
});
