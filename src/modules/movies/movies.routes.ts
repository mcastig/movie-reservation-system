import { Router } from "express";
import { idParams } from "../../lib/schemas.ts";
import { authenticate, requireRole } from "../../middleware/auth.ts";
import { validate } from "../../middleware/validate.ts";
import { createMovieBody, listMoviesQuery, updateMovieBody } from "./movies.schemas.ts";
import * as moviesService from "./movies.service.ts";

export const moviesRouter = Router();

// Reading is public; changing the catalog is for admins only.
moviesRouter.get("/", validate({ query: listMoviesQuery }), async (req, res) => {
  res.json(await moviesService.listMovies(req.query));
});

moviesRouter.get("/:id", validate({ params: idParams }), async (req, res) => {
  res.json(await moviesService.getMovie(req.params.id));
});

moviesRouter.post(
  "/",
  authenticate,
  requireRole("admin"),
  validate({ body: createMovieBody }),
  async (req, res) => {
    const movie = await moviesService.createMovie(req.body);
    res.status(201).location(`/movies/${movie.id}`).json(movie);
  },
);

moviesRouter.patch(
  "/:id",
  authenticate,
  requireRole("admin"),
  validate({ params: idParams, body: updateMovieBody }),
  async (req, res) => {
    res.json(await moviesService.updateMovie(req.params.id, req.body));
  },
);

moviesRouter.delete(
  "/:id",
  authenticate,
  requireRole("admin"),
  validate({ params: idParams }),
  async (req, res) => {
    await moviesService.deleteMovie(req.params.id);
    res.status(204).end();
  },
);
