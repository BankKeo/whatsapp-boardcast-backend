/**
 * Campaign service.
 *
 * Owns the campaign lifecycle, approval rules, audience resolution, recipient
 * preparation and dispatch orchestration (docs/starter-project.md §5.4). Every
 * transition is validated against an explicit state machine, and dispatch always
 * re-resolves consent and eligibility on the server — the stored snapshot is for
 * audit, never for real sends.
 */

import type { FilterQuery, Types } from "mongoose";
import { escapeRegex } from "../../common/utils/escape";
import { formatLaoPhone } from "../../common/utils/phone";
import { computeCampaignMetrics, recomputeCampaignMetrics, maybeCompleteCampaign } from "./campaign.metrics";
import { ConflictError, NotFoundError, ValidationError } from "../../common/errors/AppError";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import {
  CampaignModel,
  type CampaignDocument,
} from "./campaign.model";
import {
  CampaignRecipientModel,
  type CampaignRecipientDocument,
} from "./campaignRecipient.model";
import { MessageTemplateModel, type MessageTemplateDocument } from "../templates/template.model";
import { OutletModel, type OutletDocument } from "../outlets/outlet.model";
import {
  audienceBreakdown,
  buildOutletFilter,
  deliverableFilter,
  type OutletFilterInput,
} from "../outlets/outlet.service";
import { getWhatsAppProvider } from "../whatsapp/whatsapp.factory";
import { sendToRecipient, applySimulatedReceipts, isTemplateDispatchable } from "../whatsapp/whatsapp.service";
import type { CampaignStatus } from "../../common/constants/domain";
import type {
  campaignCreateSchema,
  campaignListQuerySchema,
  campaignRecipientQuerySchema,
} from "./campaign.schema";
import type { z } from "zod";
import type { AuditInput } from "../audit-logs/auditLog.service";
import { enqueueCampaignDispatch } from "../jobs/queue";

export type AuditRecorder = (input: AuditInput) => Promise<void>;

export type CampaignCreateValues = z.infer<typeof campaignCreateSchema>;
export type CampaignListQuery = z.infer<typeof campaignListQuerySchema>;
export type CampaignRecipientQuery = z.infer<typeof campaignRecipientQuerySchema>;

/* ------------------------------------------------------------------ */
/* State machine                                                      */
/* ------------------------------------------------------------------ */

export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  Draft: ["Pending Approval", "Scheduled", "Cancelled"],
  "Pending Approval": ["Scheduled", "Draft", "Cancelled"],
  Scheduled: ["Sending", "Cancelled", "Scheduled"],
  Sending: ["Completed", "Failed"],
  Completed: [],
  Cancelled: [],
  Failed: [],
};

export function assertTransition(from: CampaignStatus, to: CampaignStatus): void {
  if (!CAMPAIGN_TRANSITIONS[from]?.includes(to)) {
    throw new ConflictError(`A campaign in status “${from}” cannot move to “${to}”.`);
  }
}

export function isEditable(status: CampaignStatus): boolean {
  return status === "Draft" || status === "Pending Approval";
}

/* ------------------------------------------------------------------ */
/* View                                                               */
/* ------------------------------------------------------------------ */

export function toCampaignView(doc: CampaignDocument, extra: Record<string, unknown> = {}) {
  const json = doc.toJSON() as Record<string, unknown>;
  return {
    id: String(doc._id),
    name: doc.name,
    objective: doc.objective,
    description: doc.description,
    owner: doc.owner,
    status: doc.status,
    segmentId: doc.segmentId ? String(doc.segmentId) : null,
    segmentName: doc.segmentName ?? null,
    audience: doc.audience,
    audienceFiltersSnapshot: doc.audienceFiltersSnapshot ?? null,
    recipients: doc.recipients ?? 0,
    recipientCount: doc.recipientCount ?? 0,
    eligibleRecipientCount: doc.eligibleRecipientCount ?? 0,
    audienceSnapshot: doc.audienceSnapshot ?? null,
    templateId: doc.templateId ? String(doc.templateId) : null,
    templateName: doc.templateName ?? null,
    language: doc.language,
    message: doc.message,
    promotionPeriod: doc.promotionPeriod ?? null,
    campaignReference: doc.campaignReference ?? null,
    createdAt: json.createdAt,
    updatedAt: json.updatedAt,
    createdBy: String(doc.createdBy),
    approvedBy: doc.approvedBy ? String(doc.approvedBy) : null,
    approvedAt: doc.approvedAt ?? null,
    scheduledAt: doc.scheduledAt ?? null,
    startedAt: doc.startedAt ?? null,
    completedAt: doc.completedAt ?? null,
    cancelledAt: doc.cancelledAt ?? null,
    sentAt: doc.sentAt ?? null,
    metrics: doc.metrics ?? null,
    providerCampaignId: doc.providerCampaignId ?? null,
    lastError: doc.lastError ?? null,
    simulated: getWhatsAppProvider().simulated,
    ...extra,
  };
}

