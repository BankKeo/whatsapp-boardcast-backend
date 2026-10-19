/**
 * Webhook event dedupe model.
 *
 * A unique `dedupeKey` per inbound event makes webhook processing idempotent:
 * providers retry deliveries, and the same status update must only be applied
 * once (docs/starter-project.md §6). A TTL removes old keys automatically.
 */

import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";
import { baseSchemaOptions } from "../../common/utils/mongo";

const webhookEventSchema = new Schema(
  {
    dedupeKey: { type: String, required: true, unique: true },
    kind: { type: String, required: true },
    providerMessageId: { type: String, default: null, index: true },
    processedAt: { type: Date, default: () => new Date(), expires: "30d" },
  },
  baseSchemaOptions,
);

export type WebhookEvent = InferSchemaType<typeof webhookEventSchema>;
export type WebhookEventDocument = HydratedDocument<WebhookEvent>;

export const WebhookEventModel = model("WebhookEvent", webhookEventSchema);
