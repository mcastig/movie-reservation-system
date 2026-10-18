# Movie Reservation System: Learning Plan

A step-by-step plan for building the backend in `SPECS.md` yourself. Each phase has
**what you learn**, **what you build**, a **done when** checklist, and **self-check questions**.
Don't move on until you can answer the questions without looking anything up.

---

## Recommended stack

| Area | Choice | Why this one for learning |
|------|--------|---------------------------|
| Language | **TypeScript** on **Node.js 22 LTS** | Types catch mistakes early. It's the most common backend language in job postings. |
| Web framework | **Express 5** | It's small and has no "magic", so you write the routing, middleware and error handling yourself and see how they work. (Try NestJS *after* this project.) |
| Database | **PostgreSQL 16+** | The spec is about relationships, transactions and complex queries, which is what Postgres is best at. |
| DB access | **Drizzle ORM** + its migrations (`drizzle-kit`) | It reads like SQL, so you learn real SQL rather than hiding it. You can drop to raw SQL for reports. |
| Validation | **Zod** | Validates request bodies and gives you TypeScript types from the same schema. |
| Passwords | **argon2** (Argon2id) | The current recommendation for password hashing. |
| Auth tokens | **JWT** (`jsonwebtoken`): short-lived access token + refresh token | It's the standard pattern for APIs. |
| Testing | **Vitest** + **Supertest** + a real test database | Fast unit tests, plus HTTP-level integration tests. |
| API docs | **OpenAPI / Swagger UI** (`zod-to-openapi` or hand-written YAML) | Documents your API so others can use it. |
| Local infra | **Docker Compose** (Postgres, later Redis) | Every developer gets the same environment with one command. |
| Logging | **pino** | Structured JSON logs. |
| API client | **Bruno**, **Postman**, or the VS Code REST Client | For trying your endpoints by hand. |
| Later | **Redis** (seat holds, caching), **Stripe test mode** (payments), **GitHub Actions** (CI) | For the extension phase. |

> You also have a **Neon** (serverless Postgres) account connected. Use Docker Postgres locally
> while you learn, then use Neon in Phase 10 as your hosted database.

**Tools to install:** Node 22, pnpm (or npm), Docker Desktop, Git, an API client, and a DB GUI
(TablePlus, DBeaver, or `psql`).

---

## Target project structure

```
movie-reservation-system/
├── src/
│   ├── app.ts                 # creates the Express app (no listen) so tests can import it
│   ├── server.ts              # starts the HTTP server
│   ├── config/env.ts          # reads and validates env vars with Zod
│   ├── db/
│   │   ├── schema.ts          # Drizzle table definitions
│   │   ├── client.ts          # connection pool
│   │   └── seed.ts            # initial admin, genres, halls, seats
│   ├── middleware/            # auth, requireRole, validate, errorHandler
│   ├── modules/
│   │   ├── auth/              # routes + service + schemas
│   │   ├── users/
│   │   ├── movies/
│   │   ├── showtimes/
│   │   ├── reservations/
│   │   └── reports/
│   └── lib/errors.ts          # AppError, NotFoundError, ConflictError...
├── drizzle/                   # generated migrations
├── tests/
├── docker-compose.yml
├── .env.example
└── package.json
```

Each module follows **routes → service → database**:
- **Routes** handle HTTP: parsing input, status codes, and calling the service.
- **Services** hold the business rules, like "you can't cancel a past reservation".
- **Database** code only runs queries.

---

## Phase 0: Foundations and setup (1–2 days)

**Learn:** HTTP methods and status codes, the REST resource naming style, JSON, and environment variables.

**Build:**
1. `git init` and a `.gitignore` (include `node_modules` and `.env`).
2. Set up a TypeScript project with `tsx` for development (`pnpm dev`).
3. Add a `docker-compose.yml` with a Postgres service.
4. Add a `GET /health` endpoint that returns `{ status: "ok" }`.
5. Add `src/config/env.ts`, which crashes on startup if `DATABASE_URL` or `JWT_SECRET` is missing.

**Done when:** `docker compose up -d && pnpm dev` works and `/health` responds.

**Self-check:**
- What's the difference between 200, 201, 204, 400, 401, 403, 404, 409 and 422?
- Why should the app crash at startup if config is missing, rather than failing later?

---

## Phase 1: Data modeling (2–3 days) ⭐ the most important phase

**Learn:** entities, primary and foreign keys, 1:N and N:M relationships, normalization, constraints, and indexes.

Draw the diagram on paper (or in dbdiagram.io) **before** you write any code. Here's a suggested model.
Try to design it yourself first, then compare:

