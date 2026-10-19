/**
 * WhatsApp integration service.
 *
 * Sits between the campaign dispatcher and the provider: renders per-recipient
 * variables, sends a single template message, and applies inbound webhook events
 * to recipient rows (docs/starter-project.md §6). Provider HTTP never leaks into
 * campaign controllers.
 */

import { logger } from "../../config/logger";
import { MessageTemplateModel, type MessageTemplateDocument } from "../templates/template.model";
import { CampaignRecipientModel, type CampaignRecipientDocument } from "../campaigns/campaignRecipient.model";
import { recomputeCampaignMetrics, maybeCompleteCampaign } from "../campaigns/campaign.metrics";
import { getWhatsAppProvider } from "./whatsapp.factory";
import type { ProviderHealth, SendResult, WebhookEvent, WhatsAppProvider } from "./whatsapp.types";
import { env } from "../../config/env";

/** Ordered `{{n}}` values for the provider body component. */
export function resolveParameters(recipient: CampaignRecipientDocument): string[] {
  const variables = recipient.variables ?? new Map<string, string>();
  const entries: { index: number; value: string }[] = [];
  for (const [key, value] of variables.entries()) {
    const match = /\{\{(\d+)\}\}/.exec(key);
    if (match) entries.push({ index: Number(match[1]), value });
  }
  return entries.sort((a, b) => a.index - b.index).map((entry) => entry.value);
}

const RETRYABLE_ATTEMPTS = 3;

function isRetryable(error: unknown): boolean {
  const retryable = (error as { retryable?: unknown }).retryable;
  if (typeof retryable === "boolean") return retryable;
  const code = String((error as { code?: unknown }).code ?? "");
  // Meta rate limits and transient 5xx are retryable; content rejections are not.
  return code === "130429" || code === "131048" || code === "131056" || code === "";
}

/**
 * Send one recipient's message and persist the outcome. Safe to retry: the
 * recipient row is the unit of idempotency, and a provider message id is only
 * written once.
 */
export async function sendToRecipient(
  recipient: CampaignRecipientDocument,
  template: MessageTemplateDocument,
  provider: WhatsAppProvider = getWhatsAppProvider(),
): Promise<void> {
  const campaignId = recipient.campaignId;
  recipient.attemptCount += 1;
  recipient.attemptedAt = new Date();
  recipient.status = "Attempted";

  if (!recipient.phoneNumberSnapshot) {
    recipient.status = "Failed";
    recipient.failedAt = new Date();
    recipient.failureCode = "NO_PHONE";
    recipient.failureReason = "The recipient has no usable phone number.";
    await recipient.save();
    return;
  }

  try {
    const result: SendResult = await provider.sendTemplateMessage({
      campaignId: String(campaignId),
      recipientId: String(recipient._id),
      to: recipient.phoneNumberSnapshot,
      templateName: template.name,
      language: (recipient.languageSnapshot as "en" | "lo") ?? "en",
      parameters: resolveParameters(recipient),
    });

    recipient.providerMessageId = result.providerMessageId;
    recipient.sentAt = new Date();

    if (provider.simulated) {
      // The mock never reports real delivery: mark Sent and let a simulated
      // receipt advance it, so metrics are clearly traceable to the mock.
      recipient.status = "Sent";
    } else {
      recipient.status = "Sent";
    }
    await recipient.save();
  } catch (error) {
    const retryable = isRetryable(error) && recipient.attemptCount < RETRYABLE_ATTEMPTS;
    recipient.status = retryable ? "Queued" : "Failed";
    recipient.nextAttemptAt = retryable ? new Date(Date.now() + 2 ** recipient.attemptCount * 1000) : null;
    recipient.failureCode = String((error as { code?: unknown }).code ?? "PROVIDER_ERROR");
    recipient.failureReason = (error as Error).message;
    if (!retryable) recipient.failedAt = new Date();
    await recipient.save();
    logger.warn(
      { campaignId: String(campaignId), recipientId: String(recipient._id), retryable, err: error },
      "Recipient dispatch failed",
    );
  }
}

/**
 * Apply a simulated delivery receipt for the mock provider so the reporting
 * pipeline runs end to end. Real webhooks call `applyWebhookEvents` instead and
 * no simulated value is ever presented as real delivery.
 */
export async function applySimulatedReceipts(campaignId: string): Promise<void> {
  const provider = getWhatsAppProvider();
  if (!provider.simulated) return;

  const recipients = await CampaignRecipientModel.find({ campaignId, status: "Sent" });
  for (let index = 0; index < recipients.length; index += 1) {
    const recipient = recipients[index];
    recipient.deliveredAt = new Date();
    // ~80% read receipts, left null on the campaign when absent.
    recipient.status = index % 5 === 0 ? "Delivered" : "Read";
    if (recipient.status === "Read") recipient.readAt = new Date();
    await recipient.save();
  }
}

/** Apply verified inbound webhook events to recipient rows, idempotently. */
export async function applyWebhookEvents(events: WebhookEvent[]): Promise<number> {
  let applied = 0;
  const touchedCampaigns = new Set<string>();

  for (const event of events) {
    if (event.kind !== "message_status" || !event.providerMessageId) continue;

    const recipient = await CampaignRecipientModel.findOne({ providerMessageId: event.providerMessageId });
    if (!recipient) continue;

    const at = event.timestamp ?? new Date();
    switch (event.status) {
      case "sent":
        recipient.status = "Sent";
        recipient.sentAt = recipient.sentAt ?? at;
        break;
      case "delivered":
        recipient.status = "Delivered";
        recipient.deliveredAt = at;
        break;
      case "read":
        recipient.status = "Read";
        recipient.readAt = at;
        break;
      case "failed":
        recipient.status = "Failed";
        recipient.failedAt = at;
        recipient.failureCode = event.failureCode ?? "PROVIDER_FAILURE";
        recipient.failureReason = event.failureReason ?? "The provider rejected the message.";
        break;
      default:
        continue;
    }
    await recipient.save();
    touchedCampaigns.add(String(recipient.campaignId));
    applied += 1;
  }

  for (const campaignId of touchedCampaigns) {
    await recomputeCampaignMetrics(campaignId);
    await maybeCompleteCampaign(campaignId);
  }

  return applied;
}

export async function getProviderHealth(): Promise<ProviderHealth> {
  return getWhatsAppProvider().getProviderHealth();
}

export function providerIsSimulated(): boolean {
  return getWhatsAppProvider().simulated;
}

/** True when a campaign may dispatch with the given template. */
export async function isTemplateDispatchable(template: MessageTemplateDocument): Promise<boolean> {
  if (!env.WHATSAPP_REQUIRE_APPROVED_TEMPLATES) return true;
  return template.status === "Approved";
}

export async function findTemplate(templateId: string) {
  return MessageTemplateModel.findById(templateId);
}
