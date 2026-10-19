/**
 * Message template service.
 *
 * Enforces docs/starter-project.md §5.5: templates are never marked approved
 * locally unless the configured provider (or the explicit local administrative
 * process in mock mode) confirms it. `providerTemplateId` is only ever written
 * from a provider response, never from client input.
 */

import type { FilterQuery } from "mongoose";
import { escapeRegex } from "../../common/utils/escape";
import { NotFoundError, ConflictError } from "../../common/errors/AppError";
import { MessageTemplateModel, type MessageTemplateDocument } from "./template.model";
import { extractVariables, type TemplateFormValues } from "./template.schema";
import { TEMPLATE_VARIABLE_LIBRARY, type TemplateStatus } from "../../common/constants/domain";
import { getWhatsAppProvider } from "../whatsapp/whatsapp.factory";
import type { AuditInput } from "../audit-logs/auditLog.service";

export type AuditRecorder = (input: AuditInput) => Promise<void>;

const LIBRARY_BY_KEY = new Map<string, { key: string; label: string; example: string }>(
  TEMPLATE_VARIABLE_LIBRARY.map((variable) => [variable.key, { ...variable }]),
);

export function variablesForBody(body: string) {
  return extractVariables(body).map(
    (key) =>
      LIBRARY_BY_KEY.get(key) ?? { key, label: "Unmapped variable", example: "—" },
  );
}

export function toTemplateView(doc: MessageTemplateDocument) {
  const json = doc.toJSON() as Record<string, unknown>;
  return {
    id: String(doc._id),
    name: doc.name,
    category: doc.category,
    language: doc.language,
    body: doc.body,
    variables: doc.variables,
    status: doc.status as TemplateStatus,
    approvalStatus: doc.approvalStatus as TemplateStatus,
    externalApprovalId: doc.externalApprovalId ?? null,
    providerTemplateId: doc.providerTemplateId ?? null,
    rejectionReason: doc.rejectionReason ?? null,
    lastSyncedAt: doc.lastSyncedAt ?? null,
    usageCount: doc.usageCount ?? 0,
    notes: doc.notes,
    createdAt: json.createdAt,
    updatedAt: json.updatedAt,
  };
}

export interface ListTemplatesQuery {
  search: string;
  status: TemplateStatus | "all";
  language: "en" | "lo" | "all";
  page: number;
  limit: number;
}

export async function listTemplates(query: ListTemplatesQuery) {
  const filter: FilterQuery<MessageTemplateDocument> = {};
  if (query.status !== "all") filter.status = query.status;
  if (query.language !== "all") filter.language = query.language;
  if (query.search) {
    const regex = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ name: regex }, { body: regex }, { category: regex }];
  }
  const skip = (query.page - 1) * query.limit;
  const [docs, total] = await Promise.all([
    MessageTemplateModel.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(query.limit),
    MessageTemplateModel.countDocuments(filter),
  ]);
  return { items: docs.map(toTemplateView), total };
}

export async function getTemplate(id: string): Promise<MessageTemplateDocument> {
  const doc = await MessageTemplateModel.findById(id);
  if (!doc) throw new NotFoundError("Message template not found.");
  return doc;
}

export async function createTemplate(
  values: TemplateFormValues,
  actorId: string,
  recordAudit: AuditRecorder,
): Promise<MessageTemplateDocument> {
  const doc = await MessageTemplateModel.create({
    name: values.name,
    category: values.category,
    language: values.language,
    body: values.body,
    variables: variablesForBody(values.body),
    notes: values.notes,
    status: "Draft",
    approvalStatus: "Draft",
    createdBy: actorId,
    updatedBy: actorId,
  });

  await recordAudit({
    type: "template",
    message: `Created template ${doc.name}.`,
    actorId,
    targetType: "template",
    targetId: doc._id,
  });

  return doc;
}

