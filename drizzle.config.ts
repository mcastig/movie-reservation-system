import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside our npm scripts' --env-file flag, so load .env here.
// In CI or production there is no .env file and the variables already exist.
try {
  process.loadEnvFile();
} catch {}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