```
users            (id, email UNIQUE, password_hash, name, role ['user'|'admin'], created_at)
genres           (id, name UNIQUE)
movies           (id, title, description, poster_url, duration_minutes, created_at)
movie_genres     (movie_id FK, genre_id FK, PK(movie_id, genre_id))        -- N:M
halls            (id, name)                                               -- a theater room
seats            (id, hall_id FK, row_label, seat_number, UNIQUE(hall_id, row_label, seat_number))
showtimes        (id, movie_id FK, hall_id FK, starts_at, ends_at, price_cents)
reservations     (id, user_id FK, showtime_id FK, status ['confirmed'|'cancelled'],
                  total_cents, created_at, cancelled_at)
reservation_seats(id, reservation_id FK, showtime_id FK, seat_id FK, price_cents)
```

**Key design decisions to think through:**
- **Money:** store integer cents, never floats. (Why? Try `0.1 + 0.2` in JS.)
- **Time:** use `timestamptz` and store UTC.
- **Price on the reservation:** copy the price into `reservation_seats` so old revenue doesn't change if an admin edits the showtime price later.
- **Preventing overbooking at the database level:** add a *partial unique index*:
  `UNIQUE (showtime_id, seat_id) WHERE active` (or delete the `reservation_seats` rows when a reservation is cancelled).
  Then even buggy code *can't* sell the same seat twice.
- **Preventing overlapping showtimes in the same hall:** use a Postgres *exclusion constraint*:
  `EXCLUDE USING gist (hall_id WITH =, tstzrange(starts_at, ends_at) WITH &&)` (needs the `btree_gist` extension).
- **Indexes:** on `showtimes(starts_at)`, `reservations(user_id)`, and the foreign keys you filter by.

**Build:** `src/db/schema.ts`, your first migration, and `seed.ts` (1 admin, a few genres,
2 halls with seats, a few movies and showtimes).

**Done when:** `pnpm db:migrate && pnpm db:seed` works and you can see the data in your DB GUI.

**Self-check:**
- Why is `movie_genres` a separate table?
- What happens if two requests insert the same `(showtime_id, seat_id)` at the same moment?
- Why do we trust the database constraint more than an `if` check in the code?

---

## Phase 2: Movies and genres CRUD, no auth yet (2 days)

**Learn:** routing, middleware, input validation, centralized error handling, and pagination.

**Build:**
- `GET /genres`, `POST /genres`
- `GET /movies?genre=&page=&limit=`, `GET /movies/:id`, `POST /movies`, `PATCH /movies/:id`, `DELETE /movies/:id`
- A `validate(schema)` middleware that uses Zod.
- An `errorHandler` middleware: every error becomes `{ error: { code, message } }` with the right status.
- `poster_url` is just a URL string for now.

**Done when:** you can create, list, edit and delete movies from your API client, and bad input returns a 400 with a clear message.

**Self-check:**
- Why use `PATCH` and not `PUT` for partial updates?
- What should `DELETE /movies/:id` do if the movie has future showtimes with reservations? (Pick a rule, then enforce it.)

---

## Phase 3: Authentication and authorization (3 days)

**Learn:** password hashing, JWTs, the difference between authentication (*who are you?*) and authorization (*what may you do?*), and RBAC.

**Build:**
- `POST /auth/signup`: hash the password with argon2 and always create the user with role `user`.
- `POST /auth/login`: return an access token (15 min) and a refresh token.
- `POST /auth/refresh`, `POST /auth/logout`
- `GET /me`
- An `authenticate` middleware (reads `Authorization: Bearer <token>`) and `requireRole('admin')`.
- `PATCH /users/:id/role` (admin only): promote a user to admin.
- Protect the Phase 2 write endpoints so they're admin only.
- Seed the first admin from env vars (`ADMIN_EMAIL`, `ADMIN_PASSWORD`).

**Done when:** a regular user gets a **403** when trying to create a movie, a request with no token gets a **401**, and the admin succeeds.

**Self-check:**
- Why must the password never be returned in any response, even hashed?
- Why does login say "invalid credentials" and not "email not found"?
- What's inside a JWT? Can the user read it? Can they change it?

---

## Phase 4: Showtimes and scheduling (2 days)

**Learn:** business rules, time handling, and turning DB errors into friendly API errors.

**Build (admin):**
- `POST /showtimes` with `{ movieId, hallId, startsAt, priceCents }`. Compute `ends_at = starts_at + duration (+ cleaning buffer)`.
- `PATCH /showtimes/:id` and `DELETE /showtimes/:id` (only if there are no reservations, or cancel them all; your choice).
- Map the exclusion-constraint violation (Postgres error `23P01`) to **409 Conflict: "Hall is busy at that time"**.
- Reject showtimes in the past.

**Done when:** creating two overlapping showtimes in the same hall returns a 409, and overlapping showtimes in different halls are allowed.

**Self-check:** why put the overlap check in the database, not only in the service?

---

## Phase 5: Browsing and seat availability (2 days)

**Learn:** JOINs, LEFT JOINs, filtering by date ranges, and timezones.

**Build:**
- `GET /movies/showtimes?date=2026-10-20`: movies with their showtimes on that day (nested JSON).
- `GET /showtimes/:id/seats`: every seat in the hall with `available: true/false`.
  Hint: `seats LEFT JOIN reservation_seats ON seat_id AND showtime_id AND active`.

