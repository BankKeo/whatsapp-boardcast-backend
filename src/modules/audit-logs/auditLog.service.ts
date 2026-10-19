/**
 * Audit log service.
 *
 * `recordAudit` is the single write path every other service calls for
 * administrative actions (docs/starter-project.md §8). It never throws: a
 * logging failure must not fail the user's request, but it is reported to the
 * application logger.
 */

import type { FilterQuery, Types } from "mongoose";
import { logger } from "../../config/logger";
import type { ActivityType } from "../../common/constants/domain";
import { redactObject } from "../../common/utils/redact";
import { AuditLogModel, type AuditLog } from "./auditLog.model";
import type { AuditLogQuery } from "./auditLog.schema";

export interface AuditInput {
  type: ActivityType;
  message: string;
  actorId?: string | Types.ObjectId | null;
  actorName?: string;
  targetType?: string | null;
  targetId?: string | Types.ObjectId | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await AuditLogModel.create({
      type: input.type,
      message: input.message,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? "System",
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      metadata: input.metadata ? redactObject(input.metadata) : null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    });
  } catch (error) {
    logger.error({ err: error, type: input.type }, "Failed to write audit log entry");
  }
}

export async function listAuditLogs(query: AuditLogQuery) {
  const filter: FilterQuery<AuditLog> = {};
  if (query.type !== "all") filter.type = query.type;
  if (query.targetType !== "all") filter.targetType = query.targetType;
  if (query.actorId) filter.actorId = query.actorId;
  if (query.search) filter.message = { $regex: query.search, $options: "i" };
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) (filter.createdAt as Record<string, Date>).$gte = query.from;
    if (query.to) (filter.createdAt as Record<string, Date>).$lte = query.to;
  }

  const skip = (query.page - 1) * query.limit;
  const [items, total] = await Promise.all([
    AuditLogModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit).lean({ virtuals: true }),
    AuditLogModel.countDocuments(filter),
  ]);

  return { items, total };
}
