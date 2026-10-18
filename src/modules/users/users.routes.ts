import { Router } from "express";
import { idParams } from "../../lib/schemas.ts";
import { authenticate, requireRole } from "../../middleware/auth.ts";
import { validate } from "../../middleware/validate.ts";
import { setRoleBody } from "./users.schemas.ts";
import * as usersService from "./users.service.ts";

export const meRouter = Router();

// Reads the user from the database, not just the token, so name and role are current.
meRouter.get("/", authenticate, async (req, res) => {
  res.json(await usersService.getUser(req.user!.id));
});

export const usersRouter = Router();

usersRouter.patch(
  "/:id/role",
  authenticate,
  requireRole("admin"),
  validate({ params: idParams, body: setRoleBody }),
  async (req, res) => {
    res.json(await usersService.setRole(req.user!, req.params.id, req.body.role));
  },
);
