import cors from "cors";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { AppError } from "../lib/errors.ts";

// Security headers: X-Content-Type-Options: nosniff, Strict-Transport-Security,
// a Content-Security-Policy, no X-Powered-By, and more. Cheap, and mostly matters
// for anything a browser renders (like /docs).
export const securityHeaders = helmet();

// CORS only affects BROWSERS: it decides which other websites' JavaScript may read
// our responses. curl, mobile apps and servers ignore it, so it's not access control.
// With an empty allow-list, no cross-origin page can call the API.
export function corsFor(allowedOrigins: string[]) {
  return cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["X-Request-Id", "Location"],
  });
}

export type RateLimitOptions = { limit: number; windowMinutes: number };

// At most `limit` requests per IP per window. Used twice in app.ts: a generous limit
// for the whole API (stops one client from flooding it) and a strict one on /auth
// (slows down password guessing and signup spam).
// Counts are kept in memory, which is fine for one server process. With several
// instances behind a load balancer, use a shared store (Redis) so the limit is global.
export function rateLimiter({ limit, windowMinutes }: RateLimitOptions) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    // Sends the standard RateLimit and RateLimit-Policy headers so clients can back off.
    standardHeaders: "draft-8",
    legacyHeaders: false,
    // Reply with our usual error shape instead of the library's plain text.
    handler: (_req, _res, next, options) => {
      next(new AppError(options.statusCode, "TOO_MANY_REQUESTS", "Too many attempts, please try again later"));
    },
  });
}
