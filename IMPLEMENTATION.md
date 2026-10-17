# Implementation Log

This file records **what was actually built** for each phase of [`PLAN.md`](PLAN.md), step by step:
the commands, the files, *why* each decision was made, and how to verify it.
`PLAN.md` is the map; this file is the journey.

## Progress

- [x] Phase 0: Foundations and setup
- [ ] Phase 1: Data modeling
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
npm run dev               # API on http://localhost:3000, restarts on file changes
curl localhost:3000/health
```

| Script | What it does |
|--------|--------------|
| `npm run dev` | Runs the API with auto-reload (`tsx watch`) |
| `npm start` | Runs the API once, without watching |
| `npm run typecheck` | Checks types with `tsc` (no output files) |
| `npm run db:up` / `db:down` | Starts or stops the Postgres container |

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

### Next: Phase 1, data modeling

Before writing code, draw the tables on paper or in [dbdiagram.io](https://dbdiagram.io) using
the model in `PLAN.md` → Phase 1, then answer its self-check questions.
After that we'll add Drizzle, write `src/db/schema.ts`, create the first migration and seed the data.
