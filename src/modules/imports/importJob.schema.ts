/** Zod schemas for CSV import requests. */

import { z } from "zod";
import { OUTLET_CHANNELS } from "../../common/constants/domain";
import { objectId } from "../../common/validators/objectId";

/** Maximum CSV payload accepted, to bound memory use (docs/starter-project.md §8). */
export const MAX_CSV_BYTES = 8 * 1024 * 1024;

export const importPreviewSchema = z.object({
  fileName: z.string().trim().min(1, "The file needs a name.").max(300),
  content: z.string().min(1, "The file is empty.").max(MAX_CSV_BYTES),
  channel: z.enum(OUTLET_CHANNELS).default("CSV import"),
});

export type ImportPreviewValues = z.infer<typeof importPreviewSchema>;

export const importCommitSchema = importPreviewSchema.extend({
  jobId: objectId.optional(),
  /** `skip` (default) leaves existing numbers untouched; `import` keeps both. */
  duplicatePolicy: z.enum(["skip", "import"]).default("skip"),
});

export type ImportCommitValues = z.infer<typeof importCommitSchema>;

export const importJobListQuerySchema = z.object({
  status: z.string().trim().default("all"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