/* ------------------------------------------------------------------ */
/* Reads                                                              */
/* ------------------------------------------------------------------ */

export async function listCampaigns(query: CampaignListQuery) {
  const and: FilterQuery<CampaignDocument>[] = [];
  if (query.status !== "all") and.push({ status: query.status });
  if (query.owner !== "all") and.push({ owner: query.owner });
  if (query.province !== "all") and.push({ "audience.provinces": query.province });
  if (query.category !== "all") and.push({ "audience.categories": query.category });
  if (query.search) {
    const regex = new RegExp(escapeRegex(query.search), "i");
    and.push({ $or: [{ name: regex }, { owner: regex }, { segmentName: regex }, { description: regex }] });
  }
  if (query.from || query.to) {
    const range: Record<string, Date> = {};
    if (query.from) range.$gte = new Date(`${query.from}T00:00:00.000Z`);
    if (query.to) range.$lte = new Date(`${query.to}T23:59:59.999Z`);
    and.push({ createdAt: range });
  }

  const filter: FilterQuery<CampaignDocument> = and.length > 0 ? { $and: and } : {};
  const skip = (query.page - 1) * query.limit;
  const [docs, total] = await Promise.all([
    CampaignModel.find(filter)
      .sort({ [query.sort]: query.direction === "asc" ? 1 : -1, _id: -1 })
      .skip(skip)
      .limit(query.limit),
    CampaignModel.countDocuments(filter),
  ]);

  return { items: docs.map((doc) => toCampaignView(doc)), total };
}

export async function getCampaign(id: string): Promise<CampaignDocument> {
  const doc = await CampaignModel.findById(id);
  if (!doc) throw new NotFoundError("Campaign not found.");
  return doc;
}

/* ------------------------------------------------------------------ */
/* Create / update                                                    */
/* ------------------------------------------------------------------ */

function campaignReference(): string {
  const year = new Date().getFullYear();
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `PC-${year}-${suffix}`;
}

export async function createCampaign(
  values: CampaignCreateValues,
  actorId: string,
  recordAudit: AuditRecorder,
): Promise<{ campaign: CampaignDocument; created: boolean }> {
  if (values.idempotencyKey) {
    const existing = await CampaignModel.findOne({ idempotencyKey: values.idempotencyKey });
    if (existing) return { campaign: existing, created: false };
  }

  const template = await MessageTemplateModel.findById(values.message.templateId);
  if (!template) throw new NotFoundError("Message template not found.");

  const breakdown = await audienceBreakdown(values.audience.filters);

  try {
    const campaign = await CampaignModel.create({
      name: values.details.name,
      objective: values.details.objective,
      description: values.details.description,
      owner: values.details.owner,
      status: "Draft",
      segmentId: values.audience.segmentId,
      segmentName: values.audience.segmentName,
      audience: values.audience.filters,
      recipients: breakdown.deliverable,
      recipientCount: breakdown.matched,
      eligibleRecipientCount: breakdown.deliverable,
      templateId: template._id,
      templateName: template.name,
      language: values.message.language,
      message: values.message.message,
      promotionPeriod: values.message.promotionPeriod ?? null,
      campaignReference: campaignReference(),
      scheduledAt: values.scheduledAt,
      createdBy: actorId,
      idempotencyKey: values.idempotencyKey ?? undefined,
    });

    await recordAudit({
      type: "campaign",
      message: `Created campaign ${campaign.name}.`,
      actorId,
      targetType: "campaign",
      targetId: campaign._id,
      metadata: { recipients: breakdown.deliverable, deliverable: breakdown.deliverable },
    });

    return { campaign, created: true };
  } catch (error) {
    // A concurrent create with the same idempotency key — return the winner.
    if ((error as { code?: number }).code === 11000 && values.idempotencyKey) {
      const existing = await CampaignModel.findOne({ idempotencyKey: values.idempotencyKey });
      if (existing) return { campaign: existing, created: false };
    }
    throw error;
  }
}

