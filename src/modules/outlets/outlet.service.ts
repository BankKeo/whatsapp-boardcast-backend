/**
 * Outlet service.
 *
 * Owns the server-side outlet register: safe query construction, pagination,
 * statistics, CSV export, and duplicate/data-quality maintenance. Consent and
 * eligibility rules from docs/starter-project.md §4.2 are enforced here and in
 * the Mongoose model's derived-field hook, never inferred from a phone number's
 * mere presence.
 *
 * All client input is translated into a whitelisted MongoDB filter; raw
 * operators from the client are never executed.
 */

import type { FilterQuery, PipelineStage, Types } from "mongoose";
import { escapeRegex } from "../../common/utils/escape";
import { toCsv } from "../../common/utils/csv";
import { phoneDigits } from "../../common/utils/phone";
import { ConflictError, NotFoundError } from "../../common/errors/AppError";
import { OutletModel, deriveOutletFields, type OutletDocument } from "./outlet.model";
import { outletFormSchema, toOutletFilterInput, type OutletFormValues, type OutletListQuery } from "./outlet.schema";
import { PROVINCES, districtsFor } from "../../common/constants/laos";
import type { AuditInput } from "../audit-logs/auditLog.service";

export type AuditRecorder = (input: AuditInput) => Promise<void>;

/* ------------------------------------------------------------------ */
/* View / serialisation                                               */
/* ------------------------------------------------------------------ */

/** API shape: the dashboard's `Outlet` plus the consent/eligibility fields. */
export function toOutletView(doc: OutletDocument) {
  const json = doc.toJSON() as Record<string, unknown>;
  json.lastUpdated = doc.updatedAt;
  return {
    id: String(doc._id),
    name: doc.name,
    ownerName: doc.ownerName,
    phone: doc.phone,
    phoneNormalized: doc.phoneNormalized,
    phoneStatus: doc.phoneStatus,
    province: doc.province,
    district: doc.district,
    village: doc.village,
    address: doc.address,
    category: doc.category,
    whatsappVerified: doc.whatsappVerified,
    whatsappEligibility: doc.whatsappEligibility,
    marketingConsent: doc.marketingConsent,
    consentStatus: doc.consentStatus,
    consentRecordedAt: doc.consentRecordedAt ?? null,
    consentSource: doc.consentSource ?? null,
    consentRevokedAt: doc.consentRevokedAt ?? null,
    status: doc.status,
    channel: doc.channel,
    notes: doc.notes,
    dataQualityStatus: doc.dataQualityStatus,
    duplicatePhone: doc.duplicatePhone,
    createdAt: json.createdAt,
    updatedAt: json.updatedAt,
    lastUpdated: json.updatedAt,
  };
}

/* ------------------------------------------------------------------ */
/* Safe query construction                                            */
/* ------------------------------------------------------------------ */

export interface OutletFilterInput {
  search?: string;
  provinces?: string[];
  districts?: string[];
  categories?: string[];
  eligibility?: "any" | "eligible" | "ineligible";
  consent?: "any" | "consented" | "not-consented";
  phoneStatus?: "any" | "Valid" | "Invalid" | "Missing";
  dataQuality?: "any" | "Complete" | "Needs review" | "Incomplete";
}

/** Translate whitelisted filters into a MongoDB filter document. */
export function buildOutletFilter(filters: OutletFilterInput): FilterQuery<OutletDocument> {
  const and: FilterQuery<OutletDocument>[] = [];

  const search = filters.search?.trim();
  if (search) {
    const regex = new RegExp(escapeRegex(search), "i");
    const or: FilterQuery<OutletDocument>[] = [
      { name: regex },
      { ownerName: regex },
      { province: regex },
      { district: regex },
      { phone: regex },
    ];
    const digits = phoneDigits(search);
    if (digits.length >= 3) {
      or.push({ phoneNormalized: new RegExp(escapeRegex(digits)) });
    }
    and.push({ $or: or });
  }

  if (filters.provinces && filters.provinces.length > 0) and.push({ province: { $in: filters.provinces } });
  if (filters.districts && filters.districts.length > 0) and.push({ district: { $in: filters.districts } });
  if (filters.categories && filters.categories.length > 0) and.push({ category: { $in: filters.categories } });

  if (filters.eligibility === "eligible") and.push({ whatsappEligibility: "Eligible" });
  if (filters.eligibility === "ineligible") and.push({ whatsappEligibility: { $ne: "Eligible" } });

  if (filters.consent === "consented") and.push({ consentStatus: "Opted in" });
  if (filters.consent === "not-consented") and.push({ consentStatus: { $ne: "Opted in" } });

  if (filters.phoneStatus && filters.phoneStatus !== "any") and.push({ phoneStatus: filters.phoneStatus });
  if (filters.dataQuality && filters.dataQuality !== "any") and.push({ dataQualityStatus: filters.dataQuality });

  return and.length > 0 ? { $and: and } : {};
}

