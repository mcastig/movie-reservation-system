# Implementation Log

This file records **what was actually built** for each phase of [`PLAN.md`](PLAN.md), step by step:
the commands, the files, *why* each decision was made, and how to verify it.
`PLAN.md` is the map; this file is the journey.

## Progress

- [x] Phase 0: Foundations and setup
- [x] Phase 1: Data modeling
- [ ] Phase 2: Movies and genres CRUD
- [ ] Phase 3: Authentication and authorization
- [ ] Phase 4: Showtimes and scheduling
- [ ] Phase 5: Browsing and seat availability
- [ ] Phase 6: Reservations
- [ ] Phase 7: Admin reporting
- [ ] Phase 8: Testing
- [ ] Phase 9: Hardening
- [ ] Phase 10: Docker, CI and deploy
- [ ] Phase 11: Extensions

## Quick start

```bash
cp .env.example .env      # then set a real JWT_SECRET: openssl rand -base64 48
npm install
npm run db:up             # starts Postgres in Docker (Docker Desktop must be running)
npm run db:migrate        # creates the tables
npm run db:seed           # wipes and fills the tables with sample data
npm run dev               # API on http://localhost:3000, restarts on file changes
curl localhost:3000/health
```

| Script | What it does |
|--------|--------------|
| `npm run dev` | Runs the API with auto-reload (`tsx watch`) |
| `npm start` | Runs the API once, without watching |
| `npm run typecheck` | Checks types with `tsc` (no output files) |
| `npm run db:up` / `db:down` | Starts or stops the Postgres container |
| `npm run db:generate` | Compares `schema.ts` with the last migration and writes a new SQL migration |
| `npm run db:migrate` | Applies migrations that haven't run yet |
| `npm run db:seed` | Wipes every table and inserts sample data (refuses in production) |
| `npm run db:studio` | Opens Drizzle Studio, a browser GUI for the database |

---

## Phase 0: Foundations and setup ✅

**Goal:** an empty but well-structured project. One command starts the database, another
starts the API, and the app refuses to boot when its configuration is wrong.

### Files created

```
.
├── .env.example          # template of required settings (committed)
├── .env                  # your real local settings (NOT committed)
├── .gitignore
├── docker-compose.yml    # Postgres 17
├── package.json
├── tsconfig.json
└── src/
    ├── app.ts            # builds the Express app (no listen)
    ├── server.ts         # starts the HTTP server
    └── config/env.ts     # validates environment variables with Zod
```

### Step 1: `package.json` and dependencies

```bash
npm install express zod
npm install -D typescript tsx @types/express @types/node
```

| Package | Role |
|---------|------|
| `express` | The web framework: routing and middleware. |
| `zod` | Validates data at runtime. Here it checks env vars; later, request bodies. |
| `typescript` | Only used for **type-checking** (`npm run typecheck`). |
| `tsx` | Runs `.ts` files directly, so there's no build step during development. |
| `@types/*` | Type definitions for Express and Node. |

**Key line: `"type": "module"`.** It tells Node that our files use modern ES Module syntax
(`import`/`export`). This fixed the `TS1295` error from the first version of `app.ts`:
the file was written as an ES Module, but `package.json` said `"commonjs"`.

**Scripts use `--env-file-if-exists=.env`.** This is a built-in Node feature (no `dotenv` package needed)
that loads `.env` into `process.env` if the file exists. In production there's no `.env` file;
the hosting platform provides the variables directly.

### Step 2: `tsconfig.json`

The important options:

| Option | Why |
|--------|-----|
| `"module": "nodenext"` | Follow Node's real module rules exactly. |
| `"noEmit": true` | `tsc` only checks types; `tsx` runs the code. |
| `"allowImportingTsExtensions"` | Lets us write `import app from "./app.ts"`. ES Modules require the file extension. |
| `"verbatimModuleSyntax"` | Type-only imports must say `import { type X }`, so you always know what exists at runtime. |
| `"strict": true` | Turns on all the strict checks (e.g. `null` must be handled). |
| `"noUncheckedIndexedAccess"` | `array[0]` has the type `T \| undefined`, which forces you to handle "not found". You'll appreciate it with query results. |

