import express, { type Express } from "express";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env.ts";
import { openApiDocument } from "./docs/openapi.ts";
import { errorHandler, notFound } from "./middleware/errorHandler.ts";
import { requestLogger } from "./middleware/requestLogger.ts";
import { corsFor, type RateLimitOptions, rateLimiter, securityHeaders } from "./middleware/security.ts";
import { adminRouter } from "./modules/admin/admin.routes.ts";
import { authRouter } from "./modules/auth/auth.routes.ts";
import { genresRouter } from "./modules/genres/genres.routes.ts";
import { moviesRouter } from "./modules/movies/movies.routes.ts";
import { reservationsRouter } from "./modules/reservations/reservations.routes.ts";
import { showtimesRouter } from "./modules/showtimes/showtimes.routes.ts";
import { meRouter, usersRouter } from "./modules/users/users.routes.ts";

export type AppOptions = {
  corsOrigins?: string[];
  apiRateLimit?: RateLimitOptions;
  authRateLimit?: RateLimitOptions;
  trustProxyHops?: number;
};

// Builds the Express app without starting a server, so tests can import it and
// send requests directly. Options default to the environment; tests can override
// them (e.g. a tiny rate limit) without changing env vars.
export function createApp({
  corsOrigins = env.CORS_ORIGINS,
  apiRateLimit = { limit: env.API_RATE_LIMIT_MAX, windowMinutes: 1 },
  authRateLimit = { limit: env.AUTH_RATE_LIMIT_MAX, windowMinutes: env.AUTH_RATE_LIMIT_WINDOW_MINUTES },
  trustProxyHops = env.TRUST_PROXY_HOPS,
}: AppOptions = {}): Express {
  const app = express();
  // Makes req.ip the client's address instead of the proxy's (see TRUST_PROXY_HOPS).
  // Without it, behind a proxy every request seems to come from one IP, so the
  // rate limiter would make all users share a single budget.
  app.set("trust proxy", trustProxyHops);

  // TEMPORARY: shows each caller how their own request reached the app, to measure
  // Render's proxy chain. Reverted once TRUST_PROXY_HOPS is confirmed.
  app.use((req, res, next) => {
    res.setHeader(
      "X-Debug-Proxy",
      JSON.stringify({
        ip: req.ip,
        ips: req.ips,
        socket: req.socket.remoteAddress,
        xff: req.headers["x-forwarded-for"],
        realIp: req.headers["x-real-ip"],
        cfIp: req.headers["cf-connecting-ip"],
        trueClientIp: req.headers["true-client-ip"],
      }),
    );
    next();
  });

  // Order matters. First: give every request an id and log it, so even
  // requests rejected by later middleware show up in the logs.
  app.use(requestLogger);
  app.use(securityHeaders);
  app.use(corsFor(corsOrigins));
  app.use(rateLimiter(apiRateLimit));
  // An explicit cap on JSON bodies (100 kB is also Express's default). Our largest
  // body is a movie description, so this is generous.
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // API documentation: the raw OpenAPI JSON, and Swagger UI to explore and try it.
  app.get("/openapi.json", (_req, res) => {
    res.json(openApiDocument);
  });
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));

  app.use("/auth", rateLimiter(authRateLimit), authRouter);
  app.use("/me", meRouter);
  app.use("/users", usersRouter);
  app.use("/genres", genresRouter);
  app.use("/movies", moviesRouter);
  app.use("/showtimes", showtimesRouter);
  app.use("/reservations", reservationsRouter);
  app.use("/admin", adminRouter);

  // Order matters: these run only if nothing above sent a response.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

// The app as configured by the environment: what server.ts runs and most tests use.
const app: Express = createApp();
export default app;
