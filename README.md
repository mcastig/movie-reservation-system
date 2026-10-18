# Movie Reservation API

[![CI](https://github.com/mcastig/movie-reservation-system/actions/workflows/ci.yml/badge.svg)](https://github.com/mcastig/movie-reservation-system/actions/workflows/ci.yml)

A backend for a cinema: users sign up, browse movies and showtimes, pick seats on a seat map and book them. Admins manage the
catalog and the schedule, and see occupancy and revenue reports.

**Live demo:** https://movie-reservation-api-q5am.onrender.com/docs (Swagger UI; the free plan sleeps, so the first request
can take about a minute). Demo login: `user@example.com` / `user-password`.

Built as a learning project, phase by phase: [PLAN.md](PLAN.md) is the roadmap and [IMPLEMENTATION.md](IMPLEMENTATION.md)
explains every step and decision. The original brief is in [specs.md](specs.md).

## Highlights

- **No overbooking, enforced by the database.** A partial unique index allows one active reservation per seat per showtime,
  so two people booking the same seat at the same moment can't both succeed (tested with truly concurrent requests).
- **No double-booked halls.** A Postgres exclusion constraint rejects showtimes that overlap in the same hall, including a
  cleaning buffer between shows.
- **Prices computed on the server**, never taken from the request; reservations keep the price paid.
- **Auth done carefully:** argon2 password hashes, 15-minute JWTs, rotating refresh tokens stored as hashes, and reuse
  detection that revokes every session.
- **Reports in SQL:** capacity, tickets sold, occupancy and revenue per showtime and per movie.
- **Production basics:** validated config, structured logs with request ids, security headers, CORS allow-list, rate limits,
  OpenAPI docs generated from the validation schemas, Docker image, CI, and deploy.

## Stack

TypeScript on Node 24 · Express 5 · PostgreSQL 17 · Drizzle ORM · Zod · Vitest + Supertest · pino · Docker · GitHub Actions ·
Render + Neon

## Getting started

Requirements: Node 24+, Docker.

```bash
npm install
cp .env.example .env          # then set JWT_SECRET (openssl rand -base64 48)
npm run db:up                 # Postgres in Docker
npm run db:migrate            # create the tables
npm run db:seed               # sample data (wipes the database first)
npm run dev                   # http://localhost:3000, docs at /docs
```

The seed creates an admin (`admin@example.com` / `admin-password`), a demo user (`user@example.com` / `user-password`),
3 movies, 2 halls with 64 seats, and 3 days of showtimes.

To run the API itself in a container, next to Postgres: `docker compose up --build` (API on http://localhost:8080).

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start the API with reload on save |
| `npm start` | Start the API with plain Node (as in production) |
| `npm test` | All tests: unit + integration (needs `npm run db:up`) |
| `npm run test:unit` | Only the unit tests (no database) |
| `npm run lint` / `npm run typecheck` | Biome lint / TypeScript check |
| `npm run db:up` / `db:down` | Start / stop Postgres |
| `npm run db:generate` | Create a migration from changes in `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Reset the database to the sample data (refuses in production) |
| `npm run db:studio` | Browse the database in Drizzle Studio |
| `npm run race` | The overbooking experiment: many concurrent bookings of one seat |

## API

Full, interactive documentation is served at `/docs` (OpenAPI at `/openapi.json`). Overview:

| Endpoint | Access |
|----------|--------|
| `GET /health` | Public |
| `POST /auth/signup`, `/auth/login`, `/auth/refresh`, `/auth/logout` | Public (rate-limited) |
| `GET /genres`, `GET /movies`, `GET /movies/:id`, `GET /movies/showtimes?date=` | Public |
| `GET /showtimes/:id`, `GET /showtimes/:id/seats` | Public |
| `GET /me` | Logged in |
| `POST /reservations`, `GET /reservations/me`, `GET /reservations/:id`, `POST /reservations/:id/cancel` | Logged in (own reservations) |
| `POST /genres`; `POST`, `PATCH`, `DELETE /movies` and `/showtimes` | Admin |
| `PATCH /users/:id/role` | Admin |
| `GET /admin/reservations`, `/admin/reports/showtimes`, `/admin/reports/movies` | Admin |

Send the access token as `Authorization: Bearer <token>`. Errors always look like
`{ "error": { "code": "SEAT_TAKEN", "message": "...", "details": ... } }`. [requests.http](requests.http) has ready-made
requests for VS Code's REST Client.

## Project structure

```
src/
├── app.ts              # builds the Express app (middleware order, routers)
├── server.ts           # starts it, graceful shutdown
├── config/env.ts       # every setting, validated at startup
├── db/                 # schema, client, migrations runner, seed
├── docs/openapi.ts     # OpenAPI document generated from the Zod schemas
├── lib/                # errors, shared schemas, logger
├── middleware/         # auth, validation, errors, logging, security
└── modules/            # auth, users, genres, movies, showtimes, reservations, admin
                        #   each: *.routes.ts (HTTP) → *.service.ts (rules + queries) → *.schemas.ts
drizzle/                # SQL migrations
tests/unit, tests/integration
```

## Configuration

All settings are environment variables, validated by [src/config/env.ts](src/config/env.ts); see
[.env.example](.env.example) for the full list with comments. Required: `DATABASE_URL` and `JWT_SECRET` (32+ characters).

## Testing

`npm test` runs ~100 tests. Integration tests use a separate `movies_test` database in the same Postgres (created and
migrated automatically, and the suite refuses to run on any database whose name doesn't end in `_test`). The data is reset
before every test. CI runs lint, typecheck and the tests on every push, against a Postgres service container.

## Deployment

The [Dockerfile](Dockerfile) builds a small image that runs migrations and then the server. [render.yaml](render.yaml)
deploys it to Render after CI passes, with the database on Neon. Details in the Phase 10 section of IMPLEMENTATION.md.
