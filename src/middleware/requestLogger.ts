import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { pinoHttp } from "pino-http";
import { logger } from "../lib/logger.ts";

// Accept a caller's X-Request-Id (e.g. from a load balancer) only if it looks
// harmless; anything else could be used to inject fake lines into the logs.
const SAFE_ID = /^[\w-]{1,64}$/;

// Inside a router mounted at "/auth", Express rewrites req.url to "/login".
// originalUrl keeps the full path the client asked for.
const fullUrl = (req: IncomingMessage) => ("originalUrl" in req ? String(req.originalUrl) : req.url);

function requestId(req: IncomingMessage, res: ServerResponse) {
  const incoming = req.headers["x-request-id"];
  const id = typeof incoming === "string" && SAFE_ID.test(incoming) ? incoming : randomUUID();
  // Sent back, so a user reporting a problem can quote it and we can find the log line.
  res.setHeader("X-Request-Id", id);
  return id;
}

// Logs one line per request when the response finishes: method, URL, status, time.
// Also gives every handler `req.log`, a logger that already includes this request's id.
export const requestLogger = pinoHttp({
  logger,
  genReqId: requestId,
  // 5xx are errors, 4xx are the client's problem (warn), the rest is info.
  customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
  // Health checks run every few seconds in production; logging them is noise.
  autoLogging: { ignore: (req) => req.url === "/health" },
  // A short message ("GET /movies/1 404 (3 ms)") and only the fields we need,
  // instead of every header. Fewer fields also means less personal data to protect.
  customSuccessMessage: (req, res, responseTime) => `${req.method} ${fullUrl(req)} ${res.statusCode} (${responseTime} ms)`,
  customErrorMessage: (req, res) => `${req.method} ${fullUrl(req)} ${res.statusCode}`,
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});
