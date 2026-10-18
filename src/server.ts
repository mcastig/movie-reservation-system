import { env } from "./config/env.ts";
import app from "./app.ts";
import { logger } from "./lib/logger.ts";

const server = app.listen(env.PORT, () => {
  logger.info(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV}), docs at /docs`);
});

// Let in-flight requests finish when Docker or Ctrl+C stops the process.
function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
