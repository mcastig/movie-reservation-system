import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth.ts";
import { validate } from "../../middleware/validate.ts";
import { adminReservationsQuery } from "../reservations/reservations.schemas.ts";
import * as reservationsService from "../reservations/reservations.service.ts";
import { reportQuery } from "./admin.schemas.ts";
import * as reportsService from "./reports.service.ts";

export const adminRouter = Router();

// Everything under /admin is for admins only.
adminRouter.use(authenticate, requireRole("admin"));

adminRouter.get("/reservations", validate({ query: adminReservationsQuery }), async (req, res) => {
  res.json(await reservationsService.listAllReservations(req.query));
});

adminRouter.get("/reports/showtimes", validate({ query: reportQuery }), async (req, res) => {
  res.json(await reportsService.showtimesReport(req.query));
});

adminRouter.get("/reports/movies", validate({ query: reportQuery }), async (req, res) => {
  res.json(await reportsService.moviesReport(req.query));
});
