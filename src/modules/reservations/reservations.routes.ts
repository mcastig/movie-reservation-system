import { Router } from "express";
import { idParams, paginationQuery } from "../../lib/schemas.ts";
import { authenticate } from "../../middleware/auth.ts";
import { validate } from "../../middleware/validate.ts";
import * as reservationsService from "./reservations.service.ts";

export const reservationsRouter = Router();

// Every reservation route needs a logged-in user, so authenticate once for the router.
reservationsRouter.use(authenticate);

// Before "/:id", or "me" would be read as an id.
reservationsRouter.get("/me", validate({ query: paginationQuery }), async (req, res) => {
  res.json(await reservationsService.listMyReservations(req.user!, req.query));
});

reservationsRouter.get("/:id", validate({ params: idParams }), async (req, res) => {
  res.json(await reservationsService.getReservation(req.user!, req.params.id));
});
