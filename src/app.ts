import express, { type Express } from "express";

// Builds the Express app without starting a server,
// so tests can import it and send requests directly.
const app: Express = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

export default app;