/** Recipients eligible for marketing dispatch: verified + consented + not revoked. */
export function deliverableFilter(base: FilterQuery<OutletDocument>): FilterQuery<OutletDocument> {
  return {
    $and: [base, { whatsappEligibility: "Eligible" }, { consentStatus: "Opted in" }, { phoneNormalized: { $ne: null } }],
  };
}

const SORT_FIELDS: Record<string, string> = {
  name: "name",
  ownerName: "ownerName",
  phone: "phoneNormalized",
  province: "province",
  district: "district",
  category: "category",
  eligibility: "whatsappEligibility",
  lastUpdated: "updatedAt",
};

/* ------------------------------------------------------------------ */
/* Reads                                                              */
/* ------------------------------------------------------------------ */

export async function listOutlets(query: OutletListQuery) {
  const filter = buildOutletFilter(toOutletFilterInput(query));
  const sortField = SORT_FIELDS[query.sort] ?? "name";
  const skip = (query.page - 1) * query.limit;

  const [docs, total] = await Promise.all([
    OutletModel.find(filter)
      .sort({ [sortField]: query.direction === "asc" ? 1 : -1, _id: 1 })
      .skip(skip)
      .limit(query.limit),
    OutletModel.countDocuments(filter),
  ]);

  return { items: docs.map(toOutletView), total };
}

export async function getOutlet(id: string): Promise<OutletDocument> {
  const doc = await OutletModel.findById(id);
  if (!doc) throw new NotFoundError("Outlet not found.");
  return doc;
}

/** Outlets that share a normalised phone number with the given one. */
export async function findPhoneDuplicates(phoneNormalized: string, excludeId?: string | Types.ObjectId) {
  const filter: FilterQuery<OutletDocument> = { phoneNormalized };
  if (excludeId) filter._id = { $ne: excludeId };
  return OutletModel.find(filter);
}

/* ------------------------------------------------------------------ */
/* Writes                                                             */
/* ------------------------------------------------------------------ */

function consentFields(values: Pick<OutletFormValues, "marketingConsent" | "consentSource">, existing?: OutletDocument) {
  const wasConsented = existing?.marketingConsent ?? false;
  const nowConsented = values.marketingConsent;

  // Withdrawal is a first-class event, not a silent boolean flip.
  if (wasConsented && !nowConsented) {
    return {
      marketingConsent: false,
      consentRevokedAt: new Date(),
    };
  }

  if (nowConsented) {
    return {
      marketingConsent: true,
      consentRevokedAt: null,
      consentRecordedAt: existing?.consentRecordedAt ?? new Date(),
      consentSource: values.consentSource ?? existing?.consentSource ?? "Admin entry",
    };
  }

  return { marketingConsent: false, consentRevokedAt: null };
}

export async function createOutlet(
  values: OutletFormValues,
  actorId: string,
  recordAudit: AuditRecorder,
): Promise<OutletDocument> {
  const doc = await OutletModel.create({
    name: values.name,
    ownerName: values.ownerName,
    phone: values.phone,
    province: values.province,
    district: values.district,
    village: values.village,
    address: values.address,
    category: values.category,
    status: values.status,
    channel: values.channel,
    whatsappVerified: values.whatsappVerified,
    notes: values.notes,
    lastUpdatedBy: actorId,
    ...consentFields(values),
  });

  await refreshDuplicateFlags(doc.phoneNormalized);

  await recordAudit({
    type: "outlet",
    message: `Created outlet ${doc.name}.`,
    actorId,
    targetType: "outlet",
    targetId: doc._id,
    metadata: { phone: doc.phone, province: doc.province, category: doc.category },
  });

  return getOutlet(String(doc._id));
}