### Step 3: `.gitignore`, `.env` and `.env.example`

- **`.env`** holds real secrets (`JWT_SECRET`) and is **ignored by git**. Never commit it.
- **`.env.example`** lists every variable with safe placeholder values and **is committed**,
  so a new developer knows what to set.
- The local `.env` got a random secret from `openssl rand -base64 48`.

### Step 4: `docker-compose.yml` (Postgres)

- Uses the `postgres:17-alpine` image. The user, password and DB name are all `movies` (fine for local development only).
- `ports: "5432:5432"` exposes it to your Mac so the API and DB GUIs can connect.
- A **named volume** (`pgdata`) keeps the data when the container restarts.
  `docker compose down -v` deletes the volume, which wipes the DB.
- The **healthcheck** (`pg_isready`) lets `docker compose up --wait` block until Postgres is ready to accept connections.

Connect with a GUI using `postgres://movies:movies@localhost:5432/movies`, or from the terminal:
```bash
docker compose exec db psql -U movies -d movies
```

### Step 5: `src/config/env.ts` (fail fast)

All settings are validated **once, at startup**, with a Zod schema:

```ts
DATABASE_URL: z.url(),
JWT_SECRET: z.string().min(32),
PORT: z.coerce.number().int().positive().default(3000),
```

- `z.coerce.number()`: env vars are always strings, so `"3000"` becomes `3000`.
- If validation fails, the app prints exactly what's wrong and exits with code 1.
- The rest of the code imports `env` (fully typed) instead of reading `process.env` everywhere.

**Why fail fast?** A missing `JWT_SECRET` found at startup is a 5-second fix.
Found in production, at the first login, it's an outage.

### Step 6: `src/app.ts` and `src/server.ts` (two separate files)

- `app.ts` **creates and configures** the app and exports it. It never calls `listen`.
- `server.ts` **imports it and starts** the HTTP server.

**Why split them?** In Phase 8, tests will `import app from "../src/app.ts"` and send requests
with Supertest, with no real port and no conflicts. One file, one responsibility.

`server.ts` also handles `SIGINT` (Ctrl+C) and `SIGTERM` (sent by Docker or the hosting platform)
by calling `server.close()`. This lets in-flight requests finish before the process exits (a *graceful shutdown*).

`app.ts` already registers `express.json()`, which parses JSON request bodies into `req.body`.
You'll need it in Phase 2.

### Verification (Phase 0 "done when")

| Check | Result |
|-------|--------|
| `npm run typecheck` | ✅ No errors |
| `npm run db:up` | ✅ `movies-db` container **healthy**; `select version()` shows PostgreSQL 17.9 |
| `npm run dev`, then `curl localhost:3000/health` | ✅ `{"status":"ok"}` |
| Unknown route `/nope` | ✅ 404 (Express default; Phase 2 adds a JSON error format) |
| Start with no env vars | ✅ Exits with code 1, listing `DATABASE_URL` and `JWT_SECRET` |

### Self-check answers

<details>
<summary>What's the difference between 200, 201, 204, 400, 401, 403, 404, 409 and 422?</summary>

- **200 OK**: success, with a body (e.g. `GET /movies`).
- **201 Created**: a resource was created (e.g. `POST /movies`). Often includes a `Location` header.
- **204 No Content**: success with no body (e.g. `DELETE /movies/1`).
- **400 Bad Request**: the request is malformed (invalid JSON, wrong types).
- **401 Unauthorized**: you aren't authenticated (no token, or the token is invalid or expired).
- **403 Forbidden**: you're authenticated but not allowed (a regular user trying an admin action).
- **404 Not Found**: the resource doesn't exist (or you aren't allowed to know it exists).
- **409 Conflict**: the request conflicts with the current state (seat already taken, overlapping showtime).
- **422 Unprocessable Content**: the syntax is valid but the content breaks a rule. Many APIs just use 400 for all validation errors; pick one and be consistent.
</details>

<details>
<summary>Why should the app crash at startup if config is missing?</summary>

Because the error appears immediately, in one obvious place, with a clear message, before any user is affected.
Otherwise it shows up later as a confusing `undefined` error deep inside a request.
</details>

