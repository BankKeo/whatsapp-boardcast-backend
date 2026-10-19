import type { Request, Response } from "express";
import { sendSuccess } from "../../common/http/respond";
import { logger } from "../../config/logger";
import { recordAudit } from "../audit-logs/auditLog.service";
import { getWhatsAppProvider } from "./whatsapp.factory";
import { applyWebhookEvents, getProviderHealth } from "./whatsapp.service";
import { WebhookEventModel } from "./webhookEvent.model";
import { queue } from "../jobs/queue";

function rawBody(req: Request): string | undefined {
  return (req as Request & { rawBody?: string }).rawBody;
}

export function verifyWebhook(req: Request, res: Response): void {
  const provider = getWhatsAppProvider();
  const valid = provider.validateWebhook({
    headers: req.headers,
    query: req.query as Record<string, unknown>,
    rawBody: rawBody(req),
  });

  if (!valid) {
    res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "Webhook verification failed.", details: [] },
    });
    return;
  }

  // Meta expects the challenge echoed back as plain text.
  const challenge = String((req.query as Record<string, unknown>)["hub.challenge"] ?? "");
  res.status(200).type("text/plain").send(challenge);
}

export async function receiveWebhook(req: Request, res: Response): Promise<void> {
  const provider = getWhatsAppProvider();
  const valid = provider.validateWebhook({
    headers: req.headers,
    query: req.query as Record<string, unknown>,
    rawBody: rawBody(req),
  });

  if (!valid) {
    res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "Webhook signature verification failed.", details: [] },
    });
    return;
  }

  const events = provider.processWebhookEvent(req.body);
  let applied = 0;

  if (events.length > 0) {
    // Deduplicate before applying, so repeated provider deliveries are no-ops.
    const fresh = [];
    for (const event of events) {
      try {
        await WebhookEventModel.create({
          dedupeKey: event.dedupeKey,
          kind: event.kind,
          providerMessageId: event.providerMessageId ?? null,
        });
        fresh.push(event);
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
      }
    }
    applied = await applyWebhookEvents(fresh);
  }

  logger.info({ received: events.length, applied, simulated: provider.simulated }, "Webhook processed");

  await recordAudit({
    type: "integration",
    message: `Processed ${events.length} WhatsApp webhook event(s); ${applied} applied.`,
    actorName: "WhatsApp webhook",
    targetType: "integration",
    metadata: { received: events.length, applied, simulated: provider.simulated },
  });

  // Acknowledge quickly; providers retry on non-2xx.
  sendSuccess(res, { received: events.length, applied, simulated: provider.simulated });
}

export async function health(_req: Request, res: Response): Promise<void> {
  const providerHealth = await getProviderHealth();
  sendSuccess(res, { ...providerHealth, queue: queue.stats() });
}
