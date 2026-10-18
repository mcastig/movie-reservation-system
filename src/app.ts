import express, { type Express } from "express";
import { errorHandler, notFound } from "./middleware/errorHandler.ts";
import { genresRouter } from "./modules/genres/genres.routes.ts";

// Builds the Express app without starting a server,
// so tests can import it and send requests directly.
const app: Express = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/genres", genresRouter);

// Order matters: these run only if nothing above sent a response.
app.use(notFound);
app.use(errorHandler);

export default app;
