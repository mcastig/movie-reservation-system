import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { assertTestDatabase, TEST_DATABASE_URL } from "../test-env.ts";

// Runs once, in the main Vitest process, before any integration test file.
export default async function setup() {
  const name = assertTestDatabase(TEST_DATABASE_URL);

  // CREATE DATABASE can't run while connected to the database being created,
  // so connect to the built-in "postgres" database for this step.
  const maintenanceUrl = new URL(TEST_DATABASE_URL);
  maintenanceUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: maintenanceUrl.toString() });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(`Can't reach Postgres for tests. Is it running? (npm run db:up)\n${err}`);
  }
  const exists = await admin.query("select 1 from pg_database where datname = $1", [name]);
  if (exists.rowCount === 0) {
    // Identifiers can't be query parameters; `name` was checked above.
    await admin.query(`create database "${name}"`);
  }
  await admin.end();

  // Apply the same migrations as `npm run db:migrate`, so the test schema is the real one.
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  await migrate(drizzle({ client: pool }), { migrationsFolder: "drizzle" });
  await pool.end();
}