export async function updateOutlet(
  id: string,
  patch: Partial<OutletFormValues>,
  actorId: string,
  recordAudit: AuditRecorder,
): Promise<OutletDocument> {
  const doc = await getOutlet(id);
  const previousPhone = doc.phoneNormalized;

  // Merge then validate the full record so partial updates cannot bypass the
  // cross-field rules (district belongs to province, verified needs a number).
  const merged = outletFormSchema.parse({
    name: patch.name ?? doc.name,
    ownerName: patch.ownerName ?? doc.ownerName,
    phone: patch.phone ?? doc.phone,
    province: patch.province ?? doc.province,
    district: patch.district ?? doc.district,
    village: patch.village ?? doc.village,
    address: patch.address ?? doc.address,
    category: patch.category ?? doc.category,
    status: patch.status ?? doc.status,
    channel: patch.channel ?? doc.channel,
    whatsappVerified: patch.whatsappVerified ?? doc.whatsappVerified,
    marketingConsent: patch.marketingConsent ?? doc.marketingConsent,
    consentSource: patch.consentSource ?? doc.consentSource ?? undefined,
    notes: patch.notes ?? doc.notes,
  });

  doc.name = merged.name;
  doc.ownerName = merged.ownerName;
  doc.phone = merged.phone;
  doc.province = merged.province;
  doc.district = merged.district;
  doc.village = merged.village;
  doc.address = merged.address;
  doc.category = merged.category;
  doc.status = merged.status;
  doc.channel = merged.channel;
  doc.whatsappVerified = merged.whatsappVerified;
  doc.notes = merged.notes;
  doc.lastUpdatedBy = actorId as unknown as Types.ObjectId;
  Object.assign(doc, consentFields(merged, doc));

  await doc.save();

  await refreshDuplicateFlags(previousPhone);
  if (doc.phoneNormalized !== previousPhone) {
    await refreshDuplicateFlags(doc.phoneNormalized);
  }

  await recordAudit({
    type: "outlet",
    message: `Updated outlet ${doc.name}.`,
    actorId,
    targetType: "outlet",
    targetId: doc._id,
    metadata: { fields: Object.keys(patch) },
  });

  return getOutlet(id);
}

export async function deleteOutlet(id: string, actorId: string, recordAudit: AuditRecorder): Promise<void> {
  const doc = await getOutlet(id);
  const phone = doc.phoneNormalized;
  await doc.deleteOne();
  await refreshDuplicateFlags(phone);

  await recordAudit({
    type: "outlet",
    message: `Deleted outlet ${doc.name}.`,
    actorId,
    targetType: "outlet",
    targetId: doc._id,
    metadata: { phone: doc.phone },
  });
}

/** Bulk create used by the outlet UI; each row is validated independently. */
export async function bulkCreateOutlets(
  values: OutletFormValues[],
  actorId: string,
  recordAudit: AuditRecorder,
): Promise<{ created: number; ids: string[] }> {
  const docs = await OutletModel.insertMany(
    values.map((value) => ({
      name: value.name,
      ownerName: value.ownerName,
      phone: value.phone,
      province: value.province,
      district: value.district,
      village: value.village,
      address: value.address,
      category: value.category,
      status: value.status,
      channel: value.channel,
      whatsappVerified: value.whatsappVerified,
      notes: value.notes,
      lastUpdatedBy: actorId,
      ...consentFields(value),
    })),
    { ordered: false },
  );

  const ids = docs.map((doc) => String(doc._id));
  await refreshDuplicateFlags();

  await recordAudit({
    type: "outlet",
    message: `Bulk-created ${docs.length} outlets.`,
    actorId,
    targetType: "outlet",
    metadata: { count: docs.length },
  });

  return { created: docs.length, ids };
}

/* ------------------------------------------------------------------ */
/* Duplicate / data-quality maintenance                               */
/* ------------------------------------------------------------------ */

/**
 * Recompute the `duplicatePhone` flag (and dependent data-quality bucket) for one
 * number or the whole register. Called after any write so the stored derived
 * fields stay correct without recomputing on every read.
 */
export async function refreshDuplicateFlags(phoneNormalized?: string | null): Promise<void> {
  if (phoneNormalized) {
    const count = await OutletModel.countDocuments({ phoneNormalized });
    const duplicate = count > 1;
    const docs = await OutletModel.find({ phoneNormalized });
    await applyDuplicateFlags(docs, duplicate);
    return;
  }

  const groups = await OutletModel.aggregate<{ _id: string; count: number }>([
    { $match: { phoneNormalized: { $ne: null } } },
    { $group: { _id: "$phoneNormalized", count: { $sum: 1 } } },
  ]);
  const duplicates = new Set(groups.filter((group) => group.count > 1).map((group) => group._id));

  const cursor = OutletModel.find().cursor();
  let batch: OutletDocument[] = [];
  for await (const doc of cursor as AsyncIterable<OutletDocument>) {
    batch.push(doc);
    if (batch.length >= 500) {
      await bulkApplyDuplicateFlags(batch, duplicates);
      batch = [];
    }
  }
  if (batch.length > 0) await bulkApplyDuplicateFlags(batch, duplicates);
}

