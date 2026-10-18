import { migrate } from "drizzle-orm/node-postgres/migrator";
import { logger } from "../lib/logger.ts";
import { db, pool } from "./client.ts";

// `npm run db:migrate`, and the first thing the Docker container runs on every start.
// Applies the SQL files in drizzle/ that this database hasn't seen yet, in order,
// and records each one in the drizzle.__drizzle_migrations table. Already-applied
// files are skipped, so running it again is safe.
// It uses drizzle-orm (a runtime dependency) instead of drizzle-kit (a dev tool),
// so the production image doesn't need any dev dependencies.
try {
  await migrate(db, { migrationsFolder: "drizzle" });
  logger.info("Migrations are up to date");
} catch (err) {
  logger.error({ err }, "Migration failed");
  process.exitCode = 1;
} finally {
  await pool.end();
}
