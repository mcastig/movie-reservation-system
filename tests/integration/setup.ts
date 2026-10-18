import { afterAll, beforeEach } from "vitest";
import { pool } from "../../src/db/client.ts";
import { seedDatabase } from "../../src/db/fixtures.ts";
import { assertTestDatabase } from "../test-env.ts";

// Runs in every integration test file, before its tests.
assertTestDatabase(process.env.DATABASE_URL!);

// Every test starts from the same known data (the seed), so tests never depend
// on each other or on the order they run in.
beforeEach(async () => {
  await seedDatabase();
});

// Close the app's connection pool, or the worker would wait for idle connections.
afterAll(async () => {
  await pool.end();
});
