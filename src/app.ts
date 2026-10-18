import express, { type Express } from "express";
import { errorHandler, notFound } from "./middleware/errorHandler.ts";
import { authRouter } from "./modules/auth/auth.routes.ts";
import { genresRouter } from "./modules/genres/genres.routes.ts";
import { moviesRouter } from "./modules/movies/movies.routes.ts";
import { reservationsRouter } from "./modules/reservations/reservations.routes.ts";
import { showtimesRouter } from "./modules/showtimes/showtimes.routes.ts";
import { meRouter, usersRouter } from "./modules/users/users.routes.ts";

// Builds the Express app without starting a server,
// so tests can import it and send requests directly.
const app: Express = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth", authRouter);
app.use("/me", meRouter);
app.use("/users", usersRouter);
app.use("/genres", genresRouter);
app.use("/movies", moviesRouter);
app.use("/showtimes", showtimesRouter);
app.use("/reservations", reservationsRouter);

// Order matters: these run only if nothing above sent a response.
app.use(notFound);
app.use(errorHandler);

export default app;
