import { defineConfig } from "vitest/config";
import { testEnv } from "./tests/test-env.ts";

export default defineConfig({
  test: {
    // Applied to every test worker, so src/config/env.ts validates these values
    // instead of your .env (which points at the dev database).
    env: testEnv,
    // Integration tests share one database, so test files must run one at a time.
    fileParallelism: false,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          // Pure functions and schemas: no database needed.
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          // Once per run: create the test database if needed and migrate it.
          globalSetup: ["tests/integration/global-setup.ts"],
          // In every test file: reset and seed the database before each test.
          setupFiles: ["tests/integration/setup.ts"],
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