export async function updateCampaign(
  id: string,
  patch: {
    details?: Partial<CampaignCreateValues["details"]>;
    audience?: CampaignCreateValues["audience"];
    message?: Partial<CampaignCreateValues["message"]>;
    scheduledAt?: Date | null;
  },
  actorId: string,
  recordAudit: AuditRecorder,
): Promise<CampaignDocument> {
  const campaign = await getCampaign(id);
  if (!isEditable(campaign.status)) {
    throw new ConflictError(`A ${campaign.status} campaign can no longer be edited.`);
  }

  if (patch.details) {
    if (patch.details.name !== undefined) campaign.name = patch.details.name;
    if (patch.details.objective !== undefined) campaign.objective = patch.details.objective;
    if (patch.details.description !== undefined) campaign.description = patch.details.description;
    if (patch.details.owner !== undefined) campaign.owner = patch.details.owner;
  }

  if (patch.audience) {
    campaign.segmentId = patch.audience.segmentId as unknown as Types.ObjectId;
    campaign.segmentName = patch.audience.segmentName;
    campaign.audience = patch.audience.filters as never;
    const breakdown = await audienceBreakdown(patch.audience.filters);
    campaign.recipients = breakdown.deliverable;
    campaign.recipientCount = breakdown.matched;
    campaign.eligibleRecipientCount = breakdown.deliverable;
  }

  if (patch.message) {
    if (patch.message.templateId) {
      const template = await MessageTemplateModel.findById(patch.message.templateId);
      if (!template) throw new NotFoundError("Message template not found.");
      campaign.templateId = template._id;
      campaign.templateName = template.name;
    }
    if (patch.message.language !== undefined) campaign.language = patch.message.language;
    if (patch.message.message !== undefined) campaign.message = patch.message.message;
    if (patch.message.promotionPeriod !== undefined) campaign.promotionPeriod = patch.message.promotionPeriod;
  }

  if (patch.scheduledAt !== undefined) campaign.scheduledAt = patch.scheduledAt;

  // Editing an already-submitted campaign returns it to Draft for re-review.
  if (campaign.status === "Pending Approval") campaign.status = "Draft";

  await campaign.save();

  await recordAudit({
    type: "campaign",
    message: `Updated campaign ${campaign.name}.`,
    actorId,
    targetType: "campaign",
    targetId: campaign._id,
    metadata: { fields: Object.keys(patch) },
  });

  return campaign;
}

/* ------------------------------------------------------------------ */
/* Preview / validation                                               */
/* ------------------------------------------------------------------ */

export interface CampaignPreview {
  campaignId: string;
  breakdown: Awaited<ReturnType<typeof audienceBreakdown>>;
  blocking: string[];
  warnings: string[];
  template: { id: string | null; name: string | null; status: string | null };
  simulated: boolean;
}

