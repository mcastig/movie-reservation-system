# Implementation Log

This file records **what was actually built** for each phase of [`PLAN.md`](PLAN.md), step by step:
the commands, the files, *why* each decision was made, and how to verify it.
`PLAN.md` is the map; this file is the journey.

## Progress

- [x] Phase 0: Foundations and setup
- [x] Phase 1: Data modeling
- [x] Phase 2: Movies and genres CRUD
- [x] Phase 3: Authentication and authorization
- [x] Phase 4: Showtimes and scheduling
- [x] Phase 5: Browsing and seat availability
- [x] Phase 6: Reservations
- [x] Phase 7: Admin reporting
- [x] Phase 8: Testing
- [x] Phase 9: Hardening
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
open http://localhost:3000/docs   # interactive API docs (Swagger UI)
npm test                  # 84 tests; creates and migrates a separate movies_test database
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
| `npm test` | Runs every unit and integration test once (`vitest run`) |
| `npm run test:watch` | Re-runs tests as you edit files |
| `npm run test:unit` | Only the unit tests (no database needed) |
| `npm run race` | The Phase 6 concurrency experiment: 20 simultaneous bookings for one seat (API must be running) |

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

---

## Phase 2: Movies and genres CRUD ✅

**Goal:** the first real endpoints, with every request validated and every error returned in one consistent
JSON shape. No auth yet: anyone can write (Phase 3 locks the write endpoints to admins).

### Files created

```
.
├── requests.http                 # sample requests for VS Code REST Client / Bruno / Postman
└── src/
    ├── app.ts                    # now mounts the routers + notFound + errorHandler
    ├── lib/
    │   ├── errors.ts             # AppError and friends, isPgError()
    │   └── schemas.ts            # shared Zod pieces: id params, pagination
    ├── middleware/
    │   ├── validate.ts           # validate({ params, query, body })
    │   └── errorHandler.ts       # notFound + errorHandler
    └── modules/
        ├── genres/               # genres.routes.ts, genres.service.ts, genres.schemas.ts
        └── movies/               # movies.routes.ts, movies.service.ts, movies.schemas.ts
```

### Endpoints

| Method | Path | Success | Errors |
|--------|------|---------|--------|
| `GET` | `/genres` | 200, array sorted by name | |
| `POST` | `/genres` | 201, the new genre | 400 invalid, 409 `GENRE_EXISTS` |
| `GET` | `/movies?page=&limit=&genre=` | 200, `{ data, pagination }` | 400 invalid query |
| `GET` | `/movies/:id` | 200, the movie with its genres | 400 bad id, 404 |
| `POST` | `/movies` | 201 + `Location` header | 400 invalid / unknown genre |
| `PATCH` | `/movies/:id` | 200, the updated movie | 400, 404 |
| `DELETE` | `/movies/:id` | 204, no body | 404, 409 `MOVIE_HAS_SHOWTIMES` |
| *anything else* | | | 404 `NOT_FOUND` |

A movie looks like this (`genres` is always included):

```json
{ "id": 1, "title": "Inception", "description": "...", "posterUrl": "https://...",
  "durationMinutes": 148, "createdAt": "2026-10-18T00:09:26.741Z",
  "genres": [{ "id": 1, "name": "Action" }, { "id": 4, "name": "Sci-Fi" }] }
```

### Step 1: the layering (routes → service → database)

```
HTTP request
  → validate()                 checks params/query/body, or calls next(ValidationError)
  → route handler              reads the parsed input, calls the service, picks the status code
  → service                    business rules + Drizzle queries; throws AppErrors
  → errorHandler               turns any thrown error into { error: { code, message } }
```

- **Routes** know HTTP (status codes, headers) but no SQL.
- **Services** know the rules and the database but nothing about `req`/`res`. They can be reused by other
  services or tested without a server.
- In this small app the service also runs the queries. A separate "repository" layer can come later if a service grows.

**Express 5 catches async errors.** If an `async` handler throws (or a promise rejects), Express 5 passes
the error to the error handler by itself. Express 4 needed a wrapper like `asyncHandler()` or a `try/catch`
in every route, otherwise the request would hang.

### Step 2: `src/lib/errors.ts`

```ts
throw new NotFoundError(`Movie ${id} not found`);       // → 404 NOT_FOUND
throw new ConflictError("GENRE_EXISTS", "...");          // → 409 GENRE_EXISTS
throw new ValidationError([{ path, message }]);          // → 400 VALIDATION_ERROR + details
```

All of them extend `AppError`, which carries `status`, `code` and an optional `details`.
The **`code`** is for programs (a frontend can `switch` on `GENRE_EXISTS`); the **`message`** is for humans and may change.

The classes declare their fields explicitly instead of using `constructor(readonly status: number)`.
That shorthand ("parameter properties") generates extra JavaScript, which `erasableSyntaxOnly` in `tsconfig.json` forbids.

**`isPgError(err, code)`**: Drizzle wraps driver errors in a `DrizzleQueryError` and puts the real Postgres error
(the one with `code: "23505"`) in `err.cause`. This was found by probing:
`DrizzleQueryError | code: undefined | cause: DatabaseError 23503`. So the helper walks the `cause` chain.

### Step 3: `src/middleware/validate.ts`

```ts
moviesRouter.patch("/:id", validate({ params: idParams, body: updateMovieBody }), async (req, res) => {
  req.params.id   // number, not string
  req.body.title  // string | undefined
});
```

- It validates all three parts and reports **every** problem in one response, not just the first.
- On success it **replaces** each part with Zod's output: `"42"` becomes `42`, strings are trimmed,
  defaults like `page = 1` are filled in.
- **Types flow through.** `validate()` returns a `RequestHandler` whose generics are the schemas' output types,
  and TypeScript gives the next handler the same types. This was checked with a throwaway file where
  `const a: string = req.params.id` failed to compile.
- **The Express 5 gotcha:** `req.query` is now a getter, so `req.query = parsed` throws.
  `Object.defineProperty(req, "query", { value })` defines an own property on that request, which hides the getter.

### Step 4: `src/middleware/errorHandler.ts`

Express recognizes an error handler because it has **four** parameters `(err, req, res, next)`.
It's registered last in `app.ts`, after `notFound`, which turns any unmatched route into a 404.

What it does with each kind of error:

| Error | Response |
|-------|----------|
| `AppError` (ours) | its own status, code, message, details |
| `express.json()` couldn't parse the body | 400 `INVALID_JSON` |
| Other 4xx from Express/body-parser (e.g. 413 body too large) | that status, `BAD_REQUEST` |
| Postgres unique / FK violation that no service translated | 409 `CONFLICT` (safety net) |
| Anything else | logged with `console.error`; client gets 500 `INTERNAL_ERROR` with **no details** |

Never send stack traces or SQL errors to clients. They help attackers and confuse users.

### Step 5: Zod schemas

| Choice | Why |
|--------|-----|
| `z.strictObject` for bodies | `{ "nmae": "X" }` gives `Unrecognized key: "nmae"` instead of being silently dropped. |
| `.trim()` on strings | `"  Thriller "` is stored as `"Thriller"`, and `"   "` fails `min(1)`. |
| `z.coerce.number()` for params and query | They're always strings in the URL. Bodies are JSON, so they use plain `z.number()`: `"116"` (a string) is rejected there. |
| `z.url({ protocol: /^https?$/ })` | Accepts only http(s) URLs, so `javascript:alert(1)` is rejected. |
| `genreIds` deduplicated with `.transform` | `[4, 3, 4]` → `[4, 3]`; a duplicate would break the `movie_genres` primary key. |
| `.partial()` + `.refine()` for PATCH | Every field optional, but `{}` is a 400: an empty update is almost always a client bug. |
| `limit` max 100 | So nobody can ask for a million rows in one request. |

### Step 6: the services

**Genres: insert first, translate the error.** `createGenre` doesn't check "does this name exist?" first.
Two requests could both pass that check (the race from the Phase 1 self-check). It inserts, and if the
unique constraint fires, it throws `ConflictError("GENRE_EXISTS")`.

**Movies: list with pagination and genre filter.**

```ts
const [rows, total] = await Promise.all([pageQuery, db.$count(movies, where)]);
```

- **Offset pagination:** `LIMIT 20 OFFSET (page - 1) * 20`. Simple, and lets you jump to page 7. (On huge tables
  big offsets get slow; *cursor* pagination fixes that. Not needed here.)
- **Stable order:** `ORDER BY title, id`. Without the `id` tie-breaker, two movies with the same title could swap
  between pages.
- **The genre filter uses `EXISTS`**, not a `JOIN`. A join to `movie_genres` would return a movie once per
  matching row, which breaks counts and pages.
- The page query and the count run **in parallel** with `Promise.all`.

**Avoiding N+1 queries.** Listing 20 movies and then fetching genres for each one is 1 + 20 queries.
`genresByMovie()` loads the genres for **all** listed movies in one query (`WHERE movie_id IN (...)`) and groups them
in a `Map`. Always 2 queries, whatever the page size.

**Create and update use a transaction**, so a movie is never saved without its genres (or the other way round).
`genreIds` in a PATCH **replaces** the whole list: the service deletes the movie's `movie_genres` rows and
inserts the new ones. Leaving `genreIds` out keeps the current genres.

**Unknown genre ids are checked explicitly.** The foreign key would reject them too, but its error can't say
*which* ids are wrong. `assertGenresExist` returns `Unknown genre id(s): 99`.

**Delete rule (self-check question):** *a movie with any showtimes, past or future, can't be deleted.*
Past showtimes hold reservation and revenue history, and future ones hold bookings people paid for.
The database already enforces this (`ON DELETE RESTRICT` from Phase 1). The service tries the delete and turns
the FK violation into `409 MOVIE_HAS_SHOWTIMES`. To remove such a movie, delete its showtimes first (Phase 4 rules apply).

### Verification (Phase 2 "done when")

`npm run typecheck` passes. Then every endpoint was called with `curl` against a freshly seeded database:

