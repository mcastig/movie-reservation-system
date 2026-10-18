import { eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { users } from "../../db/schema.ts";
import { ForbiddenError, NotFoundError } from "../../lib/errors.ts";
import type { AuthUser } from "../auth/tokens.ts";

// The only user columns that ever leave the API. Selecting them explicitly
// (instead of select()) means password_hash can't end up in a response by accident.
export const publicUserColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  createdAt: users.createdAt,
};

export async function getUser(id: number) {
  const [user] = await db.select(publicUserColumns).from(users).where(eq(users.id, id));
  if (!user) throw new NotFoundError(`User ${id} not found`);
  return user;
}

// Rule: admins can't change their own role. That way the last admin can't
// accidentally demote themselves and leave nobody able to manage the system.
export async function setRole(actor: AuthUser, userId: number, role: AuthUser["role"]) {
  if (actor.id === userId) {
    throw new ForbiddenError("You can't change your own role", "CANNOT_CHANGE_OWN_ROLE");
  }
  const [user] = await db
    .update(users)
    .set({ role })
    .where(eq(users.id, userId))
    .returning(publicUserColumns);
  if (!user) throw new NotFoundError(`User ${userId} not found`);
  return user;
}
