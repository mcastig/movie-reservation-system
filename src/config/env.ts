import { z } from "zod";

// Every setting the app needs, validated once at startup.
// If something is missing or invalid the process exits immediately
// instead of failing later in the middle of a request.
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  // Short-lived access tokens limit the damage if one leaks; refresh tokens renew them.
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  // Time to clean a hall between two showtimes; added to every showtime's ends_at.
  CLEANING_BUFFER_MINUTES: z.coerce.number().int().min(0).default(15),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