| Request | Result |
|---------|--------|
| `GET /genres` | ✅ 200, 5 genres sorted by name |
| `POST /genres {"name":"  Thriller "}` | ✅ 201, stored as `"Thriller"` |
| `POST /genres` same name again | ✅ 409 `GENRE_EXISTS` |
| `POST /genres {"nmae":"X"}` | ✅ 400, two details: `name` missing, `nmae` unrecognized |
| `GET /movies?limit=2` | ✅ 200, 2 movies with genres, `total: 3, totalPages: 2` |
| `GET /movies?genre=5` | ✅ 200, only *Spirited Away* |
| `GET /movies?page=0&limit=500&genre=abc` | ✅ 400, three details at once |
| `GET /movies/2` / `999` / `abc` | ✅ 200 / 404 / 400 |
| `POST /movies` valid, `genreIds: [4,3,4]` | ✅ 201, `Location: /movies/4`, 2 genres (duplicate removed) |
| `POST /movies` with `javascript:` URL, empty title, negative duration | ✅ 400, every field reported |
| `POST /movies` with `genreIds: [1, 99]` | ✅ 400 `Unknown genre id(s): 99` |
| `POST /movies` with malformed JSON | ✅ 400 `INVALID_JSON` |
| `PATCH /movies/4` title + genres | ✅ 200, genres replaced |
| `PATCH /movies/4 {}` / `PATCH /movies/999` | ✅ 400 / 404 |
| `DELETE /movies/1` (has showtimes) | ✅ 409 `MOVIE_HAS_SHOWTIMES` |
| `DELETE /movies/4`, then again | ✅ 204, then 404 |
| `GET /nope` | ✅ 404 JSON (Phase 0's HTML 404 is gone) |

To try them yourself: `npm run dev`, then open `requests.http` with the VS Code **REST Client** extension
(or use `curl` / Bruno / Postman). Run `npm run db:seed` afterwards to reset the data.

### Self-check answers

<details>
<summary>Why use <code>PATCH</code> and not <code>PUT</code> for partial updates?</summary>

`PUT` means "replace the resource with this": the client sends the **whole** movie, and a missing field means
"clear it". `PATCH` means "change only these fields". To rename a movie with `PUT` you'd have to resend the description,
duration, poster and genres too, and if two people edit different fields at the same time, the second `PUT` silently
undoes the first one's change. `PATCH { "title": "..." }` touches only the title.
</details>

<details>
<summary>What should <code>DELETE /movies/:id</code> do if the movie has future showtimes with reservations?</summary>

Here: **refuse with 409.** Deleting it would cancel paid bookings without telling anyone and erase revenue history.
The admin must handle the showtimes first (cancel them and notify users, Phase 4/6).
Other valid rules exist: a *soft delete* (`archived_at` column, hidden from listings, history kept) is common in
real systems. What matters is picking one rule and having the database enforce it.
</details>

### Try it yourself (practice)

1. Add `GET /genres/:id/movies` that reuses `listMovies({ genre: id, ... })`.
2. Make `POST /genres` treat `"action"` and `"Action"` as duplicates. (Hint: a unique index on `lower(name)` and a migration, like `users.email`.)
3. Add `DELETE /genres/:id`. What happens to `movie_genres` rows? (Check the FK's `onDelete` in `schema.ts`.)
4. Add a `?search=` query param that matches titles with `ilike`. What happens if someone sends `%`?
5. Throw `new Error("boom")` in a route and call it. Check that the client gets a plain 500 and the terminal shows the stack.

---

## Phase 3: Authentication and authorization ✅

**Goal:** users can sign up and log in. Reading the catalog stays public, but changing it requires an admin.
Two different questions, answered by two different middlewares:

- **Authentication**: *who are you?* → `authenticate` (no valid token → **401**)
- **Authorization**: *what may you do?* → `requireRole("admin")` (wrong role → **403**)

### Files created or changed

```
.
├── drizzle/0002_refresh_tokens.sql   # new table
└── src/
    ├── config/env.ts                 # + ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_DAYS
    ├── db/schema.ts                  # + refresh_tokens
    ├── lib/errors.ts                 # + UnauthorizedError (401), ForbiddenError (403)
    ├── middleware/auth.ts            # authenticate, requireRole
    └── modules/
        ├── auth/                     # signup, login, refresh, logout + tokens.ts
        ├── users/                    # GET /me, PATCH /users/:id/role
        ├── genres/genres.routes.ts   # POST now admin only
        └── movies/movies.routes.ts   # POST, PATCH, DELETE now admin only
```

### Endpoints

| Method | Path | Auth | Success | Errors |
|--------|------|------|---------|--------|
| `POST` | `/auth/signup` | – | 201, the user | 400, 409 `EMAIL_TAKEN` |
| `POST` | `/auth/login` | – | 200, tokens | 401 `INVALID_CREDENTIALS` |
| `POST` | `/auth/refresh` | – | 200, a **new** pair of tokens | 401 `INVALID_REFRESH_TOKEN` |
| `POST` | `/auth/logout` | – | 204 (always) | |
| `GET` | `/me` | user | 200, the current user | 401 |
| `PATCH` | `/users/:id/role` | admin | 200, the updated user | 401, 403, 404 |
| `POST` | `/genres` | admin | (Phase 2) | + 401, 403 |
| `POST` / `PATCH` / `DELETE` | `/movies...` | admin | (Phase 2) | + 401, 403 |

A login response:

```json
{ "tokenType": "Bearer", "accessToken": "eyJhbGciOi...", "expiresIn": 900, "refreshToken": "YH_Og5hn..." }
```

### Step 1: dependencies

```bash
npm install jsonwebtoken
npm install -D @types/jsonwebtoken
```

`argon2` was already installed in Phase 1 for the seed.

`npm audit` now reports 4 *moderate* issues. All come from an old `esbuild` deep inside `drizzle-kit`. The advisory
is about esbuild's development web server, which drizzle-kit never starts, and drizzle-kit is a dev tool that isn't
part of the running API. The suggested `npm audit fix --force` would **downgrade** drizzle-kit to 0.18, so it was ignored.
Always read an advisory before "fixing" it.

### Step 2: two kinds of tokens

| | Access token | Refresh token |
|---|---|---|
| What it is | A signed **JWT** | 32 random bytes (base64url) |
| Lifetime | 15 minutes | 7 days |
| Sent on | Every API request: `Authorization: Bearer <token>` | Only to `/auth/refresh` and `/auth/logout` |
| Checked by | Verifying the signature (**no DB query**) | Looking up its hash in `refresh_tokens` |
| Can be revoked? | No: it's valid until it expires | Yes: set `revoked_at` |

**Why two?** A JWT is fast to check (no database), but you can't take it back once issued. So it's kept short-lived.
The refresh token lives longer but **is** in the database, so logout and "kick this user out" work.
Together: fast requests, and at most 15 minutes of exposure if an access token leaks.

**What's inside the JWT** (`src/modules/auth/tokens.ts`):

```json
{ "role": "user", "sub": "3", "iat": 1792282750, "exp": 1792283650 }
```

`sub` (subject) is the user id, `iat` is *issued at* and `exp` is *expires*. It's signed with `JWT_SECRET` using HS256.

- **`algorithms: ["HS256"]` is pinned when verifying.** Otherwise a forged token with header `"alg": "none"` (no signature)
  could be accepted by a careless library. It was tested: rejected.
- **The payload is validated with Zod** after the signature check, so a token that is correctly signed but has the
  wrong shape still can't produce a weird `req.user`.

**Refresh tokens are stored as SHA-256 hashes.** If the database leaked, the hashes couldn't be used to log in.
SHA-256 is fine here (passwords need argon2) because the token is 256 random bits: there's nothing to guess, so slow hashing
adds nothing.

### Step 3: `refresh_tokens` table (migration `0002`)

```
refresh_tokens (id, user_id FK → users ON DELETE CASCADE, token_hash UNIQUE, expires_at, created_at, revoked_at)
```

One row per login or refresh. `revoked_at` is set when the token is used (rotation), on logout, or when reuse is detected.

### Step 4: the auth service

**Sign up**
- The email is trimmed and lowercased in the Zod schema, so `" Ana@Example.COM "` is stored as `ana@example.com`.
- The password is hashed with argon2id (the library's defaults: 64 MiB memory, 3 iterations).
- **`role` is always `"user"`.** The schema is a `strictObject`, so sending `"role": "admin"` is a 400, and the service
  hard-codes `role: "user"` anyway: two layers.
- Duplicate email → the unique index on `lower(email)` fires → `409 EMAIL_TAKEN`.

**Log in**
- One message for both failures: `Invalid email or password`. Saying "email not found" would let anyone check
  which emails have accounts (*user enumeration*).
- **Same timing for both failures.** argon2 is deliberately slow (~25 ms). If an unknown email returned instantly,
  the response *time* would leak what the message hides. So for unknown emails the service still runs `verify()`
  against a dummy hash. Measured: wrong password ≈ 27 ms, unknown email ≈ 27 ms.
- Signup *does* reveal that an email is taken (409). That's a common trade-off: the alternative is
  "check your inbox" flows with email verification (Phase 11).

**Refresh, with rotation and reuse detection**

```
login        → R0
refresh(R0)  → R0 revoked, R1 issued
refresh(R0)  → R0 is already revoked: someone is replaying it!
               → revoke ALL of this user's refresh tokens (R1 too) → 401
```

If an attacker steals R0 and uses it, the real user's next refresh fails, or the other way round. Either way the
second use of R0 is the alarm, and both sessions end. The user has to log in again, which the attacker can't do.

Two details in the code:
- **Revoke-and-check is one `UPDATE ... WHERE revoked_at IS NULL AND expires_at > now() RETURNING`.** If two requests
  race with the same token, only one can match the row. (Same idea as the seat constraint: let the database decide.)
- **The reuse branch returns `null` instead of throwing inside the transaction.** A throw would roll back the
  "revoke all sessions" update. The error is thrown after the transaction commits.
- **The role is read from the database at refresh time,** not copied from the old token. So promotions and demotions
  take effect at the next refresh (within 15 minutes) or the next login.

**Log out** revokes that refresh token and always returns 204, even for an unknown token (logging out twice isn't an error).
The **access token keeps working until it expires**: that's the price of checking JWTs without the database. A deny-list
in Redis is the usual fix if that's not acceptable (Phase 11).

### Step 5: `src/middleware/auth.ts`

```ts
moviesRouter.patch("/:id", authenticate, requireRole("admin"), validate({ ... }), handler);
```

- `authenticate` reads the header, verifies the JWT and sets `req.user = { id, role }`.
  An expired token gets its own code, `TOKEN_EXPIRED`, so a client knows to call `/auth/refresh` instead of showing a login screen.
- `requireRole(...roles)` answers 403 if `req.user.role` isn't allowed.
- **Order matters:** auth runs *before* `validate`, so an anonymous caller gets 401 and learns nothing about
  what a valid body looks like.
- `req.user` is added to Express's `Request` type with `declare global { namespace Express { interface Request { user?: AuthUser } } }`.

**A TypeScript problem worth knowing about.** All handlers in one route share the same generic types. With
`authenticate` typed as a plain `RequestHandler`, TypeScript took its params type (`{ [key: string]: string }`) for the
whole route, and `validate`'s `{ id: number }` no longer fit. The fix: type the auth middlewares as
`RequestHandler<any, any, any, any>` ("I accept any request shape"), which leaves inference to `validate`.
A probe file confirmed the handler still sees `req.params.id: number`.
A second attempt, bundling both into `const requireAdmin = [authenticate, requireRole("admin")]`, broke
inference again (arrays use a different overload), so each route lists both explicitly.

### Step 6: users and roles

- **`publicUserColumns`** lists the only user columns that ever leave the API. Selecting columns explicitly
  (instead of `select()`) means `password_hash` can't slip into a response when someone adds a field later.
- **`GET /me` reads from the database**, not just the token, so the name and role are current.
- **`PATCH /users/:id/role`**: admins only.
  **Rule: an admin can't change their own role** (`403 CANNOT_CHANGE_OWN_ROLE`), so the last admin can't lock everyone out.

The first admin comes from the seed (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, done in Phase 1). There's no other way to create one:
signup can't, and `/users/:id/role` needs an admin already.

### Verification (Phase 3 "done when")

`npm run typecheck` passes. Then, against a freshly seeded database:

| Scenario | Result |
|----------|--------|
| Sign up `" Ana@Example.COM "` | ✅ 201, stored as `ana@example.com`, no password in the response |
| Sign up `ana@example.com` again | ✅ 409 `EMAIL_TAKEN` |
| Sign up with `"role": "admin"` | ✅ 400 `Unrecognized key: "role"` |
| Sign up with a bad email, 5-char password, empty name | ✅ 400, all three reported |
| Log in: wrong password / unknown email | ✅ both 401 `INVALID_CREDENTIALS`, both ≈ 27 ms |
| Log in with `ANA@example.com` | ✅ 200, tokens |
| `GET /me` with token / no token / garbage token | ✅ 200 / 401 `UNAUTHENTICATED` / 401 `INVALID_TOKEN` |
| **`POST /movies` with no token** | ✅ **401** |
| **`POST /movies` as a regular user** | ✅ **403** |
| **`POST /genres` as admin** | ✅ **201** |
| `GET /movies` with no token | ✅ 200 (reads stay public) |
| JWT edited by hand to say `"role":"admin"` | ✅ 401 `INVALID_TOKEN` (signature no longer matches) |
| Unsigned token with `"alg":"none"` claiming admin | ✅ 401 `INVALID_TOKEN` |
| Expired token signed with the real secret | ✅ 401 `TOKEN_EXPIRED` |
| Refresh with R0 | ✅ 200, new access + refresh token |
| Refresh with R0 **again** | ✅ 401, and R1 stops working too (all sessions revoked) |
| Logout, logout again, refresh after logout | ✅ 204, 204, 401 |
| Access token after logout | ✅ still 200 until it expires (the documented trade-off) |
| User tries `PATCH /users/3/role` | ✅ 403 |
| Admin promotes Ana; Ana's **old** token creates a genre | ✅ 403 (token still says `user`) |
| Ana logs in again and creates a genre | ✅ 201 |
| Admin tries to demote themselves | ✅ 403 `CANNOT_CHANGE_OWN_ROLE` |
| `{"role":"superuser"}` / unknown user | ✅ 400 / 404 |

`requests.http` now has an Auth section. Send **"Log in as admin"** first; the write requests reuse its token
through `{{adminLogin.response.body.accessToken}}`.

### Self-check answers

<details>
<summary>Why must the password never be returned in any response, even hashed?</summary>

A hash isn't reversible, but it can be **cracked offline**: an attacker with the hash can try billions of guesses
on their own machine, with no rate limit and no lockout. Common passwords fall in seconds. It also reveals the
algorithm and its parameters. The client never needs it, so it never leaves the server. That's why
responses use `publicUserColumns`, not `select()`.
</details>

<details>
<summary>Why does login say "invalid credentials" and not "email not found"?</summary>

"Email not found" vs "wrong password" tells an attacker which emails have accounts. They can then target those
accounts (password guessing, phishing), and the list itself can be sensitive ("this person uses this service").
One message for both cases, *and* the same response time, give them nothing.
</details>

<details>
<summary>What's inside a JWT? Can the user read it? Can they change it?</summary>

Three base64url parts: `header.payload.signature`. The header says the algorithm, and the payload holds the claims (`sub`, `role`, `iat`, `exp`).
**Yes, anyone can read it**: it's encoded, not encrypted (try `echo <payload> | base64 -d`). So never put secrets in it.
**No, they can't change it**: the signature is an HMAC of the header and payload using `JWT_SECRET`. Change one character
and the signature no longer matches (tested above: 401). Only someone with the secret can make a valid token, which is why
`JWT_SECRET` must be long, random and never committed.
</details>

### Try it yourself (practice)

1. Paste an access token into [jwt.io](https://jwt.io) (fine for local test tokens, never for real ones). Find `sub`, `role` and `exp`.
2. Set `ACCESS_TOKEN_TTL_SECONDS=10` in `.env`, log in, wait, and call `/me`. Then use `/auth/refresh` and try again.
3. Add `PATCH /me` so users can change their own name, but not their email or role. (Which schema feature stops `role`?)
4. Add `GET /users` (admin only, paginated) using `publicUserColumns` and `paginate()`.
5. Why is `refresh_tokens.user_id` `ON DELETE CASCADE` while `reservations.user_id` is `RESTRICT`?

---

## Phase 4: Showtimes and scheduling ✅

**Goal:** admins can schedule, change and remove showtimes. The database stops double-booking a hall,
and the API turns that into a clear `409`.

### Files created or changed

```
src/
├── config/env.ts                     # + CLEANING_BUFFER_MINUTES (default 15)
├── lib/errors.ts                     # + PG_EXCLUSION_VIOLATION ("23P01")
├── middleware/errorHandler.ts        # + safety net for 23P01
├── db/seed.ts                        # uses computeEndsAt, so seeded showtimes include the buffer
└── modules/showtimes/
    ├── schedule.ts                   # computeEndsAt()
    ├── showtimes.schemas.ts
    ├── showtimes.service.ts
    └── showtimes.routes.ts
```

### Endpoints

| Method | Path | Auth | Success | Errors |
|--------|------|------|---------|--------|
| `GET` | `/showtimes/:id` | – | 200, with `movie` and `hall` | 404 |
| `POST` | `/showtimes` | admin | 201 + `Location` | 400, 409 `HALL_BUSY` |
| `PATCH` | `/showtimes/:id` | admin | 200 | 400, 404, 409 `HALL_BUSY` / `SHOWTIME_HAS_RESERVATIONS` / `SHOWTIME_STARTED` |
| `DELETE` | `/showtimes/:id` | admin | 204 | 404, 409 `SHOWTIME_HAS_RESERVATIONS` |

```json
POST /showtimes
{ "movieId": 3, "hallId": 2, "startsAt": "2026-10-19T22:00:00Z", "priceCents": 1000 }

→ 201
{ "id": 14, "startsAt": "2026-10-19T22:00:00.000Z", "endsAt": "2026-10-19T23:54:00.000Z", "priceCents": 1000,
  "movie": { "id": 3, "title": "The Grand Budapest Hotel", "durationMinutes": 99 },
  "hall": { "id": 2, "name": "Hall 2" } }
```

The client never sends `endsAt` (it's an unrecognized key → 400). The server computes it: 22:00 + 99 min + 15 min cleaning = 23:54.

### Step 1: `ends_at` and the cleaning buffer

```ts
computeEndsAt(startsAt, durationMinutes)  // startsAt + duration + CLEANING_BUFFER_MINUTES
```

So **`ends_at` means "the hall is free again"**, not "the movie ends". The movie's own end is `startsAt + movie.durationMinutes`.

Why store the buffer in `ends_at` instead of adding it inside the exclusion constraint
(`tstzrange(starts_at, ends_at + interval '15 min')`)? Postgres only allows **IMMUTABLE** expressions in an index,
and `timestamptz + interval` isn't. Its result depends on the session's timezone (adding "1 day" across a
daylight-saving change isn't always 24 hours). Storing the final value keeps the constraint simple.

The seed now calls the same `computeEndsAt`, so seeded and API-created showtimes follow the same rule.

### Step 2: time zones in the input

```ts
startsAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value))
```

- `"2026-10-19T22:00:00Z"` ✅ and `"2026-10-19T16:00:00-06:00"` ✅ (both are the same moment).
- `"2026-10-19T22:00:00"` ❌ 400. Without a zone, "22:00" is ambiguous: 22:00 where?
- The API always **returns UTC** (`...Z`). Showing local times is the client's job; Phase 5 deals with "which day" questions.

**Past showtimes** are rejected with `400 "Must be in the future"`. That check is in the service, not in Zod, because it depends on
*when* the request runs, not just on the shape of the input.

### Step 3: overlaps are the database's job

The service **doesn't** look for overlapping showtimes. It inserts, and the exclusion constraint from Phase 1 decides:

```ts
.catch(translateOverlap)   // 23P01 → 409 HALL_BUSY "Hall is busy at that time"
```

A "check first" query in the service would have the same race as in Phases 1–3: two admins could both see a free slot and
both insert. The constraint has no gap.

### Step 4: the update rules

| Change | Allowed when |
|--------|--------------|
| `priceCents` | Always (before it starts). Existing reservations keep the price they were booked at (`reservation_seats.price_cents`). |
| `movieId`, `hallId`, `startsAt` | Only if the showtime has **no reservations at all**. `ends_at` is recomputed. |
| Anything | Not once the showtime has started → `409 SHOWTIME_STARTED`. |

Why "no reservations at all", even cancelled ones?
- Moving a booked showtime would silently change people's plans.
- Changing the **hall** would break their seats: `reservation_seats` is tied to `(showtime_id, hall_id)` by the composite FK
  from Phase 1. The database would refuse the update anyway, even for cancelled rows.
- A cancelled reservation is still history ("you cancelled Inception at 14:00"), so it shouldn't be rewritten.

**Delete** follows the same idea: only a showtime with no reservations. `reservations.showtime_id` is `ON DELETE RESTRICT`,
so the service just translates the FK error into `409 SHOWTIME_HAS_RESERVATIONS`. (The other option in `PLAN.md`,
"cancel them all", needs refunds and notifications. It fits better in Phase 6 or 11.)

### Step 5: `SELECT ... FOR UPDATE`, the race in the update rule

The update first checks "no reservations", then updates. In between, a reservation could be created, which is the classic gap again.
This time there's no single constraint for "no reservations", so the transaction **locks the row**:

```ts
const [current] = await tx.select().from(showtimes).where(eq(showtimes.id, id)).for("update");
```

Why this is enough: when Postgres inserts a reservation, its foreign-key check takes a `FOR KEY SHARE` lock on the
showtime row it points to, and `FOR UPDATE` conflicts with `FOR KEY SHARE`. So:

- If the admin locks first, a new reservation for that showtime **waits** until the admin's transaction ends.
- If a reservation is mid-insert, the admin's `FOR UPDATE` **waits** for it to commit, and then the count sees it.

This was tested: a `psql` session inserted a reservation for showtime #15 and held its transaction open for 3 seconds.
`PATCH /showtimes/15 { startsAt }` sent during that time **waited about 2 s**, then answered `409 SHOWTIME_HAS_RESERVATIONS`.
Without the lock it would have moved a showtime that had just been booked.

### Verification (Phase 4 "done when")

`npm run typecheck` passes. Seed schedule for tomorrow: Hall 1 14:00–16:43, 18:00–19:54; Hall 2 15:00–17:20, 19:00–21:43.

| Request | Result |
|---------|--------|
| `POST /showtimes` no token / as user | ✅ 401 / 403 |
| **Hall 1 at 17:00 (ends 18:54, next show 18:00)** | ✅ **409 `HALL_BUSY`** |
| Hall 2 at 22:00 | ✅ 201, `endsAt` 23:54 |
| **Hall 1 at 22:00, same time, other hall** | ✅ **201** |
| Hall 2 at 23:53 (1 minute before it's free) | ✅ 409 |
| Hall 2 at 23:54 (exactly when it's free) | ✅ 201 (the `'[)'` range) |
| `17:00-06:00` (= 23:00 UTC) in a busy Hall 1 | ✅ 409: offsets are converted correctly |
| In the past / no timezone / unknown movie | ✅ 400 / 400 / 400 |
| `"movieId":"1"`, `hallId: 1.5`, negative price, extra `endsAt` | ✅ 400, all five reported |
| `GET /showtimes/1` / `999` | ✅ 200 / 404 |
| PATCH price of #1 (has a reservation) | ✅ 200 |
| PATCH `startsAt` of #1 | ✅ 409 `SHOWTIME_HAS_RESERVATIONS` |
| PATCH `startsAt` / `movieId` of a free showtime | ✅ 200, `endsAt` recomputed each time |
| PATCH #2 into Hall 2 (busy then) | ✅ 409 `HALL_BUSY` |
| PATCH a showtime that already started | ✅ 409 `SHOWTIME_STARTED` |
| DELETE #1 / a free one / it again | ✅ 409 / 204 / 404 |
| PATCH during an open reservation transaction | ✅ waited ~2 s, then 409 |

You may notice gaps in ids (13 and 16 were skipped). A failed insert still uses up a sequence number, because sequences
never roll back, so that concurrent inserts don't have to wait for each other. Ids are unique, not gap-free.

`requests.http` has a new Showtimes section using dates in 2030, so they don't clash with the seed.

### Self-check answer

<details>
<summary>Why put the overlap check in the database, not only in the service?</summary>

A service check is "SELECT overlapping showtimes, and if none, INSERT". Two admins (or two tabs) can run the SELECT at the same moment,
both see a free hall, and both insert. The exclusion constraint is checked **inside** the insert, with the index locked, so the second insert
fails no matter how they're timed. It also protects data written any other way: a seed script, a migration, a future
"bulk import" endpoint, or someone in `psql`. The service still matters, but for the *message* (`409 HALL_BUSY`), not for the guarantee.
</details>

### Try it yourself (practice)

1. Add `GET /halls` (public) that lists halls with their seat count. (Hint: `count()` with `groupBy`.)
2. Set `CLEANING_BUFFER_MINUTES=0` and restart. Can you now schedule a show at 16:28 in Hall 1? Why does the seeded data not change?
3. `POST /showtimes` with an unknown movie **and** an unknown hall reports only the movie. Change the service so it reports both.
4. Open two `psql` sessions. In the first: `begin; select * from showtimes where id = 2 for update;`. In the second, try
   `insert into reservations (user_id, showtime_id, total_cents) values (2, 2, 0);`. What happens? Now `commit;` the first one.
5. A showtime is at 23:00 UTC. On which calendar day is it for a user in Mexico City (UTC-6)? And in Madrid (UTC+2)?

---

## Phase 5: Browsing and seat availability ✅

**Goal:** the two read endpoints a customer needs before booking: *what's on that day?* and *which seats are free?*
Both are public.

### Files changed

```
src/
├── config/env.ts                       # + THEATER_TIMEZONE (default "UTC"), validated at startup
├── lib/schemas.ts                      # + timeZoneSchema
├── lib/errors.ts                       # + PG_INVALID_PARAMETER_VALUE ("22023")
├── modules/movies/movies.routes.ts     # + GET /movies/showtimes (registered before /:id)
├── modules/movies/movies.service.ts    # genresByMovie is now exported for reuse
└── modules/showtimes/
    ├── showtimes.schemas.ts            # + scheduleQuery
    ├── showtimes.service.ts            # + getDaySchedule, getSeatMap
    └── showtimes.routes.ts             # + GET /showtimes/:id/seats
```

### Endpoints

| Method | Path | Success | Errors |
|--------|------|---------|--------|
| `GET` | `/movies/showtimes?date=YYYY-MM-DD[&tz=Area/City]` | 200, movies with nested showtimes | 400 bad date or timezone |
| `GET` | `/showtimes/:id/seats` | 200, the seat map grouped by row | 400, 404 |

```json
GET /movies/showtimes?date=2026-10-19
{ "date": "2026-10-19", "timezone": "UTC",
  "movies": [
    { "id": 1, "title": "Inception", "durationMinutes": 148, "posterUrl": "...", "description": "...",
      "genres": [{ "id": 1, "name": "Action" }, { "id": 4, "name": "Sci-Fi" }],
      "showtimes": [
        { "id": 1, "startsAt": "2026-10-19T14:00:00.000Z", "endsAt": "2026-10-19T16:43:00.000Z",
          "priceCents": 1200, "seatsAvailable": 38, "hall": { "id": 1, "name": "Hall 1" } } ] } ] }

GET /showtimes/1/seats
{ "showtime": { "id": 1, "startsAt": "...", "movie": { ... }, "hall": { "id": 1, "name": "Hall 1" }, ... },
  "totalSeats": 40, "availableSeats": 38,
  "rows": [ { "row": "A", "seats": [ { "id": 1, "number": 1, "available": false }, ... ] }, ... ] }
```

### Step 1: what "a day" means

The API stores and returns UTC, but `?date=2026-10-19` is a **local** calendar day. Local to whom?

- **Default: the theater's timezone** (`THEATER_TIMEZONE`). A cinema is in one place, so "Tuesday's showtimes" means
  Tuesday where the cinema is, wherever the customer is browsing from.
- **Override:** `&tz=Europe/Madrid`, for a client that wants another zone's days.
- **Timezone names are validated** with `Intl.DateTimeFormat` (it throws a `RangeError` for unknown names), both in the query and in `env.ts`,
  so a typo in `.env` stops the app at startup. If Postgres ever rejects a name that Intl accepted (error `22023`), it's still a 400.

The day's boundaries are computed **in Postgres**:

```sql
starts_at >= ('2026-10-19'::date)::timestamp     AT TIME ZONE 'Asia/Tokyo'   -- 2026-10-18 15:00 UTC
starts_at <  ('2026-10-19'::date + 1)::timestamp AT TIME ZONE 'Asia/Tokyo'   -- 2026-10-19 15:00 UTC
```

`timestamp AT TIME ZONE zone` means "this wall-clock time, read in that zone" and gives a UTC instant.
Postgres knows the daylight-saving rules. **2026-10-25 in Madrid is 25 hours long** (clocks go back), from 22:00 UTC to
23:00 UTC the next day. A fixed "+24 hours" in JavaScript would get that day wrong.

Only **upcoming** showtimes are listed (`starts_at > now()`). This endpoint is for choosing what to book; admins get
all showtimes in the Phase 7 reports.

### Step 2: the schedule query

One query returns one row per showtime, with its movie and hall joined in. JavaScript then nests the rows under their movie:

```
rows:   (Inception, 14:00) (Inception, 19:00) (Spirited Away, 15:00) ...
result: Inception → [14:00, 19:00],  Spirited Away → [15:00], ...
```

Sorting by `title, id, starts_at` in SQL means the `Map` keeps that order. Genres are loaded with Phase 2's `genresByMovie` in one
more query. Total: **2 queries**, however many movies and showtimes there are.

**`seatsAvailable`** uses two *correlated subqueries*, which run once per showtime row:

```sql
(select count(*) from seats where seats.hall_id = showtimes.hall_id)
- (select count(*) from reservation_seats where showtime_id = showtimes.id and active)
```

**Range, not function.** The filter is `starts_at >= X AND starts_at < Y`, not `date(starts_at) = '2026-10-19'`.
Wrapping the column in a function hides it from the index (see Step 4).

### Step 3: the seat map, and LEFT JOIN with conditions in `ON`

```sql
select seats.*, reservation_seats.seat_id is null as available
from seats
left join reservation_seats
  on  reservation_seats.seat_id = seats.id
  and reservation_seats.showtime_id = $1
  and reservation_seats.active
where seats.hall_id = $hall
order by row_label, seat_number
```

- **LEFT JOIN** keeps every seat. A seat with no matching booking still appears, with `NULL`s in the `reservation_seats` columns:
  that `NULL` *is* "available".
- **The booking conditions must be in `ON`, not `WHERE`.** `WHERE reservation_seats.showtime_id = 1` would remove the rows where
  `showtime_id` is `NULL`, which are exactly the free seats, and silently turn the LEFT JOIN into an inner join.
- Only `active` bookings count, so a cancelled reservation frees its seats immediately.

The service groups the flat rows into `rows: [{ row: "A", seats: [...] }]`, which is what a client needs to draw the map.

### Step 4: route order

```ts
moviesRouter.get("/showtimes", ...);   // must come first
moviesRouter.get("/:id", ...);
```

Express tries routes **in the order they're registered**. If `/:id` came first, `/movies/showtimes` would match it with `id = "showtimes"`
and fail validation with a 400.

### Verification (Phase 5 "done when")

`npm run typecheck` passes. Seed schedule (UTC) for 2026-10-19: Hall 1 14:00, 18:00; Hall 2 15:00, 19:00.

| Request | Result |
|---------|--------|
| `?date=2026-10-19` | ✅ 3 movies, 4 showtimes; showtime 1 has `seatsAvailable: 38` (A1 and A2 are booked), the others 40 / 24 |
| `?date=2026-10-19&tz=Asia/Tokyo` (UTC+9) | ✅ only the 14:00Z showtime (Tokyo's day ends at 15:00 UTC) |
| `?date=2026-10-20&tz=Asia/Tokyo` | ✅ the 15:00Z, 18:00Z and 19:00Z showtimes of the 19th + 14:00Z on the 20th |
| `?date=2020-01-01` | ✅ 200, `movies: []` |
| No `date` / `2026-13-45` + `tz=Mars/Olympus` | ✅ 400 / 400 with both problems |
| `/movies/1` after adding `/movies/showtimes` | ✅ still 200 |
| `/showtimes/1/seats` | ✅ 40 seats, 38 available, A1 and A2 taken |
| `/showtimes/999/seats` | ✅ 404 |

**The seat map changes after a reservation is inserted by hand** (row C of Hall 1, showtime 2):

```
before:            available=40  row C: · · · · · · · ·
after booking C5:  available=39  row C: · · · · X · · ·      (schedule also says free=39)
after cancelling:  available=40  row C: · · · · · · · ·      (active = false frees the seat)
```

### `EXPLAIN ANALYZE` results (self-check)

With the seed's 64 seats, the planner reads the whole `seats` table (a *Seq Scan*), because for one tiny page
that's cheaper than using an index. But the bookings side **already uses an index**: the partial unique index from Phase 1
serves "which seats are taken for showtime 1":

```
Hash Left Join
  ->  Seq Scan on seats s                Filter: (hall_id = 1)
  ->  Bitmap Index Scan on reservation_seats_one_active_per_seat   Index Cond: (showtime_id = 1)
```

With `SET enable_seqscan = off`, which shows what the planner would do on big tables, `seats` switches to
`Bitmap Index Scan on seats_hall_row_number_key`. That's the `UNIQUE (hall_id, row_label, seat_number)` index:
its first column is `hall_id`, so it also serves `WHERE hall_id = 1`.

The day schedule's range filter uses `Index Scan using showtimes_starts_at_idx`. The anti-pattern
`WHERE (starts_at AT TIME ZONE 'UTC')::date = '2026-10-19'` stays a **Seq Scan even with seq scans discouraged**: there's no index on that
expression, so it has to check every row.

To repeat it: open `psql`, then run `explain analyze` followed by the query. Use `set enable_seqscan = off;` to see the index plans.

### Self-check answers

<details>
<summary>Which date means "a day" for a user in Mexico City vs. one in Madrid? How does your query handle it?</summary>

The same instant falls on different calendar days. 23:00 UTC on the 19th is 17:00 on the 19th in Mexico City (UTC−6), but
01:00 on the **20th** in Madrid (UTC+2, summer time). So "the 19th" is a different 24-hour slice of UTC for each:
Mexico City is 06:00Z → 06:00Z next day, Madrid is 22:00Z the day before → 22:00Z.
The query turns the local date into its UTC start and end with `AT TIME ZONE` (default: the theater's zone, or `?tz=`), then filters
`starts_at` by that range. Postgres applies each zone's daylight-saving rules, so days of 23 or 25 hours are handled.
</details>

<details>
<summary>Run <code>EXPLAIN ANALYZE</code> on the seats query. Is it using your indexes?</summary>

Partly, and that's correct. The bookings lookup uses `reservation_seats_one_active_per_seat`. The `seats` table is read with a
Seq Scan because 64 rows fit on one page, and reading it is cheaper than an index lookup. Disabling sequential scans shows that
`seats_hall_row_number_key` would be used on a big table. The planner chooses by estimated cost, not by "is there an index",
so test with realistic data sizes before adding indexes.
</details>

### Try it yourself (practice)

1. Add `?movie=<id>` to `/movies/showtimes` to show one movie's showtimes on that day.
2. Insert 100,000 showtimes with `generate_series` (in a throwaway database, or reseed afterwards) and rerun the `EXPLAIN ANALYZE`
   *without* `enable_seqscan = off`. When does the planner switch to the index?
3. Move the `showtime_id = 1` condition from `ON` to `WHERE` in `psql` and compare the row counts.
4. Set `THEATER_TIMEZONE=America/Mexico_City` and restart. Which date do the seeded 14:00Z showtimes now belong to? And with `Pacific/Auckland`?
5. Add a `?date=today` shortcut. Why is "today" itself timezone-dependent?

---

## Phase 6: Reservations ⭐ ✅

**Goal:** logged-in users can book seats, see their reservations and cancel upcoming ones, and **a seat can never be sold twice**,
no matter how many requests arrive at the same moment.

### Files created or changed

```
.
├── scripts/race.ts                      # the concurrency experiment (npm run race)
├── tsconfig.json                        # now also type-checks scripts/
└── src/modules/reservations/
    ├── reservations.schemas.ts
    ├── reservations.service.ts
    └── reservations.routes.ts
```

### Endpoints (all need a logged-in user)

| Method | Path | Success | Errors |
|--------|------|---------|--------|
| `POST` | `/reservations` | 201 + `Location` | 400, 409 `SEATS_TAKEN` / `SHOWTIME_STARTED` |
| `GET` | `/reservations/me?page=&limit=` | 200, `{ data, pagination }` | 400 |
| `GET` | `/reservations/:id` | 200 (yours; admins see all) | 404 |
| `POST` | `/reservations/:id/cancel` | 200, the cancelled reservation | 404, 409 `ALREADY_CANCELLED` / `SHOWTIME_STARTED` |

```json
POST /reservations   { "showtimeId": 1, "seatIds": [9, 10] }
→ 201
{ "id": 2, "userId": 2, "status": "confirmed", "totalCents": 2400, "createdAt": "...", "cancelledAt": null,
  "showtime": { "id": 1, "startsAt": "2026-10-19T14:00:00.000Z", "endsAt": "...",
                "movie": { "id": 1, "title": "Inception" }, "hall": { "id": 1, "name": "Hall 1" } },
  "seats": [ { "id": 9, "row": "B", "number": 1, "priceCents": 1200 },
             { "id": 10, "row": "B", "number": 2, "priceCents": 1200 } ] }
```

### Step 1: booking in one transaction

`createReservation` follows the plan's four steps inside **one** `db.transaction`:

1. **The showtime exists and hasn't started**, read with `SELECT ... FOR SHARE`.
2. **Every seat is in that showtime's hall.** The composite FK from Phase 1 would reject a wrong seat too, but this check can
   say *which* ids are wrong.
3. **Insert the reservation and its seat rows.** There's deliberately **no "are these seats free?" query** before the insert.
4. **The total is computed from the database's price** (`priceCents × seats`). The body is a `strictObject`, so sending
   `totalCents` is a 400. The client can't even suggest a price.

If the partial unique index fires during step 3, Postgres raises `23505`, the **whole transaction rolls back** (the
`reservations` row too), and the service returns `409 SEATS_TAKEN: Seat(s) already taken: A1, B2`. The list of taken seats
comes from a second query *after* the failure. It's only for the message, not part of the guarantee.

Verified: after 7 failed booking attempts in a row (taken seats, wrong hall, unknown showtime...), the `reservations` table still had only the
2 successful rows. Nothing was left half-written.

**Why `FOR SHARE` on the showtime?** Many bookings for the same showtime should run at the same time, and `FOR SHARE` locks are compatible
with each other. But they conflict with Phase 4's `FOR UPDATE` and with a plain `UPDATE` of the price. So while bookings are in progress,
an admin's price or time change waits, and the other way round. The price a customer is charged is always the current one.

### Step 2: the concurrency experiment

`scripts/race.ts` logs in, then sends N bookings for the **same seat** with `Promise.all` (all requests start before any is awaited):

```
$ npm run race
Sending 20 simultaneous requests for seat 21 at showtime 2...
Done in 34 ms:
  201 OK                   × 1
  409 SEATS_TAKEN          × 19
✅ Exactly one booking succeeded.

$ npm run race -- --requests 50 --seat 22
  201 OK                   × 1
  409 SEATS_TAKEN          × 49
```

Then, **with the index dropped** (`drop index reservation_seats_one_active_per_seat`):

```
Sending 20 simultaneous requests for seat 23 at showtime 2...
  201 OK                   × 20
❌ 20 bookings succeeded for one seat: overbooking!
```

`select count(*) ... where seat_id = 23 and active` returned **20**: twenty paying customers for one seat.

Putting it back taught one more lesson. `CREATE UNIQUE INDEX` **failed** with `Key (showtime_id, seat_id)=(2, 23) is duplicated`.
Postgres won't create a constraint that the existing data already breaks. In production, a missing constraint means
cleaning up bad data before you can add the constraint back. The index was recreated after `npm run db:seed`, with the exact SQL
from migration `0000`, and the experiment passed again.

**What happens inside Postgres:** the first insert writes its index entry. The other 19 find a matching entry from a
transaction that hasn't committed yet, so they **wait**. When the first one commits, they all fail with `23505`. (If it had rolled back,
one of the waiting ones would have won instead.) The pool has 10 connections, so at most 10 transactions run at once and the rest queue,
but that doesn't change the result.

**Why not "check, then insert"?** `SELECT ... WHERE seat is free` and then `INSERT` has a gap between the two statements. Under load, several
requests can all see "free" before any inserts, which is exactly the overbooking above. A check gives a nicer error message, but only
a constraint gives the guarantee.

### Step 3: reading reservations

- `findReservations()` loads the reservations with their showtime, movie and hall in one query, then **all their seats in one more**:
  2 queries in total (the same trick as `genresByMovie`).
- Seats show the `priceCents` **copied at booking time**. Verified: after an admin raised showtime 1's price to 2000, Bob's reservation
  still showed 1200.
- **Someone else's reservation is a 404, not a 403.** A 403 would confirm "reservation 42 exists, it's just not yours". Admins can see every
  reservation (useful for support and Phase 7).
- `/reservations/me` is registered **before** `/:id` (the route-order lesson from Phase 5).
- `reservationsRouter.use(authenticate)` protects every route in the router at once.

### Step 4: cancelling

Rules: **only the owner**, **only while confirmed**, **only before the showtime starts**.

```ts
select ... from reservations join showtimes ... where id = $1 and user_id = $me  for update of reservations
→ not found? 404 · already cancelled? 409 · started? 409
update reservations set status = 'cancelled', cancelled_at = now()
update reservation_seats set active = false        -- frees the seats (the partial index ignores inactive rows)
```

- **`POST /:id/cancel`, not `DELETE`**: the reservation isn't deleted. Its row stays as history (for the user, and for revenue reports),
  and only its state changes.
- **`FOR UPDATE OF reservations`** locks only the reservation row, not the joined showtime. Two cancels of the same reservation run one
  after the other, so the second one sees `cancelled` and gets a 409.
- Both updates are in one transaction, so a reservation is never "cancelled" with its seats still blocked (or the other way round).
- The `CHECK` from Phase 1 (`cancelled_at` set exactly when `status = 'cancelled'`) would catch a bug that set only one of them.

### Verification (Phase 6 "done when")

`npm run typecheck` passes. Against a freshly seeded database (the seed books A1 and A2 at showtime 1):

| Scenario | Result |
|----------|--------|
| Book with no token | ✅ 401 |
| Demo user books B1 + B2 at showtime 1 | ✅ 201, `totalCents: 2400` (2 × 1200), seats priced 1200 |
| Bob books B2 + A1 | ✅ 409 `Seat(s) already taken: A1, B2` |
| Bob adds `"totalCents": 1` | ✅ 400 `Unrecognized key` |
| A Hall 2 seat for a Hall 1 showtime | ✅ 400 `Seat id(s) not in this showtime's hall: 41` |
| `seatIds: [5, 5]` / unknown showtime | ✅ 400 / 400 |
| A showtime that already started | ✅ 409 `SHOWTIME_STARTED` |
| Rows left by the failed attempts | ✅ none |
| `/reservations/me` | ✅ both of the demo user's reservations, with seats and prices |
| Bob reads / cancels the demo user's reservation | ✅ 404 / 404 |
| Admin reads it | ✅ 200 |
| Owner cancels, then cancels again | ✅ 200 `cancelled` / 409 `ALREADY_CANCELLED` |
| Bob books the freed B2 | ✅ 201 |
| **Cancel a reservation for a past showtime** | ✅ **409 `SHOWTIME_STARTED`** |
| Admin changes the price after booking | ✅ existing reservation keeps 1200 |
| **`npm run race`** (20 requests, 1 seat) | ✅ **1 × 201, 19 × 409** (and 1 / 49 with 50 requests) |
| Same, with the unique index dropped | ❌ 20 × 201: overbooking, as the plan predicts |

`requests.http` has a new Reservations section. Seat ids: Hall 1 is 1–40 (A1 = 1, B1 = 9, ... E8 = 40), Hall 2 is 41–64.

### Self-check answers

<details>
<summary>What does "atomic" mean? What happens to step 3 if step 4 throws?</summary>

**Atomic** means all or nothing: the transaction's changes become visible together at `COMMIT`, or not at all. If anything throws before the
commit (a failed seat insert, a bug while computing the total, the connection dropping), Drizzle sends `ROLLBACK`, and the reservation row
inserted in step 3 disappears as if it had never existed. No other request ever saw it, because uncommitted rows are invisible to other
transactions. This was verified: failed bookings left no rows behind.
</details>

<details>
<summary>Compare the optimistic approach (unique constraint) and the pessimistic one (<code>SELECT ... FOR UPDATE</code>). When would you choose each?</summary>

- **Optimistic (what we built):** just try the insert, and let a constraint reject the loser. No locks are taken in advance; conflicts are
  detected at write time. Best when conflicts are **rare** (most people pick different seats) and the rule fits a constraint ("unique per
  seat and showtime"). Cheap, simple, and impossible to get wrong in application code.
- **Pessimistic:** lock first (`SELECT ... FOR UPDATE` on the rows you'll change), then check and write while others wait. Best when
  conflicts are **frequent** (everyone fighting over the same row, like a counter or a stock level), when the rule **can't be expressed as a
  constraint** (Phase 4's "no reservations" check), or when retrying would be expensive. The cost: waiting, and the risk of deadlocks if
  locks are taken in different orders.

This project uses both: a unique index for seats, and `FOR UPDATE` / `FOR SHARE` where a check must stay true until the write.
</details>

<details>
<summary>Why should user A get a 404 (not a 403) when trying to cancel user B's reservation?</summary>

A 403 says "this exists, but you can't touch it". Ids are sequential, so an attacker could walk `/reservations/1`, `/2`, `/3`... and learn
how many reservations exist and which ids are real (*enumeration*). A 404 treats "not yours" exactly like "doesn't exist", so it reveals
nothing. The query itself filters by `user_id`, so another user's reservation is simply never found.
</details>

### Idempotency (from "Learn", not built yet)

If a booking request times out on the client side, did it succeed? Retrying could book **two** reservations (for different seats) or show a
confusing 409 for your *own* seats. The standard fix is an `Idempotency-Key` header: the client sends a random key per booking attempt; the
server stores `(user_id, key) → response` and, if it sees the same key again, returns the stored response instead of booking again.
It's practice exercise 4 below.

### Try it yourself (practice)

1. Run `npm run race -- --requests 100`. Then book a **different** seat in each request (change the script) and check that all succeed.
2. Add `GET /reservations` (admin only) with filters like `?showtimeId=` and `?status=`. It's a preview of Phase 7.
3. Add a rule: at most 10 seats per user per showtime, **across** reservations. Can a constraint express it? If not, which lock would you use?
4. Implement `Idempotency-Key` for `POST /reservations` with a new table and a unique index on `(user_id, key)`.
5. Change `createReservation` to check "are the seats free?" with a `SELECT` first, drop the unique index, and run the race. Does the check help?
   (Recreate the index afterwards, as described above.)

---

## Phase 7: Admin reporting ✅

**Goal:** admins can see every reservation and answer "how full were the shows, and how much did we make?"
The numbers must match a hand calculation.

### Files created or changed

```
src/
├── lib/schemas.ts                          # + timeRangeFields, fromBeforeTo (shared ?from=&to=)
├── modules/reservations/
│   ├── reservations.schemas.ts             # + adminReservationsQuery
│   └── reservations.service.ts             # + listAllReservations
└── modules/admin/
    ├── admin.schemas.ts                    # reportQuery
    ├── reports.service.ts                  # the two reports, in SQL with CTEs
    └── admin.routes.ts                     # everything here is admin only
```

### Endpoints (admin only: 401 without a token, 403 for regular users)

| Method | Path | Returns |
|--------|------|---------|
| `GET` | `/admin/reservations?showtimeId=&status=&from=&to=&page=&limit=` | Every reservation (with its user), filtered and paginated |
| `GET` | `/admin/reports/showtimes?from=&to=` | Per showtime: capacity, tickets sold, occupancy %, revenue, cancellations + totals |
| `GET` | `/admin/reports/movies?from=&to=` | Per movie: showtimes, capacity, tickets sold, occupancy %, revenue + totals |

```json
GET /admin/reports/showtimes?from=2026-10-19T00:00:00Z&to=2026-10-20T00:00:00Z
{ "range": { "from": "2026-10-19T00:00:00.000Z", "to": "2026-10-20T00:00:00.000Z" },
  "totals": { "showtimes": 4, "capacity": 128, "ticketsSold": 10, "occupancyPct": 7.8,
              "revenueCents": 11000, "cancelledReservations": 1 },
  "showtimes": [
    { "id": 1, "startsAt": "2026-10-19T14:00:00.000Z", "movie": { "id": 1, "title": "Inception" },
      "hall": { "id": 1, "name": "Hall 1" }, "capacity": 40, "ticketsSold": 3, "occupancyPct": 7.5,
      "revenueCents": 4400, "cancelledReservations": 0 }, ... ] }
```

### Step 1: the rules the numbers follow

| Question | Answer in this project |
|----------|------------------------|
| **Do cancelled reservations count toward revenue?** | **No.** A cancellation is treated as a full refund. Only *active* `reservation_seats` are tickets sold. |
| Are cancellations hidden? | No. They're reported as `cancelledReservations` per showtime. |
| Which price counts? | The one **copied into `reservation_seats` at booking**. Raising a showtime's price later doesn't change past revenue. |
| What does `from`/`to` filter on? | **When the show starts** (`showtimes.starts_at`), not when the booking was made. "October revenue" means shows in October. |
| Range bounds? | `from` inclusive, `to` exclusive, so consecutive ranges never count a showtime twice. Both need a timezone, and `from` must be before `to`. |
| Capacity? | The number of seats in the hall, counted from `seats`. |

Another valid choice is filtering by **booking date** (`reservations.created_at`), which answers "how much did we *sell* this week?".
It's a different question, and the important thing is to pick one and document it.

### Step 2: the reports in SQL with CTEs

`PLAN.md` suggested dropping to raw SQL for reports, so `reports.service.ts` uses `db.execute(sql\`...\`)`. Each **CTE**
(`WITH name AS (...)`) is one named step:

```sql
with
  capacity  as (select hall_id, count(*) as seats from seats group by hall_id),
  sold      as (select showtime_id, count(*) as tickets, sum(price_cents) as revenue
                from reservation_seats where active group by showtime_id),
  cancelled as (select showtime_id, count(*) as reservations
                from reservations where status = 'cancelled' group by showtime_id)
select s.id, ..., c.seats as capacity,
       coalesce(sold.tickets, 0)   as tickets_sold,
       coalesce(sold.revenue, 0)   as revenue_cents,
       coalesce(cancelled.reservations, 0) as cancelled_reservations
from showtimes s
join capacity c on c.hall_id = s.hall_id
left join sold      on sold.showtime_id = s.id
left join cancelled on cancelled.showtime_id = s.id
where <starts_at range>
```

- **`GROUP BY` before joining.** Each CTE collapses its table to one row per hall or showtime *first*. If you joined `reservation_seats` and
  `reservations` to `showtimes` and then grouped, each seat row would be repeated once per matching reservation row, and `SUM` would
  count revenue several times (*fan-out*). Aggregating in separate steps avoids that.
- **`LEFT JOIN` + `COALESCE`.** A showtime with no sales has no `sold` row. `LEFT JOIN` keeps the showtime anyway (with `NULL`), and
  `COALESCE(x, 0)` turns that `NULL` into 0.
- **The movies report starts `FROM movies`** and `LEFT JOIN`s the per-showtime numbers, so a movie with no showtimes in the range still
  appears with zeros. Starting from `showtimes` would make it vanish. Both reports use the same `sold` step, so they always agree.
- **Parameters, not string pasting.** `${from}` in the `sql` template becomes `$1`, sent separately from the query text, so it's safe
  from SQL injection even though the SQL is hand-written.
- **Views (from "Learn")** would be the next step. `CREATE VIEW showtime_sales AS ...` would store the `sold` logic in the database for reuse
  by other tools (a BI dashboard, `psql`). It's not needed while only this code runs these queries.

### Step 3: types that come back from raw SQL

Two surprises, both found while testing:

1. **`COUNT` and `SUM` come back as strings** (`"2400"`, not `2400`). Postgres returns them as `bigint`, and node-postgres gives a `bigint` as a
   string because a JS `number` can't hold every 64-bit integer exactly. The service converts them with `Number()`, which is exact up to
   `Number.MAX_SAFE_INTEGER` (about 90 trillion dollars in cents).
2. **Timestamps came back as `"2026-10-19 14:00:00+00"`** instead of the ISO format of every other endpoint. Drizzle tells node-postgres to
   return timestamps as text and converts them itself, but only for its typed queries. With raw `db.execute()` you get the text, so the
   service wraps it in `new Date(...)`.

### Step 4: `/admin/reservations`

It reuses Phase 6's `findReservations` (with the same 2 queries plus one for the users), adding filters:

- `showtimeId`, `status` and `from`/`to` (on the showtime's start).
- `db.$count(reservations, where)` can only see the `reservations` table, so the time filter is a subquery,
  `showtime_id IN (SELECT id FROM showtimes WHERE starts_at ...)`, which works for both the page and the count.
- Each reservation includes `user: { id, name, email }` instead of just `userId`.

`adminRouter.use(authenticate, requireRole("admin"))` protects every route under `/admin` in one line.

### Verification (Phase 7 "done when": numbers match a hand calculation)

**Seed only.** 3 days × (2 Hall 1 shows × 40 seats + 2 Hall 2 shows × 24 seats) = 3 × 128 = **384 seats**.
The only booking is A1 + A2 at showtime 1, at 1200 each.

| Report | Expected | Got |
|--------|----------|-----|
| Showtimes totals | 12 showtimes, 384 capacity, 2 sold, 0.5 %, 2400 | ✅ same |
| Inception | 6 showtimes, 192 seats, 2 sold, 1.0 %, 2400 | ✅ |
| Spirited Away | 3 showtimes, 72 seats, 0 sold | ✅ |
| Grand Budapest | 3 showtimes, 120 seats, 0 sold | ✅ |

**A scenario through the API.** Tomorrow: #1 Inception, Hall 1, 1200; #2 Budapest, Hall 1, 1000; #3 Spirited Away, Hall 2, 900; #4 Inception, Hall 2, 1400.

1. Seed: demo user has 2 seats at #1 → 2400
2. Bob books 3 seats at #2 → 3 × 1000 = 3000
3. Demo user books 4 seats at #3 → 4 × 900 = 3600
4. Bob books 2 seats at #4 (2800) and **cancels** → doesn't count
5. Admin raises #1 to 2000; demo user books 1 more seat at #1 → 2000

| Showtime | Capacity | Sold | Occupancy | Revenue | Cancelled | Got |
|----------|----------|------|-----------|---------|-----------|-----|
| #1 | 40 | 3 | 7.5 % | 2400 + 2000 = **4400** | 0 | ✅ |
| #2 | 40 | 3 | 7.5 % | **3000** | 0 | ✅ |
| #3 | 24 | 4 | 16.7 % | **3600** | 0 | ✅ |
| #4 | 24 | 0 | 0 % | **0** | 1 | ✅ |
| **Tomorrow** | 128 | 10 | 7.8 % | **11000** | 1 | ✅ |
| **All time** | 384 | 10 | 2.6 % | **11000** | 1 | ✅ |

By movie: Inception 3 tickets / 4400 / 1.6 %, Spirited Away 4 / 3600 / 5.6 %, Budapest 3 / 3000 / 2.5 % ✅ (sorted by revenue).
For 2030, a range with no showtimes, every movie is still listed, with 0 showtimes and 0 revenue ✅.

A cross-check in SQL shows why the cancellation rule matters: `sum(price_cents) filter (where active)` = **11000**, but summing every row
would give **13800**, overstating revenue by Bob's refunded 2800.

(While testing, the first hand calculation gave 13000. The report was right; the hand math was wrong. That's the point of checking both ways.)

`/admin/reservations`:

| Request | Result |
|---------|--------|
| No filters | ✅ 5 reservations, newest showtime first, each with `user` |
| `status=cancelled` / `showtimeId=1` | ✅ only Bob's #4 / #5 and #1 |
| Tomorrow's range / from the day after | ✅ 5 / 0 |
| `page=2&limit=2` | ✅ items 3–4, `totalPages: 3` |
| Regular user token | ✅ 403 |
| `from` after `to` | ✅ 400 "`from` must be before `to`" |
| `status=refunded` + `from` with no timezone | ✅ 400, both reported |

`requests.http` has a new "Admin reports" section.

### Self-check answer

<details>
<summary>Do cancelled reservations count toward revenue? Make sure your queries follow your answer.</summary>

Here: **no**. Cancelling is treated as a full refund, so the money isn't ours. Every revenue figure comes from `reservation_seats WHERE active`,
and cancelling sets `active = false` (Phase 6), so a cancelled seat drops out of both "tickets sold" and "revenue" with no extra
condition in the reports. Cancellations are still counted separately, because a show with many cancellations is useful to know about.
If the business kept a cancellation fee, you'd store it (a `refunded_cents` or `fee_cents` column) and add it to revenue, rather than
counting the full price.
</details>

### Try it yourself (practice)

1. Add `GET /admin/reports/days?from=&to=&tz=`: revenue per local day. (Hint: `date_trunc('day', starts_at AT TIME ZONE $tz)`, then `GROUP BY` it.)
2. Rewrite the `sold` CTE as a view (`CREATE VIEW showtime_sales ...` in a custom migration) and use it in both reports.
3. Join `reservation_seats` and `reservations` to `showtimes` directly and `GROUP BY showtimes.id`, without CTEs. Do the numbers change?
   Why? (Fan-out.)
4. Add a "top 3 showtimes by occupancy" to the showtimes report with `ORDER BY ... LIMIT 3`.
5. Add `?sort=` to `/admin/reports/movies` (`revenue`, `tickets`, `title`). How do you allow it without building SQL from user input?

---

## Phase 8: Testing ✅

**Goal:** the checks done by hand in Phases 2–7 run automatically with one command, against a real Postgres database
that's separate from the one you develop with.

```
$ npm test
 Test Files  10 passed (10)
      Tests  84 passed (84)
   Duration  7.79s
```

### Files created or changed

```
.
├── vitest.config.ts                    # two projects: unit and integration
├── tests/
│   ├── test-env.ts                     # test env vars + the "_test" safety check
│   ├── unit/                           # no database
│   │   ├── rules.test.ts               # price, cancel rule, ends_at
│   │   ├── schemas.test.ts             # Zod schemas: normalization, strict keys, timezones...
│   │   └── errors.test.ts              # isPgError and Drizzle's wrapper
│   └── integration/                    # real HTTP + real Postgres
│       ├── global-setup.ts             # once: create movies_test if needed, run migrations
│       ├── setup.ts                    # each file: reseed before every test, close the pool at the end
│       ├── helpers.ts                  # api(), tokens, seat ids, dates, raw SQL
│       ├── catalog.test.ts             # Phase 2
│       ├── auth.test.ts                # Phase 3
│       ├── showtimes.test.ts           # Phase 4
│       ├── browse.test.ts              # Phase 5
│       ├── reservations.test.ts        # Phase 6
│       ├── concurrency.test.ts         # Phase 6's race experiment
│       └── reports.test.ts             # Phase 7
└── src/
    ├── db/fixtures.ts                  # seedDatabase(): the seed as a reusable function
    ├── db/seed.ts                      # now a small CLI wrapper around seedDatabase()
    └── modules/reservations/rules.ts   # reservationTotal(), assertCancellable(): pure functions
```

### Step 1: dependencies

```bash
npm install -D vitest supertest @types/supertest
```

| Package | Role |
|---------|------|
| `vitest` | The test runner: `describe`, `it`, `expect`, hooks, watch mode. Runs TypeScript directly. |
| `supertest` | Sends HTTP requests to the Express `app` object without starting a server on a fixed port. |

Vitest 5 was new, so before writing the config its type definitions were checked for every option used
(`projects`, `fileParallelism`, `globalSetup`, `setupFiles`, `env`, `hookTimeout`).

### Step 2: the test pyramid here

| Layer | What | How many | Speed | Needs Postgres |
|-------|------|----------|-------|----------------|
| **Unit** | Pure functions and Zod schemas | 27 | ~0.4 s for all | No |
| **Integration** | Real HTTP requests → routes → services → real database | 57 | ~7 s for all | Yes |

The pyramid says to have many fast unit tests and fewer slow integration tests. This project is mostly *rules enforced by the
database* (constraints, locks, SQL reports), which a unit test can't check, so integration tests carry more of the weight than usual.
That's a deliberate choice: mocking the database would test a fake that doesn't have the unique index.

**Extracting pure rules.** The plan asks for unit tests of "price calculation" and "can cancel?". Both were inline in the service, mixed with
queries, so they moved to `src/modules/reservations/rules.ts`:

```ts
reservationTotal(priceCents, seatCount)               // throws RangeError for nonsense input
assertCancellable({ status, startsAt }, now = new Date())  // throws ConflictError
```

`now` is a **parameter**, so a test can choose the time and check the exact boundary ("starts right now" counts as started)
without waiting or mocking the clock. The service calls them, so the tested code is the code that runs.

### Step 3: a separate test database

- **`movies_test`** lives in the same Postgres container as `movies`. Tests wipe it before every test, so it must never be the dev database.
- **`vitest.config.ts` sets `test.env`**, so `src/config/env.ts` reads `DATABASE_URL=.../movies_test` and a test `JWT_SECRET`, not your `.env`.
- **Safety check:** both the global setup and each test file refuse to run unless the database name ends in `_test`.
- **Global setup** (once per run, in the main Vitest process): connects to the built-in `postgres` database, runs `CREATE DATABASE movies_test`
  if it doesn't exist, then applies `drizzle/` with Drizzle's `migrate()`. It's the same migrations as `npm run db:migrate`, so the test schema is
  the real schema, constraints and all.
- **`fileParallelism: false`**: one shared database means test files must run one after another. (Per-worker databases would allow parallel
  files; not needed at 8 seconds.)

Verified after the full run: the dev database still had exactly the seed's 1 reservation and its unique index.

### Step 4: fixtures (the seed, reused)

The seed moved into `seedDatabase()` (`src/db/fixtures.ts`). `npm run db:seed` and the tests both call it, so
**tests run against exactly the data you've been exploring by hand**: showtime 1 is Inception at 14:00 tomorrow in Hall 1,
seat 9 is B1, the demo user owns reservation 1, and so on. `helpers.ts` documents that layout and has `seatId(1, "B1")` and `utcAt(1, "14:00")`.

`setup.ts` runs `seedDatabase()` **before every test**. It truncates every table with `RESTART IDENTITY`, so ids start at 1 again, and each
test is independent of the others and of their order.

argon2 is slow on purpose, so `seedDatabase` caches the two password hashes per process (`hashOnce`). Without that, every test would pay for
hashing them again.

### Step 5: integration tests with Supertest

```ts
const res = await api().post("/reservations").set(bearer(token)).send({ showtimeId: 1, seatIds: [9, 10] }).expect(201);
expect(res.body).toMatchObject({ status: "confirmed", totalCents: 2400 });
```

`api()` is `request(app)`. This is the payoff of Phase 0's split: `app.ts` never calls `listen()`, so Supertest can start the app on a random
port per request. The tests go through the whole stack: JSON parsing, auth middleware, Zod, services, Postgres constraints, the error handler.

For things the API can't do on purpose (a showtime in the past, a reservation inserted "by hand"), `helpers.ts` runs SQL directly with `query(sql\`...\`)`.

**The concurrency test** starts one real server (`app.listen(0)`) and sends 20, then 50, simultaneous `fetch` requests for the same seat,
just like `scripts/race.ts`. It asserts **exactly one 201**, the rest 409, and exactly one active row in the database.

### Step 6: do the tests actually catch bugs?

A test suite that has never failed hasn't proven anything. So the code was broken on purpose, one bug at a time, and the suite run again:

| Deliberate bug | Caught by |
|----------------|-----------|
| `reservationTotal` charges one extra cent | 4 tests (2 unit, 2 integration) |
| `requireRole("admin")` removed from `POST /movies` | `auth.test.ts`: the 401/403/201 test |
| The showtimes report counts cancelled seats as revenue | `reports.test.ts`: per-showtime numbers |
| `assertCancellable` allows past showtimes | 3 tests (2 unit, 1 integration) |
| **Unique index dropped** in `movies_test` | `concurrency.test.ts`: `expected [201, 201, …] to have a length of 1 but got 20` (and 50) |

After each one, the code (or the index) was restored and `npm test` was green again. Recreating the index hit the Phase 6 lesson once more:
the last test had left duplicate rows behind, so they had to be cleared first.

**If the test database ever gets into a bad state**, drop it and let the next run rebuild it:
`docker compose exec db dropdb -U movies movies_test`.

### Coverage of each phase's "done when"

| Phase | "Done when" | Test |
|-------|-------------|------|
| 2 | Create, list, edit, delete movies; bad input is a 400 with a clear message | `catalog.test.ts` |
| 3 | No token → 401, regular user → 403, admin succeeds | `auth.test.ts` › protected writes |
| 4 | Overlap in the same hall → 409, different halls allowed | `showtimes.test.ts` › creating showtimes |
| 5 | The seat map changes after a reservation is inserted by hand | `browse.test.ts` › seat map |
| 6 | The race experiment passes; cancelling a past reservation is a 409 | `concurrency.test.ts`, `reservations.test.ts` › cancelling |
| 7 | Report numbers match a hand calculation | `reports.test.ts` |

### Try it yourself (practice)

1. Run `npm run test:watch`, open `src/modules/reservations/rules.ts`, and change the cancel rule. Watch the tests react as you save.
2. Write a test for practice exercise 3 of Phase 5 (moving `showtime_id = 1` from `ON` to `WHERE`): which assertion would catch it?
3. Add a test that a regular user gets **403** on every admin route. Can you loop over a list of routes with `it.each`?
4. Measure coverage: `npm install -D @vitest/coverage-v8` and run `npx vitest run --coverage`. Which lines are never executed?
   Is 100% worth it?
5. Make a test fail on purpose, then read Vitest's diff output. Then make a *test* wrong (not the code) and see how that looks.

---

## Phase 9: Hardening ✅

**Goal:** the API behaves well when someone is trying to misuse it, and when something goes wrong you can find out what happened.
Plus documentation so others can use it.

### Files created or changed

```
src/
├── app.ts                         # createApp(options); middleware order; /docs and /openapi.json
├── config/env.ts                  # + LOG_LEVEL, CORS_ORIGINS, API_RATE_LIMIT_MAX, AUTH_RATE_LIMIT_*
├── lib/logger.ts                  # pino: JSON in production, one pretty line in development, redaction
├── middleware/requestLogger.ts    # pino-http: request ids, one log line per request
├── middleware/security.ts         # helmet, cors allow-list, rateLimiter()
├── middleware/errorHandler.ts     # logs with req.log; 500s include the request id
├── server.ts                      # logs through pino
└── docs/openapi.ts                # OpenAPI 3.1 document built from the Zod schemas
tests/integration/hardening.test.ts  # 12 tests for all of the above
```

### Step 1: dependencies

```bash
npm install helmet cors express-rate-limit pino pino-http swagger-ui-express
npm install -D @types/cors @types/swagger-ui-express pino-pretty
```

`npm audit --omit=dev` (production dependencies only) reports **0 vulnerabilities**. The 4 moderate ones from Phase 3 are still
in drizzle-kit, a dev tool.

### Step 2: middleware order in `createApp()`

```ts
app.use(requestLogger);          // 1. id + log line for EVERY request, even ones rejected below
app.use(securityHeaders);        // 2. helmet
app.use(corsFor(corsOrigins));   // 3. CORS (answers preflight OPTIONS requests)
app.use(rateLimiter(apiRateLimit));   // 4. 300 requests/minute per IP, whole API
app.use(express.json({ limit: "100kb" }));  // 5. parse bodies, with a size cap
...
app.use("/auth", rateLimiter(authRateLimit), authRouter);   // 20 per 15 minutes per IP
```

Logging comes first so a request that's rate-limited or too large still leaves a trace. Rate limiting comes before body parsing,
so a flood of huge bodies is rejected without parsing them.

`app.ts` now exports **`createApp(options)`** (and still `export default app` for everything else). Tests use it to build an app with a
tiny rate limit or a CORS allow-list, without touching environment variables.

### Step 3: security headers (`helmet`)

| Header | What it does |
|--------|--------------|
| (no `X-Powered-By`) | Doesn't advertise "Express", so attackers learn less |
| `X-Content-Type-Options: nosniff` | Browsers must trust our `Content-Type`; a JSON response can't be "guessed" into HTML or JS |
| `Strict-Transport-Security` | After one HTTPS visit, browsers refuse plain HTTP for a year |
| `Content-Security-Policy` | Which scripts, styles and images a page may load. Matters for `/docs`, the only HTML we serve |
| `X-Frame-Options: SAMEORIGIN` | Other sites can't put our pages in an iframe (clickjacking) |

Swagger UI was checked against the CSP: its scripts are separate files (`'self'`), and helmet's default allows its inline `<style>`.
The page and both script files return 200 (tested).

### Step 4: CORS with an allow-list

```
CORS_ORIGINS=https://app.example.com,http://localhost:5173
```

**CORS is not access control.** It only tells *browsers* whether JavaScript on another website may read our responses. `curl`, mobile apps
and servers ignore it. Authentication is what protects the data; CORS protects users' browsers from other sites using their session.
Here there's no cookie session (tokens go in the `Authorization` header), so the risk is low, but an allow-list is still the right default.

- **Default: empty**, so no cross-origin browser access until you list a frontend's origin.
- Allowed origins may send `Content-Type` and `Authorization` and read `X-Request-Id` and `Location`.
- Tested: a listed origin gets `Access-Control-Allow-Origin`; another origin, or any origin with the default config, gets nothing.

### Step 5: rate limiting

| Limiter | Default | Why |
|---------|---------|-----|
| Whole API | 300 requests / minute / IP | One client can't flood the server (seat maps, reports, the docs) |
| `/auth/*` | 20 requests / 15 minutes / IP | Slows password guessing to a crawl. Also limits signup spam and refresh abuse. |

- A blocked request gets **429** in the usual format, `{ error: { code: "TOO_MANY_REQUESTS", ... } }`, plus standard `RateLimit` and
  `RateLimit-Policy` headers so a well-behaved client knows when to retry.
- **Once blocked, even the right password fails** until the window passes. That's the point: otherwise an attacker just keeps guessing.
- The counts live **in memory**. That's fine for one server process. With several instances, each would count separately; you'd use a
  shared store like Redis.
- The test suite logs in hundreds of times from `127.0.0.1`, so `tests/test-env.ts` raises both limits. The limiters themselves are tested
  with `createApp({ authRateLimit: { limit: 3, ... } })`.

### Step 6: logging with pino and request ids

**Development** (`npm run dev`), one readable line per request:

```
[01:08:44] INFO: POST /auth/login 200 (74 ms)
[01:08:44] INFO: GET /me 200 (3 ms)
[01:08:44] WARN: GET /movies/999 404 (2 ms)
```

**Production** (`NODE_ENV=production`), one JSON object per line, which log tools can search by any field:

```json
{"level":40,"time":1792285739279,"req":{"id":"support-ticket-42","method":"GET","url":"/movies/999"},"res":{"statusCode":404},"responseTime":19,"msg":"GET /movies/999 404 (19 ms)"}
```

- **Request ids.** Every request gets a UUID, returned in the `X-Request-Id` header. If a load balancer already sent one, it's kept,
  but only if it matches `^[\w-]{1,64}$`, so nobody can inject fake log lines through the header.
- **500 responses include the id**: `{ error: { code: "INTERNAL_ERROR", message: "Something went wrong", requestId: "..." } }`.
  A user can quote it, and you can find the exact log line with the full error. The client still gets no stack trace or message.
- **Levels:** 5xx → `error`, 4xx → `warn`, the rest → `info`. `/health` isn't logged, because it would be noise every few seconds.
- **Less data, less risk.** Each line has only the id, method, URL, status and time, not every header. `Authorization`, cookies and any
  `password`/`refreshToken` fields are redacted anyway, as defense in depth. Verified: an access token sent to `/me` appeared nowhere in the log.
- `LOG_LEVEL=silent` in tests keeps the output clean.

Two bugs were found by reading the real logs, not by the tests:
1. The first version printed every request **and response** header on every line: very noisy, and more data to protect.
2. Messages said `POST /login` and `GET /` for `/auth/login` and `/me`. Inside a router mounted at `/auth`, Express rewrites `req.url`
   to the part after the mount point. `req.originalUrl` keeps the full path.

### Step 7: API docs at `/docs`

- **`GET /openapi.json`**: an OpenAPI 3.1 document. **`GET /docs`**: Swagger UI, where you can read every endpoint, click **Authorize**, paste an
  access token and try requests.
- **Built from the same Zod schemas that validate requests**, using Zod 4's `z.toJSONSchema()` (`io: "input"`, so it describes what a client
  *sends*). `createReservationBody` shows up as `required: ["showtimeId", "seatIds"]` with `additionalProperties: false`, which is exactly what
  `strictObject` enforces. Change a schema and the docs follow. Paths, summaries and status codes are written by hand in `src/docs/openapi.ts`.
- Protected operations get `401` (and `403` for admin ones) and a lock icon automatically.
- That's a third option next to the two in `PLAN.md` (`zod-to-openapi`, hand-written YAML): no extra library, and no second copy of the schemas.
- Response bodies are only described in words for now. Adding schemas for them is a practice exercise.

### Step 8: the endpoint review (security-review checklist)

Every route was listed from the source and checked (`grep` over the `*.routes.ts` files):

| Route group | Input validated? | Who may call it | Ownership / leaks |
|-------------|------------------|-----------------|-------------------|
| `/auth/*` | ✅ Zod, strict | anyone (rate-limited) | Same error and timing for wrong email/password; tokens never logged |
| `/me`, `/users/:id/role` | ✅ (`/me` has no input) | user / admin | Only `publicUserColumns` leave the API; admins can't change their own role |
| `GET /genres`, `/movies...`, `/showtimes/:id(/seats)` | ✅ (`/genres` has no input) | anyone | Public catalog data only |
| Catalog and showtime writes | ✅ | admin | Restrict FKs protect history |
| `/reservations/*` | ✅ | user | Filtered by `user_id` in the query; others' reservations are 404 |
| `/admin/*` | ✅ | admin (`router.use`) | Shows users' names and emails, which is intended for admins |
| `/health`, `/openapi.json`, `/docs` | no input | anyone | API shape only, no data |

| Checklist item | Status here |
|----------------|-------------|
| Secrets | ✅ Only in env vars. `.env` is git-ignored and was **never** in the history (checked with `git log --all -- .env`). No secret-looking literals in `src/`. |
| Input validation | ✅ Every route that takes input runs `validate()`; bodies are strict (allow-list, not deny-list). |
| SQL injection | ✅ Drizzle or `sql` templates with parameters everywhere. The only interpolated SQL is `CREATE DATABASE "${name}"` in the test setup, and the name is checked first. |
| Authentication | ✅ Short-lived JWTs (algorithm pinned), hashed refresh tokens with rotation and reuse detection. |
| Authorization | ✅ `requireRole("admin")` on every catalog or admin write; ownership in the reservations queries. |
| XSS | ✅ JSON-only API; `nosniff` + CSP. **A frontend must still escape** movie titles and descriptions when rendering them. |
| CSRF | ✅ Not applicable: no cookies. The browser never attaches credentials by itself, so another site can't make requests "as" the user. |
| Rate limiting | ✅ Added the API-wide limit during this review (only `/auth` had one before). |
| Sensitive data in errors / logs | ✅ Generic 500s with a request id; redaction; minimal log fields. 4xx messages from body-parser are fixed library strings. |
| Security headers | ✅ helmet. |
| CORS | ✅ Allow-list, empty by default. |
| Dependencies | ✅ 0 vulnerabilities in production dependencies; `package-lock.json` committed. |
| File uploads | Not built (the plan marks poster uploads optional). |
| HTTPS | ⏭ Phase 10: TLS is handled by the hosting platform. HSTS is already sent. |
| Supabase RLS, wallet signatures | Not applicable to this stack. |

**Known gaps, left on purpose (with the reason):**

| Gap | Risk | Plan |
|-----|------|------|
| `trust proxy` isn't configured | Behind a load balancer, every request would come from the proxy's IP, so one shared rate-limit bucket. Trusting `X-Forwarded-For` blindly would let clients fake their IP. | Phase 10: set it to the exact number of proxies of the platform. |
| Expired and revoked refresh tokens are never deleted | The table grows forever (it's not a security hole: they're unusable) | A periodic `DELETE ... WHERE expires_at < now() - interval '30 days'` (Phase 10/11) |
| Signup reveals that an email is taken (409) | Account enumeration, slowed by the rate limit | Email verification flow (Phase 11) |
| Logout leaves the access token valid for ≤15 min | A stolen token keeps working briefly | Short TTL; a Redis deny-list if needed (Phase 11) |
| Rate limits are per process, in memory | With several instances the limit multiplies | Redis store when scaling out |
| Where clients store tokens | XSS in a frontend could steal a token from `localStorage` | Frontend concern: keep tokens in memory, or move to `httpOnly` cookies (then CSRF protection is needed) |

### Verification

`npm run typecheck` passes and `npm test` runs **96 tests** (12 new in `hardening.test.ts`):

| Check | Result |
|-------|--------|
| No `X-Powered-By`; `nosniff`, HSTS and CSP present | ✅ |
| `X-Request-Id`: generated (UUID), unique per request, safe incoming id kept, unsafe one replaced | ✅ |
| CORS: listed origin allowed; other origin and default config get no `Access-Control-Allow-Origin` | ✅ |
| `/auth` limit 3: 3 × 401, then 429 `TOO_MANY_REQUESTS` with `RateLimit-Policy`, even with the right password; `/movies` still 200 | ✅ |
| API limit 5: 5 × 200, then 429 on another route | ✅ |
| 200 kB body → JSON 413 | ✅ |
| `/openapi.json`: 3.1.0, 21 paths, booking requires auth and has the strict body schema | ✅ |
| `/docs/` page and its scripts load under the CSP | ✅ |
| A crashing route → 500 with `requestId` equal to the header, and the internal message absent | ✅ |

Checked by hand: the development and production log formats above, and that the access token doesn't appear in the log.

### Try it yourself (practice)

1. Open `http://localhost:3000/docs`, log in with `POST /auth/login`, click **Authorize**, and book seats from the browser.
2. Add response schemas to the OpenAPI document (e.g. a Zod schema for a reservation, converted with `z.toJSONSchema`).
3. Send 21 logins in a row with `curl` and read the `RateLimit` header on each response. When does it reset?
4. Set `CORS_ORIGINS=http://localhost:5173`, then in a browser console on another page run `fetch("http://localhost:3000/movies")`.
   Read the error. Does the request reach the server? (Check the log.)
5. Write the refresh-token cleanup as a script (`npm run db:cleanup`) and decide how long revoked tokens should be kept for reuse detection.

### Next: Phase 10, Docker, CI and deploy

A production Docker image for the API, GitHub Actions running typecheck and tests on every push, and deploying with the database on Neon,
including `trust proxy` and HTTPS.
