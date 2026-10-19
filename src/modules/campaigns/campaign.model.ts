/**
 * Campaign model.
 *
 * The dashboard reads these fields directly (`types/campaign.ts`): audience
 * filters, recipient count, template/language/message, lifecycle status and the
 * `metrics` rollup. docs/starter-project.md's approval and snapshot fields
 * (`approvedBy`, `approvedAt`, `audienceSnapshot`, `audienceCriteriaSnapshot`)
 * are added on top.
 *
 * A busy campaign never embeds its recipients here — see `campaignRecipient`.
 */

import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";
import {
  CAMPAIGN_LANGUAGES,
  CAMPAIGN_OBJECTIVES,
  CAMPAIGN_STATUSES,
} from "../../common/constants/domain";
import { baseSchemaOptions } from "../../common/utils/mongo";
import { segmentFiltersSchema } from "../segments/segment.model";

/**
 * Immutable snapshot of how many outlets each rule stage matched, taken when the
 * campaign is submitted. Keeps the review screen's numbers auditable even after
 * the underlying outlets change.
 */
const audienceSnapshotSchema = new Schema(
  {
    matched: { type: Number, default: 0, min: 0 },
    eligible: { type: Number, default: 0, min: 0 },
    consented: { type: Number, default: 0, min: 0 },
    deliverable: { type: Number, default: 0, min: 0 },
    unreachable: { type: Number, default: 0, min: 0 },
    withoutConsent: { type: Number, default: 0, min: 0 },
    notVerified: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

/** Delivery rollup — matches the dashboard's `CampaignMetrics` exactly. */
const campaignMetricsSchema = new Schema(
  {
    attempted: { type: Number, default: 0, min: 0 },
    sent: { type: Number, default: 0, min: 0 },
    delivered: { type: Number, default: 0, min: 0 },
    /** Nullable: older campaigns have no read receipts. */
    read: { type: Number, default: null, min: 0 },
    failed: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const campaignSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 3, maxlength: 120 },
    objective: { type: String, enum: CAMPAIGN_OBJECTIVES, required: true },
    description: { type: String, trim: true, maxlength: 500, default: "" },
    owner: { type: String, trim: true, minlength: 2, maxlength: 120 },
    status: { type: String, enum: CAMPAIGN_STATUSES, default: "Draft", index: true },

    /* Audience */
    segmentId: { type: Schema.Types.ObjectId, ref: "Segment", default: null, index: true },
    /** Denormalised for the campaign table when a segment is later renamed/removed. */
    segmentName: { type: String, default: null },
    /** Resolved audience definition used to compute recipients. */
    audience: { type: segmentFiltersSchema, required: true, default: () => ({}) },
    /** Immutable criteria snapshot, frozen at submit/approval. */
    audienceFiltersSnapshot: { type: segmentFiltersSchema, default: null },
    audienceSnapshot: { type: audienceSnapshotSchema, default: null },
    /** Deliverable recipient count (dashboard's `recipients`). */
    recipients: { type: Number, default: 0, min: 0 },
    /** Aliases kept for the API contract in docs/starter-project.md §4.4. */
    recipientCount: { type: Number, default: 0, min: 0 },
    eligibleRecipientCount: { type: Number, default: 0, min: 0 },

    /* Message */
    templateId: { type: Schema.Types.ObjectId, ref: "MessageTemplate", default: null, index: true },
    templateName: { type: String, default: null },
    language: { type: String, enum: CAMPAIGN_LANGUAGES, default: "en" },
    message: { type: String, default: "", maxlength: 1024 },
    /** Values for `{{4}}`/`{{5}}` placeholders, per docs/starter-project.md §6. */
    promotionPeriod: { type: String, default: null },
    campaignReference: { type: String, default: null },

    /* Lifecycle */
    scheduledAt: { type: Date, default: null, index: true },
    sentAt: { type: Date, default: null, index: true },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

    metrics: { type: campaignMetricsSchema, default: null },

    /** Client-supplied key so repeated create/dispatch requests never double-send. */
    idempotencyKey: { type: String, index: { unique: true, sparse: true } },
    /** WhatsApp Business Platform campaign/message reference, once integrated. */
    providerCampaignId: { type: String, default: null },
    lastError: { type: String, default: null },
  },
  baseSchemaOptions,
);

/* See template.model.ts: `language` is a domain field, not a text-index override. */
campaignSchema.index(
  { name: "text", description: "text", owner: "text" },
  { language_override: "textSearchLanguage" },
);
campaignSchema.index({ status: 1, createdAt: -1 });
campaignSchema.index({ status: 1, scheduledAt: 1 }); // scheduler sweep
/*
 * Audience arrays are indexed individually: MongoDB cannot build a compound
 * index across two array fields ("cannot index parallel arrays"). Campaign
 * listing filters on one dimension at a time, which these cover.
 */
campaignSchema.index({ "audience.provinces": 1 });
campaignSchema.index({ "audience.categories": 1 });

export type Campaign = InferSchemaType<typeof campaignSchema>;
export type CampaignDocument = HydratedDocument<Campaign>;

export const CampaignModel = model("Campaign", campaignSchema);
