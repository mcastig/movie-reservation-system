import { z } from "zod";

// strictObject rejects unknown keys, so a typo like { nmae: "..." } is a 400, not silently ignored.
export const createGenreBody = z.strictObject({
  name: z.string().trim().min(1).max(50),
});

export type CreateGenreInput = z.output<typeof createGenreBody>;
