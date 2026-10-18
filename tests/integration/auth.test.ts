import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { adminToken, api, bearer, signUpAndLogIn, tokenFor, userToken } from "./helpers.ts";

// Phase 3: authentication (401) and authorization (403).

const movie = { title: "Arrival", description: "Aliens arrive.", durationMinutes: 116 };

describe("protected writes (Phase 3 'done when')", () => {
  it("401 without a token, 403 for a regular user, 201 for the admin", async () => {
    await api().post("/movies").send(movie).expect(401);
    await api().post("/movies").set(bearer(await userToken())).send(movie).expect(403);
    await api().post("/movies").set(bearer(await adminToken())).send(movie).expect(201);
  });

  it("keeps reads public", async () => {
    await api().get("/movies").expect(200);
  });
});

describe("signup", () => {
  it("normalizes the email, creates a regular user and never returns the password", async () => {
    const res = await api()
      .post("/auth/signup")
      .send({ email: " Ana@Example.COM ", password: "correct-horse", name: "Ana" })
      .expect(201);
    expect(res.body).toMatchObject({ email: "ana@example.com", role: "user" });
    expect(JSON.stringify(res.body)).not.toMatch(/password|argon2/i);
  });

  it("treats emails case-insensitively for duplicates", async () => {
    await signUpAndLogIn("ana@example.com");
    const res = await api().post("/auth/signup").send({ email: "ANA@example.com", password: "another-pass", name: "Ana" }).expect(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("can't be used to become an admin", async () => {
    await api().post("/auth/signup").send({ email: "evil@example.com", password: "password123", name: "Evil", role: "admin" }).expect(400);
  });
});

describe("login", () => {
  it("gives the same answer for a wrong password and an unknown email", async () => {
    const wrong = await api().post("/auth/login").send({ email: "user@example.com", password: "nope-nope" }).expect(401);
    const unknown = await api().post("/auth/login").send({ email: "ghost@example.com", password: "nope-nope" }).expect(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it("returns tokens, and /me identifies the user", async () => {
    const res = await api().post("/auth/login").send({ email: "USER@example.com", password: "user-password" }).expect(200);
    expect(res.body).toMatchObject({ tokenType: "Bearer", expiresIn: 900 });

    const me = await api().get("/me").set(bearer(res.body.accessToken)).expect(200);
    expect(me.body).toMatchObject({ id: 2, email: "user@example.com", role: "user" });
  });
});

describe("access tokens", () => {
  it("rejects missing, garbage, tampered, unsigned and expired tokens", async () => {
    await api().get("/me").expect(401);
    await api().get("/me").set(bearer("abc.def.ghi")).expect(401);

    // Same signature, payload edited to claim admin.
    const [header, , signature] = (await userToken()).split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ role: "admin", sub: "2", exp: 1999999999 })).toString("base64url");
    await api().get("/me").set(bearer(`${header}.${forgedPayload}.${signature}`)).expect(401);

    // "alg": "none" with no signature at all.
    const none = jwt.sign({ role: "admin" }, "", { algorithm: "none", subject: "1" });
    await api().get("/me").set(bearer(none)).expect(401);

    // Correctly signed but expired.
    const expired = jwt.sign({ role: "admin" }, process.env.JWT_SECRET!, { subject: "1", expiresIn: -10 });
    const res = await api().get("/me").set(bearer(expired)).expect(401);
    expect(res.body.error.code).toBe("TOKEN_EXPIRED");
  });
});

describe("refresh tokens", () => {
  async function login() {
    const res = await api().post("/auth/login").send({ email: "user@example.com", password: "user-password" });
    return res.body as { accessToken: string; refreshToken: string };
  }

  it("rotates: each refresh token works once and returns a new pair", async () => {
    const { refreshToken } = await login();
    const next = await api().post("/auth/refresh").send({ refreshToken }).expect(200);
    expect(next.body.refreshToken).not.toBe(refreshToken);
    await api().get("/me").set(bearer(next.body.accessToken)).expect(200);
  });

  it("revokes every session when an old refresh token is reused", async () => {
    const { refreshToken: r0 } = await login();
    const r1 = (await api().post("/auth/refresh").send({ refreshToken: r0 })).body.refreshToken;

    await api().post("/auth/refresh").send({ refreshToken: r0 }).expect(401); // replay
    await api().post("/auth/refresh").send({ refreshToken: r1 }).expect(401); // collateral
  });

  it("logs out by revoking the refresh token; logging out twice is fine", async () => {
    const { refreshToken, accessToken } = await login();
    await api().post("/auth/logout").send({ refreshToken }).expect(204);
    await api().post("/auth/logout").send({ refreshToken }).expect(204);
    await api().post("/auth/refresh").send({ refreshToken }).expect(401);
    // The access token is still valid until it expires (documented trade-off).
    await api().get("/me").set(bearer(accessToken)).expect(200);
  });
});

describe("roles", () => {
  it("lets an admin promote a user, effective at the next login", async () => {
    const ana = await signUpAndLogIn("ana@example.com");
    const admin = await adminToken();

    await api().patch("/users/3/role").set(bearer(ana)).send({ role: "admin" }).expect(403);
    await api().patch("/users/3/role").set(bearer(admin)).send({ role: "admin" }).expect(200);

    await api().post("/genres").set(bearer(ana)).send({ name: "Old token" }).expect(403);
    const fresh = await tokenFor("ana@example.com", "test-password");
    await api().post("/genres").set(bearer(fresh)).send({ name: "New token" }).expect(201);
  });

  it("doesn't let admins change their own role", async () => {
    const res = await api().patch("/users/1/role").set(bearer(await adminToken())).send({ role: "user" }).expect(403);
    expect(res.body.error.code).toBe("CANNOT_CHANGE_OWN_ROLE");
  });
});
