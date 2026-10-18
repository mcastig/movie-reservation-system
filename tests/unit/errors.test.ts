import { describe, expect, it } from "vitest";
import { isPgError, PG_UNIQUE_VIOLATION } from "../../src/lib/errors.ts";

// Builds an error shaped like the ones the pg driver throws.
function pgError(code: string) {
  return Object.assign(new Error("db error"), { code });
}

describe("isPgError", () => {
  it("matches a raw driver error by code", () => {
    expect(isPgError(pgError("23505"), PG_UNIQUE_VIOLATION)).toBe(true);
    expect(isPgError(pgError("23503"), PG_UNIQUE_VIOLATION)).toBe(false);
  });

  it("finds the code inside Drizzle's wrapper (err.cause)", () => {
    const wrapped = new Error("Failed query", { cause: pgError("23505") });
    expect(isPgError(wrapped, PG_UNIQUE_VIOLATION)).toBe(true);
  });

  it("returns false for things that aren't errors", () => {
    expect(isPgError("23505", PG_UNIQUE_VIOLATION)).toBe(false);
    expect(isPgError(undefined, PG_UNIQUE_VIOLATION)).toBe(false);
  });
});
