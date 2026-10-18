// Environment for the test run. Shared by vitest.config.ts (for the test workers)
// and the integration global setup (which runs in the main Vitest process).

// A SEPARATE database in the same Postgres container. Tests wipe it constantly,
// so it must never be your dev database. The name must end in "_test" (checked).
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://movies:movies@localhost:5432/movies_test";

export const testEnv = {
  NODE_ENV: "test",
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_SECRET: "test-only-secret-that-is-at-least-32-characters",
  THEATER_TIMEZONE: "UTC",
  CLEANING_BUFFER_MINUTES: "15",
};

export function assertTestDatabase(url: string) {
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to run tests against "${name}": the database name must end in "_test".`);
  }
  return name;
}