export async function previewCampaign(id: string): Promise<CampaignPreview> {
  const campaign = await getCampaign(id);
  const breakdown = await audienceBreakdown(campaign.audience as unknown as OutletFilterInput);

  const template = campaign.templateId ? await MessageTemplateModel.findById(campaign.templateId) : null;
  const blocking: string[] = [];
  const warnings: string[] = [];

  if (breakdown.deliverable === 0) {
    blocking.push("No deliverable recipients match this audience. Widen the audience or consent more contacts.");
  }
  if (!template) {
    blocking.push("This campaign has no message template.");
  } else if (env.WHATSAPP_REQUIRE_APPROVED_TEMPLATES && template.status !== "Approved") {
    blocking.push(`The template “${template.name}” is ${template.status} and cannot be dispatched until approved.`);
  }
  if (breakdown.unreachable > 0) {
    warnings.push(`${breakdown.unreachable} matched contacts have a missing or invalid phone number.`);
  }
  if (breakdown.withoutConsent > 0) {
    warnings.push(`${breakdown.withoutConsent} eligible contacts have no marketing consent and will be excluded.`);
  }
  if (breakdown.notVerified > 0) {
    warnings.push(`${breakdown.notVerified} contacts are not verified on WhatsApp and will be excluded.`);
  }

  return {
    campaignId: String(campaign._id),
    breakdown,
    blocking,
    warnings,
    template: {
      id: template ? String(template._id) : null,
      name: template?.name ?? null,
      status: template?.status ?? null,
    },
    simulated: getWhatsAppProvider().simulated,
  };
}

/* ------------------------------------------------------------------ */
/* Transitions                                                        */
/* ------------------------------------------------------------------ */

function actorObjectId(actorId: string): Types.ObjectId {
  return actorId as unknown as Types.ObjectId;
}

export async function submitCampaign(id: string, actorId: string, recordAudit: AuditRecorder): Promise<CampaignDocument> {
  const campaign = await getCampaign(id);
  assertTransition(campaign.status as CampaignStatus, "Pending Approval");

  const breakdown = await audienceBreakdown(campaign.audience as unknown as OutletFilterInput);
  campaign.audienceFiltersSnapshot = campaign.audience as never;
  campaign.audienceSnapshot = breakdown as never;
  campaign.recipients = breakdown.deliverable;
  campaign.eligibleRecipientCount = breakdown.deliverable;
  campaign.recipientCount = breakdown.matched;
  campaign.status = "Pending Approval";
  await campaign.save();

  await recordAudit({
    type: "campaign",
    message: `Submitted campaign ${campaign.name} for approval.`,
    actorId,
    targetType: "campaign",
    targetId: campaign._id,
    metadata: { deliverable: breakdown.deliverable },
  });

  return campaign;
}

export async function approveCampaign(id: string, actorId: string, recordAudit: AuditRecorder): Promise<CampaignDocument> {
  const campaign = await getCampaign(id);
  assertTransition(campaign.status as CampaignStatus, "Scheduled");

  campaign.approvedBy = actorObjectId(actorId);
  campaign.approvedAt = new Date();
  campaign.status = "Scheduled";
  await campaign.save();

  await recordAudit({
    type: "campaign",
    message: `Approved campaign ${campaign.name}.`,
    actorId,
    targetType: "campaign",
    targetId: campaign._id,
  });

  return campaign;
}

export async function scheduleCampaign(
  id: string,
  scheduledAt: Date | null,
  actorId: string,
  recordAudit: AuditRecorder,
): Promise<CampaignDocument> {
  const campaign = await getCampaign(id);
  assertTransition(campaign.status as CampaignStatus, "Scheduled");

  // Scheduling a draft also counts as approval for the approver roles, and freezes
  // the audience criteria the campaign will be dispatched against.
  if (campaign.status === "Draft" || campaign.status === "Pending Approval") {
    const breakdown = await audienceBreakdown(campaign.audience as unknown as OutletFilterInput);
    campaign.audienceFiltersSnapshot = campaign.audience as never;
    campaign.audienceSnapshot = breakdown as never;
    campaign.approvedBy = actorObjectId(actorId);
    campaign.approvedAt = new Date();
  }

  campaign.scheduledAt = scheduledAt;
  campaign.status = "Scheduled";
  await campaign.save();

  await recordAudit({
    type: "campaign",
    message: scheduledAt
      ? `Scheduled campaign ${campaign.name} for ${scheduledAt.toISOString()}.`
      : `Marked campaign ${campaign.name} ready to send.`,
    actorId,
    targetType: "campaign",
    targetId: campaign._id,
    metadata: { scheduledAt: scheduledAt?.toISOString() ?? null },
  });

  return campaign;
}

