import { hash } from "argon2";
import { sql } from "drizzle-orm";
import { env } from "../config/env.ts";
import { db, pool } from "./client.ts";
import {
  genres,
  halls,
  movieGenres,
  movies,
  reservationSeats,
  reservations,
  seats,
  showtimes,
  users,
} from "./schema.ts";

// Wipes every table and fills it with sample data. Safe to run again and again,
// which is why it must never touch a production database.
if (env.NODE_ENV === "production") {
  console.error("Refusing to seed a production database.");
  process.exit(1);
}

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "admin-password";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

// Tomorrow at 00:00 UTC, so showtimes are always in the future when you seed.
const now = new Date();
const tomorrow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);

// One transaction: either all the data goes in, or none of it does.
await db.transaction(async (tx) => {
  // RESTART IDENTITY resets the id counters so ids start at 1 again.
  await tx.execute(sql`
    truncate users, refresh_tokens, genres, movies, movie_genres, halls, seats,
             showtimes, reservations, reservation_seats
    restart identity cascade
  `);

  const [admin, demoUser] = await tx
    .insert(users)
    .values([
      {
        email: adminEmail,
        passwordHash: await hash(adminPassword),
        name: "Admin",
        role: "admin",
      },
      {
        email: "user@example.com",
        passwordHash: await hash("user-password"),
        name: "Demo User",
      },
    ])
    .returning();

  const genreRows = await tx
    .insert(genres)
    .values(["Action", "Comedy", "Drama", "Sci-Fi", "Animation"].map((name) => ({ name })))
    .returning();
  const genreId = (name: string) => genreRows.find((g) => g.name === name)!.id;

  const movieRows = await tx
    .insert(movies)
    .values([
      {
        title: "Inception",
        description: "A thief who steals secrets through dreams is given one last job.",
        posterUrl: "https://example.com/posters/inception.jpg",
        durationMinutes: 148,
      },
      {
        title: "Spirited Away",
        description: "A girl wanders into a world of spirits and must find her way home.",
        posterUrl: "https://example.com/posters/spirited-away.jpg",
        durationMinutes: 125,
      },
      {
        title: "The Grand Budapest Hotel",
        description: "A legendary concierge and his lobby boy are caught up in a theft.",
        posterUrl: "https://example.com/posters/grand-budapest.jpg",
        durationMinutes: 99,
      },
    ])
    .returning();
  const [inception, spiritedAway, budapest] = movieRows as [
    (typeof movieRows)[number],
    (typeof movieRows)[number],
    (typeof movieRows)[number],
  ];

  await tx.insert(movieGenres).values([
    { movieId: inception.id, genreId: genreId("Action") },
    { movieId: inception.id, genreId: genreId("Sci-Fi") },
    { movieId: spiritedAway.id, genreId: genreId("Animation") },
    { movieId: spiritedAway.id, genreId: genreId("Drama") },
    { movieId: budapest.id, genreId: genreId("Comedy") },
    { movieId: budapest.id, genreId: genreId("Drama") },
  ]);

  // Hall 1: rows A–E with 8 seats each. Hall 2: rows A–D with 6 seats each.
  const [hall1, hall2] = await tx
    .insert(halls)
    .values([{ name: "Hall 1" }, { name: "Hall 2" }])
    .returning();
  const layout = [
    { hall: hall1!, rows: ["A", "B", "C", "D", "E"], perRow: 8 },
    { hall: hall2!, rows: ["A", "B", "C", "D"], perRow: 6 },
  ];
  const seatRows = await tx
    .insert(seats)
    .values(
      layout.flatMap(({ hall, rows, perRow }) =>
        rows.flatMap((rowLabel) =>
          Array.from({ length: perRow }, (_, i) => ({
            hallId: hall.id,
            rowLabel,
            seatNumber: i + 1,
          })),
        ),
      ),
    )
    .returning();

  // Three days of showtimes. ends_at = starts_at + duration, and the times are
  // spaced so no two showtimes overlap in the same hall.
  const schedule = [
    { movie: inception, hall: hall1!, hourUtc: 14, priceCents: 1200 },
    { movie: budapest, hall: hall1!, hourUtc: 18, priceCents: 1000 },
    { movie: spiritedAway, hall: hall2!, hourUtc: 15, priceCents: 900 },
    { movie: inception, hall: hall2!, hourUtc: 19, priceCents: 1400 },
  ];
  const showtimeRows = await tx
    .insert(showtimes)
    .values(
      [0, 1, 2].flatMap((day) =>
        schedule.map(({ movie, hall, hourUtc, priceCents }) => {
          const startsAt = new Date(tomorrow + day * 24 * HOUR + hourUtc * HOUR);
          return {
            movieId: movie.id,
            hallId: hall.id,
            startsAt,
            endsAt: new Date(startsAt.getTime() + movie.durationMinutes * MINUTE),
            priceCents,
          };
        }),
      ),
    )
    .returning();

  // One sample booking: the demo user takes seats A1 and A2 at the first showtime.
  const firstShowtime = showtimeRows[0]!;
  const bookedSeats = seatRows.filter(
    (s) => s.hallId === firstShowtime.hallId && s.rowLabel === "A" && s.seatNumber <= 2,
  );
  const [reservation] = await tx
    .insert(reservations)
    .values({
      userId: demoUser!.id,
      showtimeId: firstShowtime.id,
      totalCents: firstShowtime.priceCents * bookedSeats.length,
    })
    .returning();
  await tx.insert(reservationSeats).values(
    bookedSeats.map((seat) => ({
      reservationId: reservation!.id,
      showtimeId: firstShowtime.id,
      hallId: firstShowtime.hallId,
      seatId: seat.id,
      priceCents: firstShowtime.priceCents,
    })),
  );

  console.log(
    `Seeded: ${genreRows.length} genres, ${movieRows.length} movies, 2 halls, ` +
      `${seatRows.length} seats, ${showtimeRows.length} showtimes, 1 reservation.`,
  );
  console.log(`Admin login: ${admin!.email} / ${adminPassword}`);
});

await pool.end();
