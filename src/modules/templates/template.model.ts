/**
 * WhatsApp message template model.
 *
 * Matches the dashboard's `types/template.ts` shape (body, positional
 * `variables`, `status`, `externalApprovalId`, `usageCount`). It keeps the
 * distinction docs/starter-project.md §4.6 and the WhatsApp boundary doc call
 * for: a locally drafted body vs a provider-approved template. `approvalStatus`
 * is derived from `status`, and `providerTemplateId` is only ever written by the
 * provider integration — never by the client.
 */

import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";
import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_LANGUAGES,
  TEMPLATE_STATUSES,
} from "../../common/constants/domain";
import { baseSchemaOptions } from "../../common/utils/mongo";

const templateVariableSchema = new Schema(
  {
    key: { type: String, required: true, trim: true }, // "{{1}}"
    label: { type: String, required: true, trim: true },
    example: { type: String, default: "—" },
  },
  { _id: false },
);

const templateSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 3, maxlength: 80 },
    category: { type: String, enum: TEMPLATE_CATEGORIES, required: true, index: true },
    language: { type: String, enum: TEMPLATE_LANGUAGES, default: "en", index: true },

    /** Template body using WhatsApp `{{1}}` positional syntax. */
    body: { type: String, required: true, trim: true, minlength: 20, maxlength: 1024 },
    variables: { type: [templateVariableSchema], default: [] },
    notes: { type: String, trim: true, maxlength: 300, default: "" },

    /** Local lifecycle state shown in the library. */
    status: { type: String, enum: TEMPLATE_STATUSES, default: "Draft", index: true },
    /** Approval status as reported by the provider (read-only locally). */
    approvalStatus: { type: String, enum: TEMPLATE_STATUSES, default: "Draft" },
    /** Set only when the provider confirms approval; never trusted from clients. */
    providerTemplateId: { type: String },
    /** e.g. `local-approval-…`, so the UI never claims Meta approval. */
    externalApprovalId: { type: String, default: null },
    rejectionReason: { type: String, default: null },
    lastSyncedAt: { type: Date, default: null },

    usageCount: { type: Number, default: 0, min: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  baseSchemaOptions,
);

templateSchema.index({ name: "text", body: "text" });
templateSchema.index({ status: 1, language: 1 });
templateSchema.index({ providerTemplateId: 1 }, { unique: true, sparse: true });

export type MessageTemplate = InferSchemaType<typeof templateSchema>;
export type MessageTemplateDocument = HydratedDocument<MessageTemplate>;

export const MessageTemplateModel = model("MessageTemplate", templateSchema);