function derivedUpdate(doc: OutletDocument, duplicate: boolean) {
  const derived = deriveOutletFields({
    phone: doc.phone,
    whatsappVerified: doc.whatsappVerified,
    marketingConsent: doc.marketingConsent,
    consentRevokedAt: doc.consentRevokedAt,
    duplicatePhone: duplicate,
  });
  return {
    duplicatePhone: duplicate,
    phoneNormalized: derived.phoneNormalized,
    phoneStatus: derived.phoneStatus,
    whatsappEligibility: derived.whatsappEligibility,
    consentStatus: derived.consentStatus,
    dataQualityStatus: derived.dataQualityStatus,
  };
}

async function applyDuplicateFlags(docs: OutletDocument[], duplicate: boolean): Promise<void> {
  if (docs.length === 0) return;
  await OutletModel.bulkWrite(
    docs.map((doc) => ({
      updateOne: { filter: { _id: doc._id }, update: { $set: derivedUpdate(doc, duplicate) } },
    })),
  );
}

async function bulkApplyDuplicateFlags(docs: OutletDocument[], duplicates: Set<string>): Promise<void> {
  await OutletModel.bulkWrite(
    docs.map((doc) => ({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: derivedUpdate(doc, doc.phoneNormalized ? duplicates.has(doc.phoneNormalized) : false) },
      },
    })),
  );
}

/* ------------------------------------------------------------------ */
/* Audience breakdown                                                 */
/* ------------------------------------------------------------------ */

export interface AudienceBreakdown {
  matched: number;
  eligible: number;
  consented: number;
  deliverable: number;
  unreachable: number;
  withoutConsent: number;
  notVerified: number;
}

export async function audienceBreakdown(filters: OutletFilterInput): Promise<AudienceBreakdown> {
  const match = buildOutletFilter(filters);
  const pipeline: PipelineStage[] = [
    { $match: match },
    {
      $group: {
        _id: null,
        matched: { $sum: 1 },
        eligible: { $sum: { $cond: [{ $eq: ["$whatsappEligibility", "Eligible"] }, 1, 0] } },
        consented: { $sum: { $cond: [{ $eq: ["$consentStatus", "Opted in"] }, 1, 0] } },
        deliverable: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$whatsappEligibility", "Eligible"] },
                  { $eq: ["$consentStatus", "Opted in"] },
                  { $ne: ["$phoneNormalized", null] },
                ],
              },
              1,
              0,
            ],
          },
        },
        unreachable: { $sum: { $cond: [{ $ne: ["$phoneStatus", "Valid"] }, 1, 0] } },
        withoutConsent: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ["$whatsappEligibility", "Eligible"] }, { $ne: ["$consentStatus", "Opted in"] }] },
              1,
              0,
            ],
          },
        },
        notVerified: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ["$phoneStatus", "Valid"] }, { $eq: ["$whatsappVerified", false] }] },
              1,
              0,
            ],
          },
        },
      },
    },
  ];

  const [result] = await OutletModel.aggregate<AudienceBreakdown & { _id: null }>(pipeline);
  return (
    result ?? {
      matched: 0,
      eligible: 0,
      consented: 0,
      deliverable: 0,
      unreachable: 0,
      withoutConsent: 0,
      notVerified: 0,
    }
  );
}

/* ------------------------------------------------------------------ */
/* Statistics                                                         */
/* ------------------------------------------------------------------ */

