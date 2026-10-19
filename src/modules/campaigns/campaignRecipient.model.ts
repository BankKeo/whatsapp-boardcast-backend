/**
 * Campaign recipient model — one document per (campaign, outlet) send job.
 *
 * docs/starter-project.md §4.5: recipient-level tracking lives in its own
 * collection rather than being embedded in the campaign. The unique compound
 * index on `{ campaignId, outletId }` is the idempotency guard that stops a
 * retried dispatch from messaging the same contact twice.
 */

import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";
import { CAMPAIGN_RECIPIENT_STATUSES } from "../../common/constants/domain";
import { baseSchemaOptions } from "../../common/utils/mongo";

const campaignRecipientSchema = new Schema(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", required: true, index: true },
    outletId: { type: Schema.Types.ObjectId, ref: "Outlet", required: true, index: true },

    /* Snapshots taken at enqueue time so the record is self-contained. */
    outletNameSnapshot: { type: String, default: "" },
    phoneNumberSnapshot: { type: String, required: true },
    templateId: { type: Schema.Types.ObjectId, ref: "MessageTemplate", default: null },
    templateNameSnapshot: { type: String, default: null },
    languageSnapshot: { type: String, enum: ["en", "lo"], default: "en" },
    /** Resolved `{{n}}` values used for this recipient. */
    variables: { type: Schema.Types.Map, of: String, default: {} },

    status: { type: String, enum: CAMPAIGN_RECIPIENT_STATUSES, default: "Queued", index: true },
    /**
     * Sparse-unique: the field is absent until the provider accepts the message,
     * so retried dispatches cannot create a second message id.
     */
    providerMessageId: { type: String },

    attemptCount: { type: Number, default: 0, min: 0 },
    attemptedAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    failureCode: { type: String, default: null },
    failureReason: { type: String, default: null },
    nextAttemptAt: { type: Date, default: null, index: true },
  },
  baseSchemaOptions,
);

/* One job per outlet per campaign — the duplicate-send guard. */
campaignRecipientSchema.index({ campaignId: 1, outletId: 1 }, { unique: true });
campaignRecipientSchema.index({ campaignId: 1, status: 1 });
/* Webhook lookup by provider id (sparse: most rows have none locally). */
campaignRecipientSchema.index(
  { providerMessageId: 1 },
  { unique: true, sparse: true },
);

export type CampaignRecipient = InferSchemaType<typeof campaignRecipientSchema>;
export type CampaignRecipientDocument = HydratedDocument<CampaignRecipient>;

export const CampaignRecipientModel = model("CampaignRecipient", campaignRecipientSchema);
