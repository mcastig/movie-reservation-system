import { z } from "zod";
import { fromBeforeTo, fromBeforeToError, timeRangeFields } from "../../lib/schemas.ts";

export const reportQuery = z.object(timeRangeFields).refine(fromBeforeTo, fromBeforeToError);

export type ReportQuery = z.output<typeof reportQuery>;
