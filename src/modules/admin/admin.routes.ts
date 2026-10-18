import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth.ts";
import { validate } from "../../middleware/validate.ts";
import { adminReservationsQuery } from "../reservations/reservations.schemas.ts";
import * as reservationsService from "../reservations/reservations.service.ts";

export const adminRouter = Router();

// Everything under /admin is for admins only.
adminRouter.use(authenticate, requireRole("admin"));

adminRouter.get("/reservations", validate({ query: adminReservationsQuery }), async (req, res) => {
  res.json(await reservationsService.listAllReservations(req.query));
});
