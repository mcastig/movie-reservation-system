import { sql, type SQL } from "drizzle-orm";
import request from "supertest";
import app from "../../src/app.ts";
import { db } from "../../src/db/client.ts";

// Supertest sends real HTTP requests to the Express app without a fixed port:
// this is why app.ts never calls listen() (Phase 0).
export const api = () => request(app);

export async function tokenFor(email: string, password: string): Promise<string> {
  const res = await api().post("/auth/login").send({ email, password }).expect(200);
  return res.body.accessToken;
}

export const adminToken = () => tokenFor("admin@example.com", "admin-password");
export const userToken = () => tokenFor("user@example.com", "user-password");

export async function signUpAndLogIn(email: string, name = "Test User") {
  const password = "test-password";
  await api().post("/auth/signup").send({ email, password, name }).expect(201);
  return tokenFor(email, password);
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

// --- The seed's layout (ids are always the same, see src/db/fixtures.ts) ---
//
// Showtimes (UTC), repeated for 3 days: ids 1-4 tomorrow, 5-8 the day after, 9-12 after that.
//   1: Inception      Hall 1  14:00  1200     2: Grand Budapest  Hall 1  18:00  1000
//   3: Spirited Away  Hall 2  15:00   900     4: Inception       Hall 2  19:00  1400
// Seats: Hall 1 rows A-E x 8 (ids 1-40), Hall 2 rows A-D x 6 (ids 41-64).
// The demo user (id 2) has reservation 1: seats A1 + A2 at showtime 1.

export function seatId(hall: 1 | 2, label: string): number {
  const row = label.charCodeAt(0) - "A".charCodeAt(0);
  const number = Number(label.slice(1));
  return hall === 1 ? row * 8 + number : 40 + row * 6 + number;
}

// A calendar day relative to today in UTC, as "YYYY-MM-DD" (1 = tomorrow).
export function utcDay(offset: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset))
    .toISOString()
    .slice(0, 10);
}

// An instant like "2026-10-19T14:00:00Z" on that day.
export const utcAt = (dayOffset: number, time: string) => `${utcDay(dayOffset)}T${time}:00Z`;

// Run SQL directly, for things the API can't do (like a showtime in the past).
export async function query<T extends Record<string, unknown>>(statement: SQL) {
  const { rows } = await db.execute<T>(statement);
  return rows;
}

// A showtime and a confirmed reservation that already started, inserted behind the API's back.
export async function insertPastShowtimeWithReservation(userId = 2) {
  const [showtime] = await query<{ id: number }>(sql`
    insert into showtimes (movie_id, hall_id, starts_at, ends_at, price_cents)
    values (3, 2, now() - interval '3 hours', now() - interval '1 hour', 900) returning id`);
  const [reservation] = await query<{ id: number }>(sql`
    insert into reservations (user_id, showtime_id, total_cents)
    values (${userId}, ${showtime!.id}, 900) returning id`);
  await query(sql`
    insert into reservation_seats (reservation_id, showtime_id, hall_id, seat_id, price_cents)
    values (${reservation!.id}, ${showtime!.id}, 2, ${seatId(2, "A1")}, 900)`);
  return { showtimeId: showtime!.id, reservationId: reservation!.id };
}