export async function cancelCampaign(
  id: string,
  reason: string | undefined,
  actorId: string,
  recordAudit: AuditRecorder,
): Promise<CampaignDocument> {
  const campaign = await getCampaign(id);
  assertTransition(campaign.status as CampaignStatus, "Cancelled");

  campaign.status = "Cancelled";
  campaign.cancelledAt = new Date();
  campaign.cancelledBy = actorObjectId(actorId);
  if (reason) campaign.lastError = reason;
  await campaign.save();

  await recordAudit({
    type: "campaign",
    message: `Cancelled campaign ${campaign.name}.`,
    actorId,
    targetType: "campaign",
    targetId: campaign._id,
    metadata: { reason: reason ?? null },
  });

  return campaign;
}

export async function duplicateCampaign(id: string, actorId: string, recordAudit: AuditRecorder): Promise<CampaignDocument> {
  const original = await getCampaign(id);
  const copy = await CampaignModel.create({
    name: `${original.name} (copy)`,
    objective: original.objective,
    description: original.description,
    owner: original.owner,
    status: "Draft",
    segmentId: original.segmentId,
    segmentName: original.segmentName,
    audience: original.audience,
    recipients: original.recipients,
    recipientCount: original.recipientCount,
    eligibleRecipientCount: original.eligibleRecipientCount,
    templateId: original.templateId,
    templateName: original.templateName,
    language: original.language,
    message: original.message,
    promotionPeriod: original.promotionPeriod,
    campaignReference: campaignReference(),
    createdBy: actorId,
  });

  await recordAudit({
    type: "campaign",
    message: `Duplicated campaign ${original.name}.`,
    actorId,
    targetType: "campaign",
    targetId: copy._id,
    metadata: { sourceId: String(original._id) },
  });

  return copy;
}

/* ------------------------------------------------------------------ */
/* Recipient preparation and dispatch                                 */
/* ------------------------------------------------------------------ */

function buildVariables(outlet: OutletDocument, campaign: CampaignDocument): Record<string, string> {
  return {
    "{{1}}": outlet.name,
    "{{2}}": outlet.ownerName,
    "{{3}}": outlet.province,
    "{{4}}": campaign.promotionPeriod ?? "[promotion period]",
    "{{5}}": campaign.campaignReference ?? "PC-DEMO-0001",
    "{{6}}": formatLaoPhone(outlet.phone),
  };
}

export interface PrepareOutcome {
  prepared: number;
  skippedDuplicates: number;
  skippedFrequencyCap: number;
}

/** Create recipient jobs for a campaign, applying consent, eligibility and caps. */
export async function prepareRecipients(campaign: CampaignDocument): Promise<PrepareOutcome> {
  if (!campaign.templateId) throw new ValidationError("The campaign has no message template.");

  const base = buildOutletFilter(campaign.audience as unknown as OutletFilterInput);
  const outlets = await OutletModel.find(deliverableFilter(base)).sort({ name: 1 });

  // One message per unique phone number.
  const byPhone = new Map<string, OutletDocument>();
  let skippedDuplicates = 0;
  for (const outlet of outlets) {
    const phone = outlet.phoneNormalized;
    if (!phone) continue;
    if (byPhone.has(phone)) {
      skippedDuplicates += 1;
      continue;
    }
    byPhone.set(phone, outlet);
  }

  // Frequency cap across all campaigns in the rolling window.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await CampaignRecipientModel.aggregate<{ _id: string; count: number }>([
    { $match: { phoneNumberSnapshot: { $in: Array.from(byPhone.keys()) }, createdAt: { $gte: since } } },
    { $group: { _id: "$phoneNumberSnapshot", count: { $sum: 1 } } },
  ]);
  const recentCounts = new Map(recent.map((row) => [row._id, row.count]));

  const docs = [];
  let skippedFrequencyCap = 0;
  for (const [phone, outlet] of byPhone.entries()) {
    if ((recentCounts.get(phone) ?? 0) >= env.MESSAGING_DAILY_CAP_PER_CONTACT) {
      skippedFrequencyCap += 1;
      continue;
    }
    docs.push({
      campaignId: campaign._id,
      outletId: outlet._id,
      outletNameSnapshot: outlet.name,
      phoneNumberSnapshot: phone,
      templateId: campaign.templateId,
      templateNameSnapshot: campaign.templateName,
      languageSnapshot: campaign.language,
      variables: buildVariables(outlet, campaign),
      status: "Queued" as const,
    });
  }

  let prepared = 0;
  if (docs.length > 0) {
    const created = await CampaignRecipientModel.insertMany(docs, { ordered: false }).catch((error) => {
      // Ignore duplicate-key errors from a repeated dispatch; they are the guard.
      if ((error as { code?: number }).code === 11000 || (error as { writeErrors?: unknown[] }).writeErrors) {
        return (error as { insertedDocs?: unknown[] }).insertedDocs ?? [];
      }
      throw error;
    });
    prepared = created.length;
  }

  return { prepared, skippedDuplicates, skippedFrequencyCap };
}

