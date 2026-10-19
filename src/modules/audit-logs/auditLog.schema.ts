/** Zod schemas for audit log queries. */

import { z } from "zod";
import { ACTIVITY_TYPES } from "../../common/constants/domain";
import { nullableDate } from "../../common/validators/date";

export const auditLogQuerySchema = z.object({
  type: z.union([z.enum(ACTIVITY_TYPES), z.literal("all")]).default("all"),
  targetType: z.string().trim().default("all"),
  actorId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  search: z.string().trim().default(""),
  from: nullableDate,
  to: nullableDate,
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
