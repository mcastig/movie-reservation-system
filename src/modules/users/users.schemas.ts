import { z } from "zod";
import { userRole } from "../../db/schema.ts";

export const setRoleBody = z.strictObject({
  role: z.enum(userRole.enumValues),
});