export async function createRecipientJobs(
  id: string,
  actorId: string,
  recordAudit: AuditRecorder,
): Promise<{ campaign: CampaignDocument; outcome: PrepareOutcome }> {
  const campaign = await getCampaign(id);
  assertTransition(campaign.status as CampaignStatus, "Sending");

  const template = campaign.templateId ? await MessageTemplateModel.findById(campaign.templateId) : null;
  if (!template) throw new ValidationError("The campaign has no message template.");
  if (!(await isTemplateDispatchable(template))) {
    throw new ConflictError(
      `The template “${template.name}” is ${template.status}; only approved templates may be dispatched.`,
    );
  }

  let outcome = { prepared: 0, skippedDuplicates: 0, skippedFrequencyCap: 0 };
  try {
    outcome = await prepareRecipients(campaign);
  } catch (error) {
    logger.error({ err: error, campaignId: id }, "Failed to prepare campaign recipients");
    campaign.status = "Failed";
    campaign.lastError = (error as Error).message;
    await campaign.save();
    throw error;
  }

  campaign.status = "Sending";
  campaign.startedAt = new Date();
  await campaign.save();

  await template.updateOne({ $inc: { usageCount: 1 } });

  await recordAudit({
    type: "campaign",
    message: `Started campaign ${campaign.name} with ${outcome.prepared} recipients.`,
    actorId,
    targetType: "campaign",
    targetId: campaign._id,
    metadata: { ...outcome, simulated: getWhatsAppProvider().simulated },
  });

  enqueueCampaignDispatch(String(campaign._id));

  return { campaign, outcome };
}

/**
 * Scheduler entry point: prepare recipients for a due campaign and enqueue its
 * dispatch. Reached from the scheduler sweep, not from a request.
 */
export async function dispatchScheduledCampaign(id: string): Promise<void> {
  const campaign = await CampaignModel.findById(id);
  if (!campaign || campaign.status !== "Scheduled") return;

  const template = campaign.templateId ? await MessageTemplateModel.findById(campaign.templateId) : null;
  if (!template) {
    campaign.status = "Failed";
    campaign.lastError = "The campaign has no message template.";
    await campaign.save();
    return;
  }
  if (!(await isTemplateDispatchable(template))) {
    campaign.status = "Failed";
    campaign.lastError = `The template “${template.name}” is ${template.status}; dispatch was refused.`;
    await campaign.save();
    return;
  }

  await prepareRecipients(campaign);
  campaign.status = "Sending";
  campaign.startedAt = new Date();
  await campaign.save();
  await template.updateOne({ $inc: { usageCount: 1 } });
  enqueueCampaignDispatch(String(campaign._id));
}

