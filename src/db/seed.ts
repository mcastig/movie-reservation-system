import { env } from "../config/env.ts";
import { pool } from "./client.ts";
import { seedDatabase } from "./fixtures.ts";

// `npm run db:seed`: wipes every table and fills it with sample data. Safe to run
// again and again, which is why it must never touch a production database.
if (env.NODE_ENV === "production") {
  console.error("Refusing to seed a production database.");
  process.exit(1);
}

const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "admin-password";
const result = await seedDatabase({ adminEmail: process.env.SEED_ADMIN_EMAIL, adminPassword });

console.log(
  `Seeded: ${result.genres} genres, ${result.movies} movies, 2 halls, ` +
    `${result.seats} seats, ${result.showtimes} showtimes, 1 reservation.`,
);
console.log(`Admin login: ${result.admin.email} / ${adminPassword}`);

await pool.end();