### Try it yourself (practice)

1. Add `GET /version` that returns the `version` from `package.json`.
2. Change `PORT` in `.env` to `abc` and run `npm run dev`. Read the error.
3. Stop Postgres (`npm run db:down`). Does the API still start? Why? (Hint: nothing connects to the DB yet. That's Phase 1.)

---

## Phase 1: Data modeling ✅

**Goal:** the full database schema as code, applied with migrations, with sample data to explore.
The schema should make bad data **impossible**, not just unlikely.

### Files created

```
.
├── drizzle.config.ts                 # tells drizzle-kit where the schema and migrations live
├── drizzle/
│   ├── 0000_init.sql                 # generated from schema.ts
│   ├── 0001_showtimes_no_overlap.sql # hand-written: the exclusion constraint
│   └── meta/                         # drizzle-kit's snapshots (needed to diff the next change)
└── src/db/
    ├── schema.ts                     # every table, constraint and index
    ├── client.ts                     # connection pool + Drizzle instance
    └── seed.ts                       # sample data
```

### Step 1: dependencies

```bash
npm install drizzle-orm pg argon2
npm install -D drizzle-kit @types/pg
```

| Package | Role |
|---------|------|
| `drizzle-orm` | Builds type-safe SQL queries from TypeScript. Reads like SQL. |
| `pg` | The Postgres driver (node-postgres). Drizzle uses it to talk to the DB. |
| `drizzle-kit` | CLI: generates migrations from `schema.ts` and applies them. Dev-only. |
| `argon2` | Password hashing. Needed now because the seed creates users; Phase 3 uses it for login. |

npm warned that some install scripts were blocked (`esbuild`, `argon2`). Both work anyway, because they
ship prebuilt binaries. If one ever fails to load, run `npm install-scripts approve <pkg>`.

### Step 2: `drizzle.config.ts`

drizzle-kit is a separate program, so it doesn't get our scripts' `--env-file` flag.
The config calls `process.loadEnvFile()` (built into Node) to read `.env` itself, inside a `try`
so it doesn't crash where there is no `.env` (CI, production).

`tsconfig.json` now includes `drizzle.config.ts` so `npm run typecheck` checks it too.

### Step 3: `src/db/schema.ts` (the model)

```
users ─┐                       genres
       │ 1:N                     │ N:M (movie_genres)
       ▼                         ▼
 reservations ──N:1──► showtimes ◄──N:1── movies
       │ 1:N              │ N:1
       ▼                  ▼
reservation_seats ──N:1─► halls ◄──N:1── seats
```

Changes compared with the suggested model in `PLAN.md`, and why:

| Decision | Why |
|----------|-----|
| **`integer ... generated always as identity`** for ids | The modern standard replacement for `serial`. "Always" means you can't accidentally insert your own id. |
| **Postgres enums** for `role` and `status` | The DB rejects `'admn'` or `'canceled'`. In TypeScript they become `"user" \| "admin"`. |
| **Unique index on `lower(email)`** | A plain `UNIQUE(email)` would allow `Ana@x.com` and `ana@x.com` as two accounts. |
| **`poster_url` is nullable** | An admin can create the movie first and upload a poster after (Phase 2/11). |
| **`CHECK` constraints** (duration > 0, price ≥ 0, `ends_at > starts_at`...) | Cheap rules that stop garbage at the door, whatever code wrote it. |
| **`cancelled_at` must match `status`** | `CHECK ((status = 'cancelled') = (cancelled_at is not null))`: you can't have one without the other. |
| **`onDelete: "restrict"`** for showtimes → movies/halls and reservations → users/showtimes | Deleting a movie must not silently erase reservations and revenue history. Phase 2 will turn the error into a `409 Conflict`. |
| **`onDelete: "cascade"`** for movie_genres, seats, reservation_seats | These rows mean nothing without their parent. |
| **`reservation_seats` has a composite PK `(reservation_id, seat_id)`** instead of an `id` | A seat can appear only once per reservation, and nothing ever needs to point at a single row. |
| **`active` boolean on `reservation_seats`** | Makes the overbooking index possible (see below) while keeping cancelled seats as history. |
| **`hall_id` copied into `reservation_seats`** + 3 composite foreign keys | Proves that the seat and the showtime are in the **same hall**, and that the row's showtime is the reservation's showtime. |

#### The two "can't happen" guarantees

**1. No seat sold twice (partial unique index)**

```sql
CREATE UNIQUE INDEX reservation_seats_one_active_per_seat
  ON reservation_seats (showtime_id, seat_id) WHERE active;
```

A normal unique index would block rebooking a seat after a cancellation. The `WHERE active` part
means only *active* rows must be unique. Cancelling a reservation (Phase 6) means setting
`reservations.status = 'cancelled'` and `reservation_seats.active = false` in one transaction.
That frees the seat, and the history stays.

`status` lives on `reservations`, but an index can only look at its own table's columns.
That's why `active` is copied onto each seat row.

**2. No overlapping showtimes in a hall (exclusion constraint)**

```sql
EXCLUDE USING gist (hall_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
```

Read it as: "no two rows may have equal `hall_id` **and** overlapping time ranges." `&&` means "overlaps".
`'[)'` makes the end exclusive, so a show ending at 20:00 doesn't clash with one starting at 20:00.
It needs the `btree_gist` extension so a GiST index can also compare plain integers with `=`.

#### Composite foreign keys: why a showtime/seat pair can't be in different halls

A normal FK only checks that `seat_id` exists. Here:

```
(showtime_id, hall_id) → showtimes(id, hall_id)
(seat_id,     hall_id) → seats(id, hall_id)
```

Both use the **same** `hall_id` column, so the seat and the showtime are forced into the same hall.
A composite FK must point at columns with a `UNIQUE` constraint, which is why `seats`, `showtimes` and
`reservations` each have a `unique(id, ...)`. Those look redundant (`id` is already unique), but they're what
the FKs need.

#### Indexes

| Index | Serves |
|-------|--------|
| `showtimes(starts_at)` | "Showtimes on date X" (Phase 5) |
| `showtimes(movie_id)` | "Showtimes of movie X" |
| `reservations(user_id)` | "My reservations" (Phase 6) |
| `reservations(showtime_id)` | Reports per showtime (Phase 7) |
| `movie_genres(genre_id)` | "Movies in genre X". The PK covers `movie_id` lookups because it starts with `movie_id`. |
| Exclusion constraint's GiST index | Lookups by `hall_id` + time on `showtimes` |
| `reservation_seats` partial unique | "Which seats are taken for showtime X" (Phase 5) |

Postgres does **not** index foreign key columns automatically. That's why these are listed explicitly.

### Step 4: migrations

```bash
npm run db:generate -- --name init                          # → drizzle/0000_init.sql
npx drizzle-kit generate --custom --name showtimes_no_overlap  # → empty file to write SQL in
npm run db:migrate
```

- `generate` compares `schema.ts` with the last snapshot in `drizzle/meta/` and writes the SQL difference.
  **Always read the generated SQL** before applying it.
- Drizzle can't express `EXCLUDE` constraints, so `0001` is a **custom migration** written by hand.
- `migrate` records each applied file in the `drizzle.__drizzle_migrations` table, so it never runs one twice.
- Migrations are committed to git. Never edit one that has already been applied anywhere;
  write a new migration instead.

### Step 5: `src/db/client.ts`

Creates one `pg.Pool` for the whole app, wrapped by Drizzle. A pool keeps a few connections open
and reuses them, because opening a Postgres connection is slow (tens of milliseconds).
Passing `schema` enables Drizzle's relational queries API (`db.query.movies.findMany(...)`).

### Step 6: `src/db/seed.ts`

- **Idempotent:** it starts with `TRUNCATE ... RESTART IDENTITY CASCADE`, so running it twice gives the same result
  and ids start at 1 again.
- **One transaction:** if any insert fails, nothing is left half-seeded.
- **Refuses to run when `NODE_ENV=production`**, because it deletes everything.
- **Dates are relative to "tomorrow 00:00 UTC"**, so the showtimes are always in the future.
- The admin's login comes from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (optional, see `.env.example`).

What it creates:

| Data | Details |
|------|---------|
| Users | `admin@example.com` / `admin-password` (admin), `user@example.com` / `user-password` (user) |
| Genres | Action, Comedy, Drama, Sci-Fi, Animation |
| Movies | Inception, Spirited Away, The Grand Budapest Hotel (2 genres each) |
| Halls | Hall 1 (rows A–E × 8 = 40 seats), Hall 2 (rows A–D × 6 = 24 seats) |
| Showtimes | 4 per day for the next 3 days (12 total) |
| Reservations | The demo user holds seats A1 and A2 at showtime #1 |

### Verification (Phase 1 "done when")

| Check | Result |
|-------|--------|
| `npm run typecheck` | ✅ No errors |
| `npm run db:migrate` | ✅ 9 tables, 2 migrations recorded |
| `npm run db:seed` (twice) | ✅ Same output both times: 5 genres, 3 movies, 64 seats, 12 showtimes, 1 reservation |

Each constraint was then tested in `psql` with the seed data (inside rolled-back transactions):

| Attempt | Result |
|---------|--------|
| Overlapping showtime in the same hall | ❌ `violates exclusion constraint "showtimes_no_overlap_in_hall"` |
| Showtime starting exactly when another ends | ✅ Allowed (the `'[)'` range) |
| Book a seat that's already actively booked | ❌ `violates unique constraint "reservation_seats_one_active_per_seat"` |
| Cancel (set `active = false`), then rebook that seat | ✅ Allowed |
| Book a Hall 2 seat for a Hall 1 showtime | ❌ `violates foreign key constraint "reservation_seats_seat_hall_fk"` |
| Sign up `ADMIN@example.com` when `admin@example.com` exists | ❌ `violates unique constraint "users_email_lower_key"` |
| Set `status = 'cancelled'` without `cancelled_at` | ❌ `violates check constraint` |
| Delete a movie that has showtimes | ❌ `violates foreign key constraint` (restrict) |

To look at the data: `npm run db:studio`, a GUI with `postgres://movies:movies@localhost:5432/movies`, or
`docker compose exec db psql -U movies -d movies`.

### Self-check answers

<details>
<summary>Why is <code>movie_genres</code> a separate table?</summary>

Because the relationship is many-to-many. A `genre_id` column on `movies` would allow only one genre per movie,
and a list like `genres: "Action,Sci-Fi"` in one column can't be indexed or protected by a foreign key,
and renaming a genre would mean editing every movie. A join table stores one row per (movie, genre) pair:
that's normalization.
</details>

<details>
<summary>What happens if two requests insert the same <code>(showtime_id, seat_id)</code> at the same moment?</summary>

Postgres handles the unique index atomically. The first insert wins. The second one waits for the first
transaction to finish; if it commits, the second gets a unique violation (error code `23505`).
Phase 6 catches that code and returns `409 Conflict: seat already taken`.
</details>

<details>
<summary>Why do we trust the database constraint more than an <code>if</code> check in the code?</summary>

An `if (seatIsFree) insert()` has a gap between the check and the insert. Two requests can both see "free"
and both insert (a *race condition*). The constraint is checked inside the database at the moment of writing,
so there's no gap. It also protects against every other way data gets in: a buggy endpoint, a script,
or someone typing SQL by hand. The `if` is still useful for a friendly error message, but the constraint is the guarantee.
</details>

### Try it yourself (practice)

1. In `psql`, run `\d reservation_seats` and find each constraint from `schema.ts` in the output.
2. Run `explain select * from showtimes where starts_at >= now() and starts_at < now() + interval '1 day';`.
   With only 12 rows Postgres may choose a *Seq Scan* anyway, because reading a tiny table is cheaper than using the index.
3. Add a `rating` column (e.g. `PG-13`) to `movies` in `schema.ts`, run `npm run db:generate`, and read the SQL.
   Then delete the generated file and its snapshot/journal entry. You'll do changes like this for real later.
4. What would break if `reservation_seats` had no `hall_id` column? Try writing the bad insert from the table above without it.

### Next: Phase 2, movies and genres CRUD

Endpoints to list, create, update and delete movies and genres (no auth yet), with Zod validation
for request bodies, a central error handler, and the routes → service → database layering.
