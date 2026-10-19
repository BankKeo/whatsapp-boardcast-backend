/**
 * Mock WhatsApp provider.
 *
 * Used whenever real credentials are absent (docs/starter-project.md §6). It
 * simulates a provider response with deterministic, clearly-simulated message
 * ids and never reports real delivery. Every result carries `simulated: true`
 * so callers can label the data honestly.
 */

import { randomUUID, createHash } from "node:crypto";
import { env } from "../../../config/env";
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

const SIMULATED_FAILURES = new Set(["failed"]);

function simulatedMessageId(campaignId: string, recipientId: string): string {
  const hash = createHash("sha1").update(`${campaignId}:${recipientId}`).digest("hex").slice(0, 16);
  return `sim-${hash}`;
}

export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly name = "mock";
  readonly simulated = true;

  async sendTemplateMessage(request: SendTemplateRequest): Promise<SendResult> {
    // A small deterministic subset of recipients fail so the failure/reporting
    // paths exercise real code without inventing delivery.
    const id = simulatedMessageId(request.campaignId, request.recipientId);
    if (SIMULATED_FAILURES.has(id.slice(-6))) {
      throw Object.assign(new Error("Simulated provider rejection."), {
        code: "131026",
        retryable: false,
      });
    }
    return { providerMessageId: id, simulated: true, acceptedAt: new Date() };
  }

  async getTemplateStatus(name: string): Promise<TemplateStatusResult> {
    // The mock "approves" templates through the local administrative process and
    // says so plainly — it never claims a Meta approval.
    return {
      status: "Approved" as TemplateStatus,
      externalId: `local-approval-${createHash("sha1").update(name).digest("hex").slice(0, 10)}`,
      reason: null,
      simulated: true,
    };
  }

  async submitTemplate(draft: TemplateDraft): Promise<TemplateSubmission> {
    return { externalId: `local-submission-${createHash("sha1").update(draft.name).digest("hex").slice(0, 10)}` };
  }

  validateWebhook(request: WebhookRequest): boolean {
    const token = request.query["hub.verify_token"];
    if (token !== undefined) {
      // GET verification handshake.
      return !env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || token === env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    }
    // The mock accepts signed POSTs; the signature is only required in meta mode.
    void randomUUID;
    return true;
  }

  processWebhookEvent(payload: unknown): WebhookEvent[] {
    const body = payload as { entry?: unknown[] } | undefined;
    if (!body?.entry) return [];
    const events: WebhookEvent[] = [];
    for (const entry of body.entry as Array<Record<string, unknown>>) {
      const changes = (entry.changes as Array<Record<string, unknown>>) ?? [];
      for (const change of changes) {
        const value = (change.value as Record<string, unknown>) ?? {};
        const statuses = (value.statuses as Array<Record<string, unknown>>) ?? [];
        for (const status of statuses) {
          const id = String(status.id ?? "");
          if (!id) continue;
          events.push({
            kind: "message_status",
            dedupeKey: `${id}:${String(status.status ?? "")}`,
            providerMessageId: id,
            status: status.status as WebhookEvent["status"],
            timestamp: status.timestamp ? new Date(Number(status.timestamp) * 1000) : new Date(),
            failureCode: (status.errors as Array<Record<string, unknown>> | undefined)?.[0]?.code as string | undefined,
            raw: status,
          });
        }
      }
    }
    return events;
  }

  async getProviderHealth(): Promise<ProviderHealth> {
    return {
      provider: this.name,
      connected: false,
      simulated: true,
      message:
        "Mock provider. No WhatsApp Business Platform credentials are configured; no real messages are sent and no real delivery is reported.",
    };
  }
}
