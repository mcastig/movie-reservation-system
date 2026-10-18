import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { errorHandler } from "../../src/middleware/errorHandler.ts";
import { requestLogger } from "../../src/middleware/requestLogger.ts";
import { api, adminToken, bearer } from "./helpers.ts";

// Phase 9: headers, request ids, CORS, rate limiting, docs and the 500 response.

describe("security headers (helmet)", () => {
  it("sets protective headers and hides the framework", async () => {
    const res = await api().get("/health").expect(200);
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["strict-transport-security"]).toMatch(/max-age=/);
    expect(res.headers["content-security-policy"]).toMatch(/default-src 'self'/);
  });
});

describe("request ids", () => {
  it("generates one per request and returns it", async () => {
    const a = await api().get("/health");
    const b = await api().get("/health");
    expect(a.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.headers["x-request-id"]).not.toBe(b.headers["x-request-id"]);
  });

  it("keeps a safe incoming id and replaces an unsafe one", async () => {
    const kept = await api().get("/health").set("X-Request-Id", "lb-1234_abcd");
    expect(kept.headers["x-request-id"]).toBe("lb-1234_abcd");
    const replaced = await api().get("/health").set("X-Request-Id", "evil id; drop table");
    expect(replaced.headers["x-request-id"]).not.toBe("evil id; drop table");
  });
});

describe("CORS", () => {
  const app = createApp({ corsOrigins: ["https://app.example.com"] });
  const preflight = (origin: string) =>
    request(app).options("/movies").set("Origin", origin).set("Access-Control-Request-Method", "POST");

  it("allows listed origins", async () => {
    const res = await preflight("https://app.example.com");
    expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    expect(res.headers["access-control-allow-headers"]).toMatch(/Authorization/);
  });

  it("gives other origins no permission", async () => {
    const res = await preflight("https://evil.example.com");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows no cross-origin access by default", async () => {
    const res = await api().get("/movies").set("Origin", "https://app.example.com");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("rate limiting", () => {
  it("returns 429 after the limit, in the usual error format", async () => {
    const app = createApp({ authRateLimit: { limit: 3, windowMinutes: 15 } });
    const attempt = () => request(app).post("/auth/login").send({ email: "user@example.com", password: "wrong-guess" });

    for (let i = 0; i < 3; i++) await attempt().expect(401);
    const blocked = await attempt().expect(429);
    expect(blocked.body.error.code).toBe("TOO_MANY_REQUESTS");
    expect(blocked.headers["ratelimit-policy"]).toMatch(/q=3/);

    // Even the right password is blocked now: that's what stops guessing.
    await request(app).post("/auth/login").send({ email: "user@example.com", password: "user-password" }).expect(429);
    // Other routes have their own, more generous limit.
    await request(app).get("/movies").expect(200);
  });

  it("also limits the whole API, with a more generous budget", async () => {
    const app = createApp({ apiRateLimit: { limit: 5, windowMinutes: 1 } });
    for (let i = 0; i < 5; i++) await request(app).get("/movies").expect(200);
    const blocked = await request(app).get("/genres").expect(429);
    expect(blocked.body.error.code).toBe("TOO_MANY_REQUESTS");
  });
});

describe("request size", () => {
  it("rejects bodies over 100 kB with a JSON 413", async () => {
    const res = await api()
      .post("/genres")
      .set(bearer(await adminToken()))
      .send({ name: "x".repeat(200_000) })
      .expect(413);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });
});

describe("API docs", () => {
  it("serves the OpenAPI document generated from the Zod schemas", async () => {
    const res = await api().get("/openapi.json").expect(200);
    expect(res.body.openapi).toBe("3.1.0");
    expect(Object.keys(res.body.paths)).toHaveLength(21);

    const booking = res.body.paths["/reservations"].post;
    expect(booking.security).toEqual([{ bearerAuth: [] }]);
    expect(booking.requestBody.content["application/json"].schema).toMatchObject({
      required: ["showtimeId", "seatIds"],
      additionalProperties: false,
    });
  });

  it("serves Swagger UI and its assets under the security headers", async () => {
    const page = await api().get("/docs/").expect(200);
    expect(page.text).toContain("swagger-ui");
    await api().get("/docs/swagger-ui-bundle.js").expect(200);
    await api().get("/docs/swagger-ui-init.js").expect(200);
  });
});

describe("unexpected errors", () => {
  // A tiny app with the real logger and error handler, and a route that crashes.
  const app = express();
  app.use(requestLogger);
  app.get("/boom", () => {
    throw new Error("secret internal detail");
  });
  app.use(errorHandler);

  it("answers 500 with the request id and no internal details", async () => {
    const res = await request(app).get("/boom").expect(500);
    expect(res.body.error).toEqual({
      code: "INTERNAL_ERROR",
      message: "Something went wrong",
      requestId: res.headers["x-request-id"],
    });
    expect(res.text).not.toContain("secret internal detail");
  });
});
