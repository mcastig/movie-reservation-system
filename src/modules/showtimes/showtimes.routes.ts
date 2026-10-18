import { Router } from "express";
import { idParams } from "../../lib/schemas.ts";
import { authenticate, requireRole } from "../../middleware/auth.ts";
import { validate } from "../../middleware/validate.ts";
import { createShowtimeBody, updateShowtimeBody } from "./showtimes.schemas.ts";
import * as showtimesService from "./showtimes.service.ts";

export const showtimesRouter = Router();

showtimesRouter.get("/:id", validate({ params: idParams }), async (req, res) => {
  res.json(await showtimesService.getShowtime(req.params.id));
});

showtimesRouter.post(
  "/",
  authenticate,
  requireRole("admin"),
  validate({ body: createShowtimeBody }),
  async (req, res) => {
    const showtime = await showtimesService.createShowtime(req.body);
    res.status(201).location(`/showtimes/${showtime.id}`).json(showtime);
  },
);

showtimesRouter.patch(
  "/:id",
  authenticate,
  requireRole("admin"),
  validate({ params: idParams, body: updateShowtimeBody }),
  async (req, res) => {
    res.json(await showtimesService.updateShowtime(req.params.id, req.body));
  },
);

showtimesRouter.delete(
  "/:id",
  authenticate,
  requireRole("admin"),
  validate({ params: idParams }),
  async (req, res) => {
    await showtimesService.deleteShowtime(req.params.id);
    res.status(204).end();
  },
);