**Done when:** the seat map changes after you insert a reservation by hand in the DB.

**Self-check:**
- Which date means "a day" for a user in Mexico City vs. one in Madrid? How does your query handle it?
- Run `EXPLAIN ANALYZE` on the seats query. Is it using your indexes?

---

## Phase 6: Reservations ⭐ the core challenge (3–4 days)

**Learn:** transactions, isolation, race conditions, row locks, and idempotency.

**Build:**
- `POST /reservations` with `{ showtimeId, seatIds: [..] }`, in **one transaction**:
  1. Check that the showtime exists and is in the future.
  2. Check that every seat belongs to that showtime's hall.
  3. Insert the reservation and its seat rows. If the unique index fails (Postgres `23505`), **roll back** and return **409 "Seat(s) already taken"**.
  4. Compute the total on the server. Never trust a price sent by the client.
- `GET /reservations/me`: list the user's reservations with movie, time and seats.
- `DELETE /reservations/:id` (or `POST /reservations/:id/cancel`): only the owner, only if `starts_at > now()`. Mark it cancelled and free the seats.

**The concurrency experiment (do this!):** write a script that sends 20 requests at the same time for
the same seat. Exactly **1** should succeed and **19** should get a 409. Then temporarily remove the unique
index and watch overbooking happen. That's when this phase clicks.

**Done when:** the experiment passes, and cancelling a past reservation returns 400 or 409.

**Self-check:**
- What does "atomic" mean? What happens to step 3 if step 4 throws?
- Compare the *optimistic* approach (unique constraint) and the *pessimistic* one (`SELECT ... FOR UPDATE`). When would you choose each?
- Why should user A get a **404** (not a 403) when trying to cancel user B's reservation?

---

## Phase 7: Admin reporting (2 days)

**Learn:** aggregations (`COUNT`, `SUM`, `GROUP BY`), CTEs, and maybe views.

**Build (admin only):**
- `GET /admin/reservations?showtimeId=&from=&to=&status=`: paginated.
- `GET /admin/reports/showtimes?from=&to=`: per showtime, show seats sold, capacity, occupancy %, and revenue.
- `GET /admin/reports/movies?from=&to=`: revenue and tickets per movie.

**Done when:** the numbers match what you calculate by hand from the seed data.

**Self-check:** do cancelled reservations count toward revenue? Make sure your queries follow your answer.

---

## Phase 8: Testing (ongoing, 2 days to catch up)

**Learn:** the test pyramid, test databases, and fixtures.

**Build:**
- **Unit tests** for the service rules (price calculation, the "can cancel?" rule).
- **Integration tests** with Supertest against a real Postgres test DB: auth flow, a 403 for non-admins, reserving and cancelling, the 409 on double booking.
- Turn the concurrency experiment from Phase 6 into an automated test.

**Done when:** `pnpm test` is green and covers each "Done when" from Phases 2–7.

---

## Phase 9: Hardening (2 days)

**Learn:** the OWASP Top 10 basics, rate limiting, logging, and API documentation.

**Build:**
- `helmet` (security headers), `cors` with an allow-list, and `express-rate-limit` on `/auth/*`.
- Request logging with pino, including a request id.
- An OpenAPI spec and Swagger UI at `/docs`.
- Poster uploads (optional): `multer`, then store the file in S3, R2 or Neon storage and save the URL.
- Review every endpoint: Is input validated? Is ownership checked? Does it leak data?

---

## Phase 10: Docker, CI and deploy (2 days)

**Learn:** containers, CI pipelines, and production config.

**Build:**
- A multi-stage `Dockerfile` for the API, plus `docker compose up` that runs the API and Postgres together.
- GitHub Actions: lint, typecheck, and tests (with a Postgres service) on every push.
- Deploy to Render, Railway or Fly.io, with **Neon** as the production database. Run migrations on deploy.

**Done when:** a public URL serves `/health` and `/docs`.

---

## Phase 11: Extensions (choose any)

- **Temporary seat holds:** a seat is held for 10 minutes while the user "pays" (Redis with TTL, or a `held_until` column plus a cleanup job).
- **Payments:** Stripe Checkout in test mode, with webhooks that confirm the reservation.
- **Email notifications:** a confirmation email via Resend, sent from a background job queue (BullMQ + Redis).
- **Caching:** cache `GET /movies/showtimes?date=` in Redis and invalidate it when showtimes change.
- **Rebuild it in NestJS or FastAPI** and compare how each framework solves the same problems.

---

## How to use this plan with Claude

- Ask for **hints, not code**, when you're stuck: *"Give me a hint for Phase 6 step 3, don't write the code."*
- Ask for a **review** after each phase: *"Review my Phase 3 auth code"* (or run `/code-review`).
- Use `/security-review` after Phases 3 and 9.
- Ask *"Quiz me on Phase 1"* to test yourself with the self-check questions.

**Estimated total:** about 4–6 weeks at 1–2 hours/day.
