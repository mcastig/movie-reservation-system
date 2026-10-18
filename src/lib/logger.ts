import pino from "pino";
import { env } from "../config/env.ts";

// One structured logger for the whole app. In production each log line is one JSON
// object ({"level":30,"time":...,"reqId":"...","msg":"..."}) that log tools can
// search and filter. In development pino-pretty prints one readable colored line,
// hiding the req/res objects (the message already says "GET /movies 200 (3 ms)").
export const logger = pino({
  level: env.LOG_LEVEL,
  // Never write credentials to the logs, even by accident.
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.refreshToken"],
    censor: "[redacted]",
  },
  ...(env.NODE_ENV === "development" && {
    transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname,req,res,responseTime" } },
  }),
});
