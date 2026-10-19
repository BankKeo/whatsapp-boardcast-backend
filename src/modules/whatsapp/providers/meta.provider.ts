/**
 * Official WhatsApp Business Platform (Meta Graph API) provider.
 *
 * Only constructed when real credentials are configured. All secrets stay
 * server-side (docs/starter-project.md §6, §8). Errors are classified as
 * retryable or permanent so the dispatcher can retry with backoff without
 * retrying indefinitely.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../../config/env";
import { logger } from "../../../config/logger";
import { ProviderNotConfiguredError } from "../../../common/errors/AppError";
import type { TemplateStatus } from "../../../common/constants/domain";
import type {
  ProviderHealth,
  SendResult,
  SendTemplateRequest,
  TemplateDraft,
  TemplateStatusResult,
  TemplateSubmission,
  WebhookEvent,
  WebhookRequest,
  WhatsAppProvider,
} from "../whatsapp.types";

const META_STATUS_MAP: Record<string, TemplateStatus> = {
  APPROVED: "Approved",
  PENDING: "Pending Approval",
  REJECTED: "Rejected",
  PAUSED: "Draft",
  DISABLED: "Rejected",
  IN_APPEAL: "Pending Approval",
  PENDING_DELETION: "Rejected",
};

export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly name = "meta";
  readonly simulated = false;

  private readonly baseUrl = `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}`;

  private requireCredentials(): { token: string; phoneNumberId: string } {
    if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
      throw new ProviderNotConfiguredError();
    }
    return { token: env.WHATSAPP_ACCESS_TOKEN, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID };
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const { token } = this.requireCredentials();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        const error = (body.error as Record<string, unknown>) ?? {};
        const status = response.status;
        const retryable = status === 429 || status >= 500;
        throw Object.assign(new Error(String(error.message ?? `Graph API error ${status}`)), {
          code: error.code,
          retryable,
        });
      }
      return body as T;
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") {
        throw Object.assign(new Error("The WhatsApp provider timed out."), { retryable: true });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async sendTemplateMessage(request: SendTemplateRequest): Promise<SendResult> {
    const { phoneNumberId } = this.requireCredentials();

    // A template with an image header needs a header component carrying the
    // public media URL; the body component carries the ordered variables.
    const components: Record<string, unknown>[] = [];
    if (request.imageUrl) {
      components.push({
        type: "header",
        parameters: [{ type: "image", image: { link: request.imageUrl } }],
      });
    }
    if (request.parameters.length > 0) {
      components.push({
        type: "body",
        parameters: request.parameters.map((text) => ({ type: "text", text })),
      });
    }

    const body = {
      messaging_product: "whatsapp",
      to: request.to,
      type: "template",
      template: {
        name: request.templateName,
        language: { code: request.language },
        components: components.length > 0 ? components : undefined,
      },
    };

    const result = await this.request<{ messages: { id: string }[] }>(`/${phoneNumberId}/messages`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const id = result.messages?.[0]?.id;
    if (!id) throw Object.assign(new Error("The provider did not return a message id."), { retryable: true });
    return { providerMessageId: id, simulated: false, acceptedAt: new Date() };
  }

  async getTemplateStatus(name: string): Promise<TemplateStatusResult> {
    if (!env.WHATSAPP_BUSINESS_ACCOUNT_ID) throw new ProviderNotConfiguredError();
    const result = await this.request<{ data: { id: string; status: string }[] }>(
      `/${env.WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates?name=${encodeURIComponent(name)}`,
      { method: "GET" },
    );
    const template = result.data?.[0];
    if (!template) return { status: "Pending Approval", externalId: null, simulated: false };
    return {
      status: META_STATUS_MAP[template.status] ?? "Pending Approval",
      externalId: template.id,
      simulated: false,
    };
  }

  async submitTemplate(draft: TemplateDraft): Promise<TemplateSubmission> {
    if (!env.WHATSAPP_BUSINESS_ACCOUNT_ID) throw new ProviderNotConfiguredError();
    const body = {
      name: draft.name.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
      language: draft.language,
      category: "MARKETING",
      components: [
        {
          type: "BODY",
          text: draft.body,
          example: draft.variables.length
            ? { body_text: [draft.variables.map((variable) => variable.example)] }
            : undefined,
        },
      ],
    };
    const result = await this.request<{ id: string }>(`/${env.WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { externalId: result.id };
  }

  validateWebhook(request: WebhookRequest): boolean {
    if (!env.WHATSAPP_APP_SECRET || !request.rawBody) return false;
    const header = request.headers["x-hub-signature-256"];
    const signature = Array.isArray(header) ? header[0] : header;
    if (!signature?.startsWith("sha256=")) return false;

    const expected = createHmac("sha256", env.WHATSAPP_APP_SECRET).update(request.rawBody, "utf8").digest("hex");
    const provided = signature.slice("sha256=".length);
    const expectedBuffer = Buffer.from(expected, "hex");
    const providedBuffer = Buffer.from(provided, "hex");
    if (expectedBuffer.length !== providedBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, providedBuffer);
  }

  processWebhookEvent(payload: unknown): WebhookEvent[] {
    const body = payload as { entry?: Array<Record<string, unknown>> } | undefined;
    if (!body?.entry) return [];
    const events: WebhookEvent[] = [];

    for (const entry of body.entry) {
      for (const change of (entry.changes as Array<Record<string, unknown>>) ?? []) {
        const field = String(change.field ?? "");
        const value = (change.value as Record<string, unknown>) ?? {};

        if (field === "messages") {
          for (const status of (value.statuses as Array<Record<string, unknown>>) ?? []) {
            const id = String(status.id ?? "");
            if (!id) continue;
            const errors = (status.errors as Array<Record<string, unknown>>) ?? [];
            events.push({
              kind: "message_status",
              dedupeKey: `${id}:${String(status.status ?? "")}`,
              providerMessageId: id,
              status: status.status as WebhookEvent["status"],
              timestamp: status.timestamp ? new Date(Number(status.timestamp) * 1000) : new Date(),
              failureCode: errors[0]?.code !== undefined ? String(errors[0]?.code) : undefined,
              failureReason: errors[0]?.title !== undefined ? String(errors[0]?.title) : undefined,
              raw: status,
            });
          }
        } else if (field === "message_template_status_update") {
          events.push({
            kind: "template_status",
            dedupeKey: `template:${String(value.message_template_name ?? "")}:${String(value.event ?? "")}`,
            templateName: value.message_template_name ? String(value.message_template_name) : undefined,
            templateStatus: META_STATUS_MAP[String(value.event ?? "")] ?? undefined,
            timestamp: new Date(),
            raw: value,
          });
        } else if (field === "account_update") {
          events.push({
            kind: "account_update",
            dedupeKey: `account:${String(value.phone_number ?? "")}:${Date.now()}`,
            timestamp: new Date(),
            raw: value,
          });
        }
      }
    }

    // Deduplicate within a single delivery.
    const seen = new Set<string>();
    return events.filter((event) => {
      if (seen.has(event.dedupeKey)) return false;
      seen.add(event.dedupeKey);
      return true;
    });
  }

  async getProviderHealth(): Promise<ProviderHealth> {
    try {
      const { phoneNumberId } = this.requireCredentials();
      await this.request(`/${phoneNumberId}?fields=display_phone_number,verified_name`, { method: "GET" });
      return { provider: this.name, connected: true, simulated: false, message: "Connected to the WhatsApp Business Platform." };
    } catch (error) {
      logger.warn({ err: error }, "WhatsApp provider health check failed");
      return {
        provider: this.name,
        connected: false,
        simulated: false,
        message: "The WhatsApp Business Platform is not reachable with the configured credentials.",
      };
    }
  }
}
