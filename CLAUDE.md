# CLAUDE.md

Guidance for Claude Code in this repository. README.md describes the project; this file is about how to work on it.

## This is a learning project

The owner is learning backend development by building this API phase by phase ([PLAN.md](PLAN.md)). The goal is
**understanding**, not just working code:

- Explain every change: what it does, why, and the alternatives. Prefer small, readable code over clever code.
- After a phase or significant change, add a section to [IMPLEMENTATION.md](IMPLEMENTATION.md) in the existing format:
  files changed, numbered steps with the reasoning, a verification table with real results, and "Try it yourself" exercises.
- When asked for hints, give hints, not code.

## Commands

```bash
npm run db:up        # Postgres in Docker (needed by integration tests and dev)
npm run dev          # API on :3000 with reload
npm test             # unit + integration
npm run lint         # Biome (lint only; the formatter is off)
npm run typecheck    # tsc --noEmit
npm run db:generate  # after changing src/db/schema.ts; review the SQL it writes
npm run db:migrate   # apply migrations (src/db/migrate.ts)
```

Run lint, typecheck and tests before every commit.

## Code conventions

- **ESM TypeScript run directly by Node 24** (type stripping): relative imports end in `.ts`, and `erasableSyntaxOnly` is on, so
  no enums, namespaces or constructor parameter properties. `verbatimModuleSyntax`: use `import type` for type-only imports.
  `noUncheckedIndexedAccess` is on; `rows[0]!` is accepted style when a row must exist.
- **Modules** in `src/modules/<name>/`: `*.routes.ts` (HTTP only), `*.service.ts` (rules and queries), `*.schemas.ts` (Zod).
  Validate input with the `validate()` middleware; protect routes with `authenticate` and `requireRole("admin")`.
- **Errors**: throw the classes from `src/lib/errors.ts` (`NotFoundError`, `ConflictError`, ...). The error handler turns them
  into `{ error: { code, message, details? } }`. Never leak internal details in responses.
- **Database rules live in the database** where possible (unique indexes, exclusion constraints, FKs, checks); the code maps
  their violations (`isPgError`) to clean API errors. Money is integer cents. Times are `timestamptz`, in UTC.
- **New settings** go in `src/config/env.ts` (validated, with a default if optional) and in `.env.example` with a comment.
- **New endpoints** also go in `src/docs/openapi.ts` (the hardening test checks the path count) and get integration tests.
- Comments explain *why*, in plain English, at the density of the surrounding code.

## Tests

- Integration tests run against `movies_test` (never the dev database), reset by `seedDatabase()` before each test, one file
  at a time. Seed ids are stable: showtime 1, seat 9 = B1, etc.
- `tests/integration/concurrency.test.ts` sends truly concurrent requests. It failed once in ~20 runs without saved output;
  if it fails again, capture the output before re-running.

## Git

- **Atomic commits**: one logical change each, with a body explaining what and why (the owner reads them to learn).
- **No attribution lines**: no `Co-Authored-By` and no "Generated with Claude Code" in commits or PRs.
- **Every intermediate commit must pass** lint, typecheck and tests. Check them all before pushing, and don't push if any fail.
- **Pushing to `main` deploys production**: CI runs, then Render deploys. Ask before pushing.

## Environment and safety

- Don't kill processes you didn't start (e.g. with `pkill`): the owner usually has `npm run dev` running on port 3000. Use
  another port for your own servers (e.g. `PORT=3999`) and stop only those.
- `.env` (local) and `.env.neon` (the production Neon database) hold secrets. Never commit them, print them, or echo
  passwords into the chat. `npm run db:seed` wipes the target database: never run it against Neon without explicit approval.
- Production: Render service `movie-reservation-api` (https://movie-reservation-api-q5am.onrender.com), database on Neon
  (Postgres 18). `TRUST_PROXY_HOPS` is not verified yet: the rate limiter still sees a different key per request on Render.
