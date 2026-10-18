import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../../src/app.ts";
import { query, seatId, userToken } from "./helpers.ts";

// Phase 6's concurrency experiment, automated: N simultaneous bookings for the
// SAME seat must produce exactly one 201. The partial unique index decides.

// One real server for all requests, so they truly run in parallel over HTTP
// (fetch, like scripts/race.ts) instead of being handled one by one.
let server: ReturnType<typeof app.listen>;
let base: string;
beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("double booking under load", () => {
  it.each([20, 50])("lets exactly 1 of %i simultaneous requests book the seat", async (n) => {
    const token = await userToken();
    const seat = seatId(1, "C5");

    const responses = await Promise.all(
      Array.from({ length: n }, () =>
        fetch(`${base}/reservations`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ showtimeId: 2, seatIds: [seat] }),
        }),
      ),
    );
    const statuses = responses.map((r) => r.status);

    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(n - 1);

    const [row] = await query<{ n: string }>(sql`
      select count(*) as n from reservation_seats where showtime_id = 2 and seat_id = ${seat} and active`);
    expect(Number(row!.n)).toBe(1);
  });
});
