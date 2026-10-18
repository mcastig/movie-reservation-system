// The Phase 6 concurrency experiment: fire N booking requests for the SAME seat
// at the same moment and count how many succeed. With the partial unique index,
// exactly 1 should get 201 and the rest 409.
//
//   npm run race                                   # 20 requests, showtime 2, seat 21 (C5)
//   npm run race -- --requests 50 --showtime 3 --seat 45
//
// The API must be running (npm run dev). Run `npm run db:seed` to reset afterwards.
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:3000" },
    requests: { type: "string", default: "20" },
    showtime: { type: "string", default: "2" },
    seat: { type: "string", default: "21" },
  },
});
const base = values.url;
const n = Number(values.requests);
const showtimeId = Number(values.showtime);
const seatId = Number(values.seat);

async function post(path: string, body: unknown, token?: string) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  });
}

// Log in first, so the race is only about booking.
const login = await post("/auth/login", { email: "user@example.com", password: "user-password" });
if (!login.ok) throw new Error(`Login failed (${login.status}). Is the API running and seeded?`);
const { accessToken } = (await login.json()) as { accessToken: string };

console.log(`Sending ${n} simultaneous requests for seat ${seatId} at showtime ${showtimeId}...`);

// Promise.all starts every request before awaiting any of them.
const started = performance.now();
const responses = await Promise.all(
  Array.from({ length: n }, () => post("/reservations", { showtimeId, seatIds: [seatId] }, accessToken)),
);
const elapsed = Math.round(performance.now() - started);

const tally = new Map<string, number>();
for (const res of responses) {
  const body = (await res.json()) as { error?: { code: string } };
  const key = `${res.status} ${body.error?.code ?? "OK"}`;
  tally.set(key, (tally.get(key) ?? 0) + 1);
}

console.log(`Done in ${elapsed} ms:`);
for (const [key, count] of [...tally].sort()) console.log(`  ${key.padEnd(24)} × ${count}`);

const successes = responses.filter((r) => r.status === 201).length;
console.log(
  successes === 1
    ? "✅ Exactly one booking succeeded."
    : `❌ ${successes} bookings succeeded for one seat: overbooking!`,
);
