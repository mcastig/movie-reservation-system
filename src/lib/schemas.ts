import { z } from "zod";

// Shared Zod pieces reused across modules.

// Route params and query strings always arrive as strings; coerce turns "42" into 42.
export const idSchema = z.coerce.number().int().positive();

export const idParams = z.object({ id: idSchema });

// An IANA timezone name like "America/Mexico_City". Intl throws a RangeError for
// unknown names, which is a cheap way to check without keeping our own list.
export const timeZoneSchema = z.string().refine(
  (name) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: name });
      return true;
    } catch {
      return false;
    }
  },
  { message: "Unknown timezone (use an IANA name like America/Mexico_City)" },
);

// ?from=...&to=... as instants with a timezone. `from` is inclusive, `to` exclusive,
// so consecutive ranges (October, then November) never count anything twice.
const instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

export const timeRangeFields = { from: instant.optional(), to: instant.optional() };

// Use as .refine(fromBeforeTo, fromBeforeToError) on a schema with timeRangeFields.
export const fromBeforeTo = (q: { from?: Date; to?: Date }) => !q.from || !q.to || q.from < q.to;
export const fromBeforeToError = { message: "`from` must be before `to`", path: ["to"] };

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = z.output<typeof paginationQuery>;

export function paginate<T>(data: T[], { page, limit }: Pagination, total: number) {
  return {
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
