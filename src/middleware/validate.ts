import type { RequestHandler } from "express";
import type { z } from "zod";
import { ValidationError, type ValidationIssue } from "../lib/errors.ts";

type Schemas = {
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
};

// The type a part has after validation, or `Fallback` if it has no schema.
type Parsed<S, Fallback> = S extends z.ZodType ? z.output<S> : Fallback;

// Checks req.params, req.query and req.body against Zod schemas. On success each
// part is replaced by the parsed value (coerced numbers, trimmed strings, defaults),
// and the next handler gets those types. On failure it reports every problem at once.
export function validate<S extends Schemas>(
  schemas: S,
): RequestHandler<
  Parsed<S["params"], Record<string, string>>,
  unknown,
  Parsed<S["body"], unknown>,
  Parsed<S["query"], Record<string, unknown>>
> {
  return (req, _res, next) => {
    const issues: ValidationIssue[] = [];

    for (const part of ["params", "query", "body"] as const) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(req[part]);
      if (!result.success) {
        for (const issue of result.error.issues) {
          issues.push({ path: [part, ...issue.path].map(String).join("."), message: issue.message });
        }
        continue;
      }
      // Express 5 makes req.query a read-only getter, so plain assignment fails.
      // Defining our own property on this request object replaces it.
      Object.defineProperty(req, part, { value: result.data, writable: true, enumerable: true });
    }

    if (issues.length > 0) return next(new ValidationError(issues));
    next();
  };
}
