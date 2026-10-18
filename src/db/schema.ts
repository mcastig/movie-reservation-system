import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Shorthand: every timestamp is timestamptz, stored in UTC.
const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const userRole = pgEnum("user_role", ["user", "admin"]);
export const reservationStatus = pgEnum("reservation_status", ["confirmed", "cancelled"]);

export const users = pgTable(
  "users",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    role: userRole("role").notNull().default("user"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    // Unique on lower(email) so "Ana@x.com" and "ana@x.com" can't both sign up.
    uniqueIndex("users_email_lower_key").on(sql`lower(${t.email})`),
  ],
);

// One row per refresh token handed out. Only a SHA-256 hash is stored, so a
// leaked database dump can't be used to log in. revoked_at is set on logout and
// when the token is exchanged for a new one (rotation).
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamptz("expires_at").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    revokedAt: timestamptz("revoked_at"),
  },
  (t) => [index("refresh_tokens_user_id_idx").on(t.userId)],
);

export const genres = pgTable("genres", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull().unique(),
});

export const movies = pgTable(
  "movies",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    // Nullable: an admin can create the movie first and upload the poster after.
    posterUrl: text("poster_url"),
    durationMinutes: integer("duration_minutes").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [check("movies_duration_positive", sql`${t.durationMinutes} > 0`)],
);

// N:M join table. A movie has many genres and a genre has many movies.
export const movieGenres = pgTable(
  "movie_genres",
  {
    movieId: integer("movie_id")
      .notNull()
      .references(() => movies.id, { onDelete: "cascade" }),
    genreId: integer("genre_id")
      .notNull()
      .references(() => genres.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.movieId, t.genreId] }),
    // The PK index starts with movie_id; this one serves "movies in genre X".
    index("movie_genres_genre_id_idx").on(t.genreId),
  ],
);

export const halls = pgTable("halls", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull().unique(),
});

export const seats = pgTable(
  "seats",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    hallId: integer("hall_id")
      .notNull()
      .references(() => halls.id, { onDelete: "cascade" }),
    rowLabel: text("row_label").notNull(),
    seatNumber: integer("seat_number").notNull(),
  },
  (t) => [
    unique("seats_hall_row_number_key").on(t.hallId, t.rowLabel, t.seatNumber),
    // Target for the composite FK in reservation_seats: proves a seat belongs to a hall.
    unique("seats_id_hall_key").on(t.id, t.hallId),
    check("seats_number_positive", sql`${t.seatNumber} > 0`),
  ],
);

// Overlapping showtimes in the same hall are blocked by an exclusion constraint
// that Drizzle can't express; it lives in a custom migration (see drizzle/).
export const showtimes = pgTable(
  "showtimes",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    // restrict: a movie or hall with showtimes can't be deleted, which protects
    // reservation history and revenue reports.
    movieId: integer("movie_id")
      .notNull()
      .references(() => movies.id, { onDelete: "restrict" }),
    hallId: integer("hall_id")
      .notNull()
      .references(() => halls.id, { onDelete: "restrict" }),
    startsAt: timestamptz("starts_at").notNull(),
    endsAt: timestamptz("ends_at").notNull(),
    priceCents: integer("price_cents").notNull(),
  },
  (t) => [
    unique("showtimes_id_hall_key").on(t.id, t.hallId),
    check("showtimes_ends_after_starts", sql`${t.endsAt} > ${t.startsAt}`),
    check("showtimes_price_non_negative", sql`${t.priceCents} >= 0`),
    index("showtimes_starts_at_idx").on(t.startsAt),
    index("showtimes_movie_id_idx").on(t.movieId),
  ],
);

export const reservations = pgTable(
  "reservations",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    showtimeId: integer("showtime_id")
      .notNull()
      .references(() => showtimes.id, { onDelete: "restrict" }),
    status: reservationStatus("status").notNull().default("confirmed"),
    totalCents: integer("total_cents").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    cancelledAt: timestamptz("cancelled_at"),
  },
  (t) => [
    unique("reservations_id_showtime_key").on(t.id, t.showtimeId),
    check("reservations_total_non_negative", sql`${t.totalCents} >= 0`),
    // cancelled_at is set exactly when the status is 'cancelled'.
    check(
      "reservations_cancelled_at_matches_status",
      sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`,
    ),
    index("reservations_user_id_idx").on(t.userId),
    index("reservations_showtime_id_idx").on(t.showtimeId),
  ],
);

// One row per seat in a reservation. showtime_id and hall_id are copied here so
// the database itself can check that everything matches and no seat is sold twice.
export const reservationSeats = pgTable(
  "reservation_seats",
  {
    reservationId: integer("reservation_id").notNull(),
    showtimeId: integer("showtime_id").notNull(),
    hallId: integer("hall_id").notNull(),
    seatId: integer("seat_id").notNull(),
    // Copied from the showtime at booking time, so editing the price later
    // doesn't rewrite past revenue.
    priceCents: integer("price_cents").notNull(),
    // Set to false when the reservation is cancelled, freeing the seat.
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    primaryKey({ columns: [t.reservationId, t.seatId] }),
    // The row's showtime must be the reservation's showtime...
    foreignKey({
      name: "reservation_seats_reservation_fk",
      columns: [t.reservationId, t.showtimeId],
      foreignColumns: [reservations.id, reservations.showtimeId],
    }).onDelete("cascade"),
    // ...that showtime must be in this hall...
    foreignKey({
      name: "reservation_seats_showtime_hall_fk",
      columns: [t.showtimeId, t.hallId],
      foreignColumns: [showtimes.id, showtimes.hallId],
    }),
    // ...and the seat must be in the same hall.
    foreignKey({
      name: "reservation_seats_seat_hall_fk",
      columns: [t.seatId, t.hallId],
      foreignColumns: [seats.id, seats.hallId],
    }),
    // The overbooking guard: at most one active booking per seat per showtime.
    uniqueIndex("reservation_seats_one_active_per_seat")
      .on(t.showtimeId, t.seatId)
      .where(sql`${t.active}`),
    check("reservation_seats_price_non_negative", sql`${t.priceCents} >= 0`),
  ],
);
