import { z } from "zod";
import { timeZoneSchema } from "../lib/schemas.ts";

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
  // IANA name of the cinema's timezone. Decides what "showtimes on 2026-10-20" means.
  THEATER_TIMEZONE: timeZoneSchema.default("UTC"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  // Browser origins allowed to call the API, comma-separated (e.g. "https://app.example.com").
  // Empty (the default) means no cross-origin browser access at all.
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  // At most API_RATE_LIMIT_MAX requests per IP per minute to the whole API...
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  // ...and at most AUTH_RATE_LIMIT_MAX requests to /auth/* per IP in each window.
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  AUTH_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  // How many proxies (load balancers) sit in front of the app. Hosting platforms add
  // one; the client's real IP then arrives in the X-Forwarded-For header. 0 (the default)
  // trusts nobody, so a client can't fake its IP to dodge the rate limits.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
