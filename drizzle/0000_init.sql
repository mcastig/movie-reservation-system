CREATE TYPE "public"."reservation_status" AS ENUM('confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "genres" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "genres_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	CONSTRAINT "genres_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "halls" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "halls_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	CONSTRAINT "halls_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "movie_genres" (
	"movie_id" integer NOT NULL,
	"genre_id" integer NOT NULL,
	CONSTRAINT "movie_genres_movie_id_genre_id_pk" PRIMARY KEY("movie_id","genre_id")
);
--> statement-breakpoint
CREATE TABLE "movies" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "movies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" text NOT NULL,
	"description" text NOT NULL,
	"poster_url" text,
	"duration_minutes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movies_duration_positive" CHECK ("movies"."duration_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "reservation_seats" (
	"reservation_id" integer NOT NULL,
	"showtime_id" integer NOT NULL,
	"hall_id" integer NOT NULL,
	"seat_id" integer NOT NULL,
	"price_cents" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "reservation_seats_reservation_id_seat_id_pk" PRIMARY KEY("reservation_id","seat_id"),
	CONSTRAINT "reservation_seats_price_non_negative" CHECK ("reservation_seats"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reservations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"showtime_id" integer NOT NULL,
	"status" "reservation_status" DEFAULT 'confirmed' NOT NULL,
	"total_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "reservations_id_showtime_key" UNIQUE("id","showtime_id"),
	CONSTRAINT "reservations_total_non_negative" CHECK ("reservations"."total_cents" >= 0),
	CONSTRAINT "reservations_cancelled_at_matches_status" CHECK (("reservations"."status" = 'cancelled') = ("reservations"."cancelled_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "seats" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "seats_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"hall_id" integer NOT NULL,
	"row_label" text NOT NULL,
	"seat_number" integer NOT NULL,
	CONSTRAINT "seats_hall_row_number_key" UNIQUE("hall_id","row_label","seat_number"),
	CONSTRAINT "seats_id_hall_key" UNIQUE("id","hall_id"),
	CONSTRAINT "seats_number_positive" CHECK ("seats"."seat_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "showtimes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "showtimes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"movie_id" integer NOT NULL,
	"hall_id" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"price_cents" integer NOT NULL,
	CONSTRAINT "showtimes_id_hall_key" UNIQUE("id","hall_id"),
	CONSTRAINT "showtimes_ends_after_starts" CHECK ("showtimes"."ends_at" > "showtimes"."starts_at"),
	CONSTRAINT "showtimes_price_non_negative" CHECK ("showtimes"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "movie_genres" ADD CONSTRAINT "movie_genres_movie_id_movies_id_fk" FOREIGN KEY ("movie_id") REFERENCES "public"."movies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movie_genres" ADD CONSTRAINT "movie_genres_genre_id_genres_id_fk" FOREIGN KEY ("genre_id") REFERENCES "public"."genres"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_seats" ADD CONSTRAINT "reservation_seats_reservation_fk" FOREIGN KEY ("reservation_id","showtime_id") REFERENCES "public"."reservations"("id","showtime_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_seats" ADD CONSTRAINT "reservation_seats_showtime_hall_fk" FOREIGN KEY ("showtime_id","hall_id") REFERENCES "public"."showtimes"("id","hall_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_seats" ADD CONSTRAINT "reservation_seats_seat_hall_fk" FOREIGN KEY ("seat_id","hall_id") REFERENCES "public"."seats"("id","hall_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_showtime_id_showtimes_id_fk" FOREIGN KEY ("showtime_id") REFERENCES "public"."showtimes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seats" ADD CONSTRAINT "seats_hall_id_halls_id_fk" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showtimes" ADD CONSTRAINT "showtimes_movie_id_movies_id_fk" FOREIGN KEY ("movie_id") REFERENCES "public"."movies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showtimes" ADD CONSTRAINT "showtimes_hall_id_halls_id_fk" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "movie_genres_genre_id_idx" ON "movie_genres" USING btree ("genre_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_seats_one_active_per_seat" ON "reservation_seats" USING btree ("showtime_id","seat_id") WHERE "reservation_seats"."active";--> statement-breakpoint
CREATE INDEX "reservations_user_id_idx" ON "reservations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reservations_showtime_id_idx" ON "reservations" USING btree ("showtime_id");--> statement-breakpoint
CREATE INDEX "showtimes_starts_at_idx" ON "showtimes" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "showtimes_movie_id_idx" ON "showtimes" USING btree ("movie_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" USING btree (lower("email"));