export async function outletStats() {
  const [totals] = await OutletModel.aggregate([
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        eligible: { $sum: { $cond: [{ $eq: ["$whatsappEligibility", "Eligible"] }, 1, 0] } },
        consented: { $sum: { $cond: [{ $eq: ["$consentStatus", "Opted in"] }, 1, 0] } },
        verified: { $sum: { $cond: ["$whatsappVerified", 1, 0] } },
        missingPhone: { $sum: { $cond: [{ $eq: ["$phoneStatus", "Missing"] }, 1, 0] } },
        invalidPhone: { $sum: { $cond: [{ $eq: ["$phoneStatus", "Invalid"] }, 1, 0] } },
        duplicatePhone: { $sum: { $cond: ["$duplicatePhone", 1, 0] } },
        complete: { $sum: { $cond: [{ $eq: ["$dataQualityStatus", "Complete"] }, 1, 0] } },
        needsReview: { $sum: { $cond: [{ $eq: ["$dataQualityStatus", "Needs review"] }, 1, 0] } },
        incomplete: { $sum: { $cond: [{ $eq: ["$dataQualityStatus", "Incomplete"] }, 1, 0] } },
      },
    },
  ]);

  const byProvinceRaw = await OutletModel.aggregate([
    {
      $group: {
        _id: "$province",
        count: { $sum: 1 },
        eligible: { $sum: { $cond: [{ $eq: ["$whatsappEligibility", "Eligible"] }, 1, 0] } },
      },
    },
  ]);
  const provinceMap = new Map(byProvinceRaw.map((row) => [row._id as string, row]));

  const byCategoryRaw = await OutletModel.aggregate([
    {
      $group: {
        _id: "$category",
        count: { $sum: 1 },
        eligible: { $sum: { $cond: [{ $eq: ["$whatsappEligibility", "Eligible"] }, 1, 0] } },
      },
    },
  ]);
  const categoryMap = new Map(byCategoryRaw.map((row) => [row._id as string, row]));

  return {
    total: totals?.total ?? 0,
    eligible: totals?.eligible ?? 0,
    consented: totals?.consented ?? 0,
    verified: totals?.verified ?? 0,
    missingPhone: totals?.missingPhone ?? 0,
    invalidPhone: totals?.invalidPhone ?? 0,
    duplicatePhone: totals?.duplicatePhone ?? 0,
    complete: totals?.complete ?? 0,
    needsReview: totals?.needsReview ?? 0,
    incomplete: totals?.incomplete ?? 0,
    byProvince: PROVINCES.map((province) => ({
      province: province.name,
      count: provinceMap.get(province.name)?.count ?? 0,
      eligible: provinceMap.get(province.name)?.eligible ?? 0,
    })).sort((a, b) => b.count - a.count),
    byCategory: (["On-Trade", "Off-Trade", "Modern Trade"] as const).map((category) => ({
      category,
      count: categoryMap.get(category)?.count ?? 0,
      eligible: categoryMap.get(category)?.eligible ?? 0,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* CSV export                                                         */
/* ------------------------------------------------------------------ */

export const OUTLET_CSV_HEADERS = [
  "Outlet ID",
  "Outlet Name",
  "Owner Name",
  "Phone Number",
  "Province",
  "District",
  "Village",
  "Outlet Category",
  "WhatsApp Eligibility",
  "Marketing Consent",
  "Data Quality",
  "Status",
  "Source",
  "Last Updated",
] as const;

export const OUTLET_EXPORT_MAX = 50_000;

export async function exportOutletsCsv(query: OutletListQuery): Promise<string> {
  const filter = buildOutletFilter(toOutletFilterInput(query));
  const docs = await OutletModel.find(filter).sort({ name: 1 }).limit(OUTLET_EXPORT_MAX);

  const rows = docs.map((doc) => [
    String(doc._id),
    doc.name,
    doc.ownerName,
    doc.phone,
    doc.province,
    doc.district,
    doc.village,
    doc.category,
    doc.whatsappEligibility,
    doc.consentStatus === "Opted in" ? "Consented" : "No consent",
    doc.dataQualityStatus,
    doc.status,
    doc.channel,
    doc.updatedAt ? new Date(doc.updatedAt).toISOString() : "",
  ]);

  return toCsv(OUTLET_CSV_HEADERS, rows);
}

/* ------------------------------------------------------------------ */
/* Import helpers (shared with the imports module)                    */
/* ------------------------------------------------------------------ */

export function districtsForProvince(province: string): string[] {
  return districtsFor(province);
}

export function assertProvinceDistrict(province: string, district: string): void {
  if (!districtsFor(province).includes(district)) {
    throw new ConflictError(`District ${district} does not belong to ${province}.`);
  }
}

export function normalizeImportValues(values: OutletFormValues): OutletFormValues {
  const normalized = outletFormSchema.parse(values);
  assertProvinceDistrict(normalized.province, normalized.district);
  return normalized;
}
