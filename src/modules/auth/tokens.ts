import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../../config/env.ts";
import { db } from "../../db/client.ts";
import { refreshTokens, userRole } from "../../db/schema.ts";

export type AuthUser = { id: number; role: (typeof userRole.enumValues)[number] };

// --- Access tokens: signed JWTs, checked without touching the database ---

// What we put inside the token. `sub` (subject) is the standard claim for "who".
const accessTokenPayload = z.object({
  sub: z.string().regex(/^\d+$/),
  role: z.enum(userRole.enumValues),
});

export function signAccessToken(user: AuthUser): string {
  return jwt.sign({ role: user.role }, env.JWT_SECRET, {
    algorithm: "HS256",
    subject: String(user.id),
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  });
}

// Throws jsonwebtoken's errors (TokenExpiredError, JsonWebTokenError) or a ZodError.
export function verifyAccessToken(token: string): AuthUser {
  // Pinning the algorithm stops a forged token from choosing a weaker one (e.g. "none").
  const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] });
  const payload = accessTokenPayload.parse(decoded);
  return { id: Number(payload.sub), role: payload.role };
}

// --- Refresh tokens: random strings, stored (hashed) so they can be revoked ---

// SHA-256 is enough here (argon2 would be overkill): the token is 32 random bytes,
// so there is nothing to guess, unlike a human-chosen password.
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

type Executor = Pick<typeof db, "insert">;

export async function issueRefreshToken(executor: Executor, userId: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await executor.insert(refreshTokens).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
  });
  return token;
}