/** Worker entry point: send every queued recipient, then finalise metrics. */
export async function dispatchCampaign(campaignId: string): Promise<void> {
  const campaign = await CampaignModel.findById(campaignId);
  if (!campaign) {
    logger.warn({ campaignId }, "Dispatch requested for a missing campaign");
    return;
  }
  const template = campaign.templateId ? await MessageTemplateModel.findById(campaign.templateId) : null;
  if (!template) {
    campaign.status = "Failed";
    campaign.lastError = "The campaign has no message template.";
    await campaign.save();
    return;
  }

  const provider = getWhatsAppProvider();
  const recipients = await CampaignRecipientModel.find({ campaignId, status: { $in: ["Queued", "Attempted"] } });

  const CONCURRENCY = 5;
  for (let index = 0; index < recipients.length; index += CONCURRENCY) {
    const batch = recipients.slice(index, index + CONCURRENCY);
    await Promise.all(batch.map((recipient) => sendToRecipient(recipient, template, provider)));
  }

  await applySimulatedReceipts(campaignId);
  const metrics = await recomputeCampaignMetrics(campaignId);

  const remaining = await CampaignRecipientModel.countDocuments({ campaignId, status: { $in: ["Queued", "Attempted"] } });
  const completed = await maybeCompleteCampaign(campaignId);
  if (!completed && remaining === 0) {
    campaign.status = metrics.failed > 0 && metrics.sent === 0 ? "Failed" : "Completed";
    campaign.completedAt = new Date();
    campaign.sentAt = campaign.sentAt ?? new Date();
    await campaign.save();
  }

  logger.info({ campaignId, metrics, simulated: provider.simulated }, "Campaign dispatch finished");
}

/* ------------------------------------------------------------------ */
/* Recipient reads and reporting                                      */
/* ------------------------------------------------------------------ */

export async function listRecipients(id: string, query: CampaignRecipientQuery) {
  await getCampaign(id);
  const filter: FilterQuery<CampaignRecipientDocument> = { campaignId: id };
  if (query.status !== "all") filter.status = query.status;
  const skip = (query.page - 1) * query.limit;
  const [docs, total] = await Promise.all([
    CampaignRecipientModel.find(filter)
      .sort({ outletNameSnapshot: 1, _id: 1 })
      .skip(skip)
      .limit(query.limit),
    CampaignRecipientModel.countDocuments(filter),
  ]);

  return {
    items: docs.map((doc) => {
      const json = doc.toJSON() as Record<string, unknown>;
      return {
        id: String(doc._id),
        campaignId: String(doc.campaignId),
        outletId: String(doc.outletId),
        outletName: doc.outletNameSnapshot,
        phone: doc.phoneNumberSnapshot,
        status: doc.status,
        providerMessageId: doc.providerMessageId ?? null,
        attemptCount: doc.attemptCount ?? 0,
        attemptedAt: doc.attemptedAt ?? null,
        sentAt: doc.sentAt ?? null,
        deliveredAt: doc.deliveredAt ?? null,
        readAt: doc.readAt ?? null,
        failedAt: doc.failedAt ?? null,
        failureCode: doc.failureCode ?? null,
        failureReason: doc.failureReason ?? null,
        createdAt: json.createdAt,
      };
    }),
    total,
  };
}

export interface CampaignReport {
  campaignId: string;
  status: CampaignStatus;
  simulated: boolean;
  recipients: number;
  metrics: Awaited<ReturnType<typeof computeCampaignMetrics>>;
  deliveryRate: number;
  readRate: number;
  failures: { code: string; count: number }[];
  audienceSnapshot: unknown;
}

export async function campaignReport(id: string): Promise<CampaignReport> {
  const campaign = await getCampaign(id);
  const metrics = await computeCampaignMetrics(id);

  const failureGroups = await CampaignRecipientModel.aggregate<{ _id: string; count: number }>([
    { $match: { campaignId: campaign._id, status: "Failed" } },
    { $group: { _id: "$failureCode", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  return {
    campaignId: String(campaign._id),
    status: campaign.status as CampaignStatus,
    simulated: getWhatsAppProvider().simulated,
    recipients: campaign.recipients ?? 0,
    metrics,
    deliveryRate: metrics.attempted > 0 ? metrics.delivered / metrics.attempted : 0,
    readRate: metrics.delivered > 0 ? (metrics.read ?? 0) / metrics.delivered : 0,
    failures: failureGroups.map((group) => ({ code: group._id ?? "UNKNOWN", count: group.count })),
    audienceSnapshot: campaign.audienceSnapshot ?? null,
  };
}
