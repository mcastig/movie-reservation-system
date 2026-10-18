-- Custom SQL migration file, put your code below! --

-- btree_gist lets a GiST index compare plain values like hall_id with "=",
-- so one constraint can mix equality (same hall) and overlap (time ranges).
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint

-- Two showtimes conflict when they share a hall AND their [starts_at, ends_at) ranges overlap.
-- '[)' means the end is exclusive, so a show ending at 20:00 and one starting at 20:00 are fine.
ALTER TABLE "showtimes"
  ADD CONSTRAINT "showtimes_no_overlap_in_hall"
  EXCLUDE USING gist (
    "hall_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  );
