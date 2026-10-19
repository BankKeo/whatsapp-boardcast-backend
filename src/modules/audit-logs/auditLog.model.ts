/**
 * Audit log / activity feed model.
 *
 * Feeds the dashboard's recent-activity feed (`types/activity.ts`) and the
 * Settings → Audit log screen. Append-only: entries are never updated or deleted
 * by application code. The `type` values match the dashboard's `ActivityType`.
 */

import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";
import { ACTIVITY_TYPES } from "../../common/constants/domain";
import { baseSchemaOptions } from "../../common/utils/mongo";

const auditLogSchema = new Schema(
  {
    type: { type: String, enum: ACTIVITY_TYPES, required: true, index: true },
    /** Human-readable sentence shown in the feed (dashboard's `message`). */
    message: { type: String, required: true, trim: true, maxlength: 500 },
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    /** Snapshot so the feed still renders if the user is later removed. */
    actorName: { type: String, default: "System" },

    /** What the action affected, e.g. `{ type: "campaign", id: … }`. */
    targetType: { type: String, default: null },
    targetId: { type: Schema.Types.ObjectId, default: null },
    /** Structured before/after or request context; redacted before storage. */
    metadata: { type: Schema.Types.Mixed, default: null },

    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  baseSchemaOptions,
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

export type AuditLog = InferSchemaType<typeof auditLogSchema>;
export type AuditLogDocument = HydratedDocument<AuditLog>;

export const AuditLogModel = model("AuditLog", auditLogSchema);
