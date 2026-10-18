import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../config/env.ts";
import * as schema from "./schema.ts";

// A pool keeps a few connections open and lends one to each query,
// instead of paying the cost of a new connection every time.
export const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

export const db = drizzle({ client: pool, schema });
