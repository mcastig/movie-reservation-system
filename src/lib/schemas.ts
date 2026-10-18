import { z } from "zod";

// Shared Zod pieces reused across modules.

// Route params and query strings always arrive as strings; coerce turns "42" into 42.
export const idSchema = z.coerce.number().int().positive();

export const idParams = z.object({ id: idSchema });

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
