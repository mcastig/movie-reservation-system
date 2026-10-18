import { Router } from "express";
import { validate } from "../../middleware/validate.ts";
import { loginBody, refreshTokenBody, signupBody } from "./auth.schemas.ts";
import * as authService from "./auth.service.ts";

export const authRouter = Router();

authRouter.post("/signup", validate({ body: signupBody }), async (req, res) => {
  res.status(201).json(await authService.signup(req.body));
});

authRouter.post("/login", validate({ body: loginBody }), async (req, res) => {
  res.json(await authService.login(req.body));
});

authRouter.post("/refresh", validate({ body: refreshTokenBody }), async (req, res) => {
  res.json(await authService.refresh(req.body.refreshToken));
});

authRouter.post("/logout", validate({ body: refreshTokenBody }), async (req, res) => {
  await authService.logout(req.body.refreshToken);
  res.status(204).end();
});