export async function updateTemplate(
  id: string,
  patch: Partial<TemplateFormValues>,
  actorId: string,
  recordAudit: AuditRecorder,
): Promise<MessageTemplateDocument> {
  const doc = await getTemplate(id);

  // A provider-approved template must be edited deliberately: editing resets it
  // to Draft so it cannot be dispatched with unapproved content.
  if (patch.body !== undefined && patch.body !== doc.body && doc.status === "Approved") {
    doc.status = "Draft";
    doc.approvalStatus = "Draft";
    doc.externalApprovalId = null;
  }

  if (patch.name !== undefined) doc.name = patch.name;
  if (patch.category !== undefined) doc.category = patch.category;
  if (patch.language !== undefined) doc.language = patch.language;
  if (patch.notes !== undefined) doc.notes = patch.notes;
  if (patch.body !== undefined) {
    doc.body = patch.body;
    doc.variables = variablesForBody(patch.body) as never;
  }
  doc.updatedBy = actorId as unknown as MessageTemplateDocument["updatedBy"];
  await doc.save();

  await recordAudit({
    type: "template",
    message: `Updated template ${doc.name}.`,
    actorId,
    targetType: "template",
    targetId: doc._id,
  });

  return doc;
}

export async function deleteTemplate(id: string, actorId: string, recordAudit: AuditRecorder): Promise<void> {
  const doc = await getTemplate(id);
  await doc.deleteOne();
  await recordAudit({
    type: "template",
    message: `Deleted template ${doc.name}.`,
    actorId,
    targetType: "template",
    targetId: doc._id,
  });
}

export async function submitForApproval(
  id: string,
  actorId: string,
  recordAudit: AuditRecorder,
): Promise<MessageTemplateDocument> {
  const doc = await getTemplate(id);
  if (doc.status === "Pending Approval") return doc;
  if (doc.status === "Approved") {
    throw new ConflictError("This template is already approved.");
  }

  const provider = getWhatsAppProvider();
  let externalId: string | null = null;
  try {
    const submission = await provider.submitTemplate({
      name: doc.name,
      category: doc.category,
      language: doc.language as "en" | "lo",
      body: doc.body,
      variables: doc.variables.map((variable) => ({
        key: variable.key,
        label: variable.label,
        example: variable.example,
      })),
    });
    externalId = submission.externalId;
  } catch (error) {
    throw new ConflictError(
      `The template could not be submitted to the WhatsApp provider: ${(error as Error).message}`,
    );
  }

  doc.status = "Pending Approval";
  doc.approvalStatus = "Pending Approval";
  doc.lastSyncedAt = new Date();
  if (provider.simulated) {
    doc.externalApprovalId = externalId;
  } else {
    doc.providerTemplateId = externalId;
  }
  await doc.save();

  await recordAudit({
    type: "template",
    message: `Submitted template ${doc.name} for approval.`,
    actorId,
    targetType: "template",
    targetId: doc._id,
    metadata: { provider: provider.name, simulated: provider.simulated },
  });

  return doc;
}

export async function refreshStatus(
  id: string,
  actorId: string,
  recordAudit: AuditRecorder,
): Promise<MessageTemplateDocument> {
  const doc = await getTemplate(id);
  const provider = getWhatsAppProvider();
  const result = await provider.getTemplateStatus(doc.name);

  doc.status = result.status;
  doc.approvalStatus = result.status;
  doc.rejectionReason = result.status === "Rejected" ? result.reason ?? "Rejected by the provider." : null;
  doc.lastSyncedAt = new Date();
  if (result.externalId) {
    if (result.simulated) doc.externalApprovalId = result.externalId;
    else doc.providerTemplateId = result.externalId;
  }
  await doc.save();

  await recordAudit({
    type: "template",
    message: `Refreshed template ${doc.name}: ${doc.status}${result.simulated ? " (simulated)" : ""}.`,
    actorId,
    targetType: "template",
    targetId: doc._id,
    metadata: { provider: provider.name, simulated: result.simulated, status: doc.status },
  });

  return doc;
}
