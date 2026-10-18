import { hash, verify } from "argon2";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { env } from "../../config/env.ts";
import { db } from "../../db/client.ts";
import { refreshTokens, users } from "../../db/schema.ts";
import { ConflictError, isPgError, PG_UNIQUE_VIOLATION, UnauthorizedError } from "../../lib/errors.ts";
import { publicUserColumns } from "../users/users.service.ts";
import type { LoginInput, SignupInput } from "./auth.schemas.ts";
import { type AuthUser, hashToken, issueRefreshToken, signAccessToken } from "./tokens.ts";

// Verified against when the email doesn't exist, so a wrong email takes as long
// as a wrong password. Otherwise response times reveal which emails have accounts.
const DUMMY_HASH = await hash("not-a-real-password");

export async function signup({ email, password, name }: SignupInput) {
  try {
    const [user] = await db
      .insert(users)
      // role is never taken from the request: everyone signs up as a regular user.
      .values({ email, passwordHash: await hash(password), name, role: "user" })
      .returning(publicUserColumns);
    return user!;
  } catch (err) {
    if (isPgError(err, PG_UNIQUE_VIOLATION)) {
      throw new ConflictError("EMAIL_TAKEN", "An account with this email already exists");
    }
    throw err;
  }
}

async function issueTokens(user: AuthUser, executor: Parameters<typeof issueRefreshToken>[0] = db) {
  return {
    tokenType: "Bearer",
    accessToken: signAccessToken(user),
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    refreshToken: await issueRefreshToken(executor, user.id),
  };
}

export async function login({ email, password }: LoginInput) {
  // lower(email) matches the unique index from Phase 1, so this lookup uses it.
  const [user] = await db
    .select({ id: users.id, role: users.role, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email));

  const valid = await verify(user?.passwordHash ?? DUMMY_HASH, password);
  if (!user || !valid) {
    // Same message either way: never reveal whether the email exists.
    throw new UnauthorizedError("INVALID_CREDENTIALS", "Invalid email or password");
  }
  return issueTokens(user);
}

// Rotation: each refresh token works once. Using it revokes it and returns a new pair.
export async function refresh(refreshToken: string) {
  const tokenHash = hashToken(refreshToken);

  const tokens = await db.transaction(async (tx) => {
    // Revoke-and-check in ONE statement. If two requests race with the same
    // token, only one UPDATE can match the "revoked_at is null" row.
    const [used] = await tx
      .update(refreshTokens)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, sql`now()`),
        ),
      )
      .returning({ userId: refreshTokens.userId });

    if (!used) {
      // An already-revoked token being used again means it was probably stolen:
      // either the thief or the real user already exchanged it. We can't tell
      // which, so revoke every session of that user and make them log in again.
      const [old] = await tx
        .select({ userId: refreshTokens.userId, revokedAt: refreshTokens.revokedAt })
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash));
      if (old?.revokedAt) await revokeAllSessions(tx, old.userId);
      // Return instead of throwing: a throw here would roll back that revocation.
      return null;
    }

    // Read the role now, not from the old token, so a promotion or demotion
    // takes effect at the next refresh.
    const [user] = await tx
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, used.userId));
    return issueTokens(user!, tx);
  });

  if (!tokens) throw new UnauthorizedError("INVALID_REFRESH_TOKEN", "Refresh token is invalid or expired");
  return tokens;
}

async function revokeAllSessions(executor: Pick<typeof db, "update">, userId: number) {
  await executor
    .update(refreshTokens)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}

// Always succeeds, even for unknown tokens: logging out twice isn't an error.
// The access token stays valid until it expires (at most ACCESS_TOKEN_TTL_SECONDS);
// that's the trade-off for checking access tokens without a database query.
export async function logout(refreshToken: string) {
  await db
    .update(refreshTokens)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(refreshTokens.tokenHash, hashToken(refreshToken)), isNull(refreshTokens.revokedAt)));
}
