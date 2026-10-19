/**
 * Audience segment service.
 *
 * Segments store a structured, whitelisted filter definition — never a raw Mongo
 * query. Preview and recipient resolution reuse the outlet module's safe query
 * builder, and the recipient list always re-applies the server-side consent and
 * eligibility rules (docs/starter-project.md §5.3).
 */

import type { FilterQuery } from "mongoose";
import { escapeRegex } from "../../common/utils/escape";
import { NotFoundError } from "../../common/errors/AppError";
import { SegmentModel, type SegmentDocument } from "./segment.model";
import {
  audienceBreakdown,
  buildOutletFilter,
  deliverableFilter,
  toOutletView,
  type OutletFilterInput,
} from "../outlets/outlet.service";
import { OutletModel, type OutletDocument } from "../outlets/outlet.model";
import type { AuditInput } from "../audit-logs/auditLog.service";

export type AuditRecorder = (input: AuditInput) => Promise<void>;

export interface SegmentView {
  id: string;
  name: string;
  description: string;
  filters: unknown;
  createdBy: string;
  updatedBy: string | null;
  matchCount: number;
  lastPreviewedAt: Date | null;
  createdAt: Date | undefined;
  updatedAt: Date | undefined;
}

export function toSegmentView(doc: SegmentDocument): SegmentView {
  const json = doc.toJSON() as Record<string, unknown>;
  return {
    id: String(doc._id),
    name: doc.name,
    description: doc.description,
    filters: doc.filters,
    createdBy: String(doc.createdBy),
    updatedBy: doc.updatedBy ? String(doc.updatedBy) : null,
    matchCount: doc.lastMatchCount ?? 0,
    lastPreviewedAt: doc.lastPreviewedAt ?? null,
    createdAt: json.createdAt as Date | undefined,
    updatedAt: json.updatedAt as Date | undefined,
  };
}

export async function listSegments(query: { search: string; page: number; limit: number }) {
  const filter: FilterQuery<SegmentDocument> = {};
  if (query.search) {
    const regex = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ name: regex }, { description: regex }];
  }
  const skip = (query.page - 1) * query.limit;
  const [docs, total] = await Promise.all([
    SegmentModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit),
    SegmentModel.countDocuments(filter),
  ]);
  return { items: docs.map(toSegmentView), total };
}

export async function getSegment(id: string): Promise<SegmentDocument> {
  const doc = await SegmentModel.findById(id);
  if (!doc) throw new NotFoundError("Audience segment not found.");
  return doc;
}

export async function createSegment(
  values: { name: string; description: string; filters: OutletFilterInput },
  actorId: string,
  recordAudit: AuditRecorder,
): Promise<SegmentDocument> {
  const breakdown = await audienceBreakdown(values.filters);
  const doc = await SegmentModel.create({
    name: values.name,
    description: values.description,
    filters: values.filters,
    createdBy: actorId,
    updatedBy: actorId,
    lastMatchCount: breakdown.matched,
    lastPreviewedAt: new Date(),
  });

  await recordAudit({
    type: "segment",
    message: `Created audience segment ${doc.name}.`,
    actorId,
    targetType: "segment",
    targetId: doc._id,
    metadata: { matchCount: breakdown.matched },
  });

  return doc;
}

export async function updateSegment(
  id: string,
  patch: { name?: string; description?: string; filters?: OutletFilterInput },
  actorId: string,
  recordAudit: AuditRecorder,
): Promise<SegmentDocument> {
  const doc = await getSegment(id);
  if (patch.name !== undefined) doc.name = patch.name;
  if (patch.description !== undefined) doc.description = patch.description;
  if (patch.filters !== undefined) {
    doc.filters = patch.filters as never;
    const breakdown = await audienceBreakdown(patch.filters);
    doc.lastMatchCount = breakdown.matched;
    doc.lastPreviewedAt = new Date();
  }
  doc.updatedBy = actorId as unknown as SegmentDocument["updatedBy"];
  await doc.save();

  await recordAudit({
    type: "segment",
    message: `Updated audience segment ${doc.name}.`,
    actorId,
    targetType: "segment",
    targetId: doc._id,
  });

  return doc;
}

export async function deleteSegment(id: string, actorId: string, recordAudit: AuditRecorder): Promise<void> {
  const doc = await getSegment(id);
  await doc.deleteOne();
  await recordAudit({
    type: "segment",
    message: `Deleted audience segment ${doc.name}.`,
    actorId,
    targetType: "segment",
    targetId: doc._id,
  });
}

export interface SegmentPreview {
  filters: OutletFilterInput;
  breakdown: Awaited<ReturnType<typeof audienceBreakdown>>;
  count: number;
  sample: ReturnType<typeof toOutletView>[];
}

export async function previewSegment(filters: OutletFilterInput, limit: number): Promise<SegmentPreview> {
  const breakdown = await audienceBreakdown(filters);
  const sample = await OutletModel.find(buildOutletFilter(filters))
    .sort({ name: 1 })
    .limit(Math.min(Math.max(limit, 1), 50));
  return { filters, breakdown, count: breakdown.matched, sample: sample.map(toOutletView) };
}

/** Actual recipients: eligible + consented, one per unique phone number. */
export async function segmentRecipients(id: string, page: number, limit: number) {
  const segment = await getSegment(id);
  const base = buildOutletFilter(segment.filters as unknown as OutletFilterInput);
  const deliverable = deliverableFilter(base);

  const [totalResult] = await OutletModel.aggregate<{ total: number }>([
    { $match: deliverable },
    { $group: { _id: "$phoneNormalized" } },
    { $count: "total" },
  ]);

  const docs = await OutletModel.aggregate<OutletDocument>([
    { $match: deliverable },
    { $sort: { updatedAt: -1, _id: 1 } },
    { $group: { _id: "$phoneNormalized", doc: { $first: "$$ROOT" } } },
    { $replaceRoot: { newRoot: "$doc" } },
    { $sort: { name: 1 } },
    { $skip: (page - 1) * limit },
    { $limit: limit },
  ]);

  return {
    segmentId: String(segment._id),
    items: docs.map((doc) => ({
      id: String(doc._id),
      name: doc.name,
      ownerName: doc.ownerName,
      phone: doc.phone,
      province: doc.province,
      district: doc.district,
      category: doc.category,
    })),
    total: totalResult?.total ?? 0,
  };
}
