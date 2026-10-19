/**
 * Zod schemas for audience segments.
 * Mirrors `whatsapp-boardcast-dashboard/lib/schemas/segment.ts`.
 */

import { z } from "zod";
import { outletFiltersSchema } from "../outlets/outlet.schema";

export const segmentFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "Segment name must be at least 3 characters.")
    .max(80, "Segment name must be 80 characters or fewer."),
  description: z
    .string()
    .trim()
    .max(300, "Description must be 300 characters or fewer.")
    .default(""),
  filters: outletFiltersSchema,
});

export type SegmentFormValues = z.infer<typeof segmentFormSchema>;

export const segmentUpdateSchema = segmentFormSchema.partial();

export const segmentPreviewSchema = z.object({
  filters: outletFiltersSchema,
  limit: z.coerce.number().int().min(1).max(50).default(8),
});

export const segmentListQuerySchema = z.object({
  search: z.string().trim().default(""),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const segmentRecipientsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
