import { Router } from "express";
import { validate } from "../../middleware/validate.ts";
import { createGenreBody } from "./genres.schemas.ts";
import * as genresService from "./genres.service.ts";

export const genresRouter = Router();

genresRouter.get("/", async (_req, res) => {
  res.json(await genresService.listGenres());
});

genresRouter.post("/", validate({ body: createGenreBody }), async (req, res) => {
  res.status(201).json(await genresService.createGenre(req.body));
});
