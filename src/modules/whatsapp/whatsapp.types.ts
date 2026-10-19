/**
 * WhatsApp Business Platform provider boundary.
 *
 * Campaign controllers never call the provider directly; everything goes through
 * `WhatsAppProvider → CampaignService → RecipientQueue` (docs/starter-project.md
 * §6). A mock provider keeps the system runnable in development and is always
 * labelled as simulated — it must never claim a real-world send.
 */

import type { TemplateStatus } from "../../common/constants/domain";

export interface TemplateDraft {
  name: string;
  category: string;
  language: "en" | "lo";
  body: string;
  variables: { key: string; label: string; example: string }[];
}

export interface TemplateSubmission {
  externalId: string;
}

export interface TemplateStatusResult {
  status: TemplateStatus;
  externalId: string | null;
  reason?: string | null;
  /** True when the value came from the local simulation, not Meta. */
  simulated: boolean;
}

export interface SendTemplateRequest {
  campaignId: string;
  recipientId: string;
  /** E.164 recipient number, already validated and consented. */
  to: string;
  templateName: string;
  language: "en" | "lo";
  /** Ordered values for `{{1}}`…`{{n}}`. */
  parameters: string[];
  /** Optional public image URL for the template's image header. */
  imageUrl?: string | null;
}

export interface SendResult {
  providerMessageId: string;
  /** The provider never reports real delivery from the mock. */
  simulated: boolean;
  acceptedAt: Date;
}

export type WebhookEventKind = "message_status" | "template_status" | "account_update" | "unknown";

export interface WebhookEvent {
  kind: WebhookEventKind;
  /** Dedupe key derived from the provider payload. */
  dedupeKey: string;
  providerMessageId?: string;
  status?: "sent" | "delivered" | "read" | "failed";
  timestamp?: Date;
  failureCode?: string;
  failureReason?: string;
  templateName?: string;
  templateStatus?: TemplateStatus;
  raw?: unknown;
}

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  rawBody?: string;
}

export interface ProviderHealth {
  provider: string;
  connected: boolean;
  simulated: boolean;
  message: string;
}

export interface WhatsAppProvider {
  readonly name: string;
  readonly simulated: boolean;
  sendTemplateMessage(request: SendTemplateRequest): Promise<SendResult>;
  getTemplateStatus(name: string): Promise<TemplateStatusResult>;
  submitTemplate(draft: TemplateDraft): Promise<TemplateSubmission>;
  validateWebhook(request: WebhookRequest): boolean;
  processWebhookEvent(payload: unknown): WebhookEvent[];
  getProviderHealth(): Promise<ProviderHealth>;
}
