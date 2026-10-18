// Errors the app throws on purpose. The error handler turns each one into
// { error: { code, message, details? } } with the matching HTTP status.
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type ValidationIssue = { path: string; message: string };

export class ValidationError extends AppError {
  constructor(issues: ValidationIssue[], message = "Invalid request") {
    super(400, "VALIDATION_ERROR", message, issues);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, "NOT_FOUND", message);
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string) {
    super(409, code, message);
  }
}

// Postgres error codes we react to. Full list: postgresql.org/docs/current/errcodes-appendix.html
export const PG_FOREIGN_KEY_VIOLATION = "23503";
export const PG_UNIQUE_VIOLATION = "23505";

// Drizzle wraps driver errors in a DrizzleQueryError, with the original
// Postgres error (which has the code) in `cause`. This checks both levels.
export function isPgError(err: unknown, code: string): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    if ("code" in e && e.code === code) return true;
  }
  return false;
}
