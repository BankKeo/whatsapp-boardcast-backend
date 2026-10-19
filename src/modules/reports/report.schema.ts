/** Zod schemas for report queries (docs/starter-project.md §5.6). */

import { z } from "zod";
import { objectId } from "../../common/validators/objectId";
import { nullableDate } from "../../common/validators/date";

export const reportFiltersSchema = z
  .object({
    from: nullableDate,
    to: nullableDate,
    campaignId: objectId.nullable().default(null),
    province: z.string().trim().nullable().default(null),
    category: z.string().trim().nullable().default(null),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: "The start date must be before the end date.",
    path: ["from"],
  });

export type ReportFilters = z.infer<typeof reportFiltersSchema>;

export const reportFailureQuerySchema = reportFiltersSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type ReportFailureQuery = z.infer<typeof reportFailureQuerySchema>;

export const reportExportQuerySchema = reportFiltersSchema.extend({
  format: z.enum(["csv"]).default("csv"),
});

export type ReportExportQuery = z.infer<typeof reportExportQuerySchema>;
