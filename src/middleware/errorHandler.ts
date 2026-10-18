import type { ErrorRequestHandler, RequestHandler, Response } from "express";
import {
  AppError,
  isPgError,
  NotFoundError,
  PG_EXCLUSION_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
  PG_UNIQUE_VIOLATION,
} from "../lib/errors.ts";

// Registered after every router: if no route matched, this one runs.
export const notFound: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
};

function send(res: Response, status: number, code: string, message: string, details?: unknown) {
  res.status(status).json({ error: { code, message, ...(details !== undefined && { details }) } });
}

// Express recognizes an error handler by its four parameters (err, req, res, next).
export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  // Too late to send a JSON error; let Express close the connection.
  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    return send(res, err.status, err.code, err.message, err.details);
  }

  // Errors from express.json(): malformed JSON, body too large, etc.
  if (err?.type === "entity.parse.failed") {
    return send(res, 400, "INVALID_JSON", "Request body is not valid JSON");
  }
  if (typeof err?.status === "number" && err.status >= 400 && err.status < 500) {
    return send(res, err.status, "BAD_REQUEST", err.message);
  }

  // Safety net for constraint violations a service didn't translate itself.
  if (isPgError(err, PG_UNIQUE_VIOLATION)) {
    return send(res, 409, "CONFLICT", "A record with these values already exists");
  }
  if (isPgError(err, PG_EXCLUSION_VIOLATION)) {
    return send(res, 409, "CONFLICT", "This change overlaps with an existing record");
  }
  if (isPgError(err, PG_FOREIGN_KEY_VIOLATION)) {
    return send(res, 409, "CONFLICT", "This change conflicts with related records");
  }

  // Anything else is a bug. Log the details, but never send them to the client.
  console.error(err);
  send(res, 500, "INTERNAL_ERROR", "Something went wrong");
};
