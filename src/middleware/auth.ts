import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { ForbiddenError, UnauthorizedError } from "../lib/errors.ts";
import { type AuthUser, verifyAccessToken } from "../modules/auth/tokens.ts";

// These middlewares only read headers and req.user, so they accept any
// params/body/query types. That lets them sit in front of validate() without
// TypeScript forcing the route's params back to plain strings.
type AnyHandler = RequestHandler<any, any, any, any>;

// Adds `req.user` to Express's Request type for every file in the project.
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// Authentication: "who are you?" Reads `Authorization: Bearer <token>`,
// verifies the JWT and puts { id, role } on req.user. No database query.
export const authenticate: AnyHandler = (req, _res, next) => {
  const [scheme, token] = req.get("authorization")?.split(" ") ?? [];
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return next(new UnauthorizedError("UNAUTHENTICATED", "Missing or malformed Authorization header"));
  }

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch (err) {
    // A separate code tells the client "call /auth/refresh", not "log in again".
    if (err instanceof jwt.TokenExpiredError) {
      return next(new UnauthorizedError("TOKEN_EXPIRED", "Access token has expired"));
    }
    next(new UnauthorizedError("INVALID_TOKEN", "Access token is invalid"));
  }
};

// Authorization: "what may you do?" Must run after authenticate.
export function requireRole(...roles: AuthUser["role"][]): AnyHandler {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new UnauthorizedError("UNAUTHENTICATED", "Authentication required"));
    }
    if (!roles.includes(req.user.role)) {
      return next(new ForbiddenError("You don't have permission to do this"));
    }
    next();
  };
}
