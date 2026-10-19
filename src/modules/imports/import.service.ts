/**
 * CSV import service.
 *
 * Ports the dashboard's `parseOutletsCsv` validation rules to the server and adds
 * the preview → commit workflow from docs/starter-project.md §5.2:
 *
 *  - header validation,
 *  - per-row validation with row-level errors and warnings,
 *  - phone normalisation,
 *  - duplicate detection against the file and the database,
 *  - a preview before anything is written,
 *  - batched inserts on commit with success / skipped / invalid counts.
 *
 * Invalid rows are never silently discarded — every row's outcome is recorded on
 * the import job.
 */

import type { AuditInput } from "../audit-logs/auditLog.service";
import { ImportJobModel, type ImportJobDocument } from "./importJob.model";
import { OutletModel } from "../outlets/outlet.model";
import { refreshDuplicateFlags } from "../outlets/outlet.service";
import type { ImportCommitValues, ImportPreviewValues } from "./importJob.schema";
import { PHONE_HELP, type OutletFormValues } from "../outlets/outlet.schema";
import { PROVINCES } from "../../common/constants/laos";
import { OUTLET_CATEGORIES, OUTLET_CHANNELS } from "../../common/constants/domain";
import { normalizeLaoPhone, phoneDigits } from "../../common/utils/phone";
import { parseCsv } from "../../common/utils/csv";
import { BadRequestError } from "../../common/errors/AppError";

export type AuditRecorder = (input: AuditInput) => Promise<void>;

const HEADER_ALIASES: Record<string, string[]> = {
  name: ["outlet name", "name", "outlet", "outlet name", "shop name"],
  ownerName: ["owner name", "owner", "contact name"],
  phone: ["phone number", "phone", "mobile", "whatsapp number"],
  province: ["province", "khoueng"],
  district: ["district", "muang", "khet"],
  village: ["village", "ban"],
  category: ["outlet category", "category", "type", "channel type"],
  status: ["status"],
  channel: ["source", "channel", "record source"],
  notes: ["notes", "comment", "comments"],
  whatsappVerified: ["whatsapp verified", "whatsapp eligibility", "eligibility", "verified"],
  marketingConsent: ["marketing consent", "consent", "opt-in", "opted in"],
};

const TRUTHY = new Set(["1", "true", "yes", "y", "consented", "eligible", "verified"]);
const FALSY = new Set(["0", "false", "no", "n", "not consented", "none", "ineligible"]);

const CATEGORY_LOOKUP = new Map(OUTLET_CATEGORIES.map((category) => [category.toLowerCase(), category]));

export interface ImportRowResult {
  lineNumber: number;
  status: "Importable" | "Warning" | "Error";
  duplicate: "file" | "database" | null;
  errors: string[];
  warnings: string[];
  values: OutletFormValues | null;
  raw: Record<string, string>;
}

export interface ImportResult {
  rows: ImportRowResult[];
  headerWarning: string | null;
  parseError: string | null;
  totalRows: number;
  importableRows: number;
  errorRows: number;
  warningRows: number;
  duplicateRows: number;
}

function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function buildHeaderMap(headers: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const header of headers) {
    const key = normaliseHeader(header);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(key)) {
        map.set(header, field);
        break;
      }
    }
  }
  return map;
}

function parseBoolean(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const normalised = value.trim().toLowerCase();
  if (!normalised) return null;
  if (TRUTHY.has(normalised)) return true;
  if (FALSY.has(normalised)) return false;
  return null;
}

async function databaseDuplicateSet(normalisedPhones: string[]): Promise<Set<string>> {
  if (normalisedPhones.length === 0) return new Set();
  const existing = await OutletModel.find({ phoneNormalized: { $in: normalisedPhones } }).select("phoneNormalized");
  return new Set(existing.map((doc) => doc.phoneNormalized!).filter(Boolean));
}

/** Pure-ish parse: validates every row and classifies duplicates. */
export async function parseOutletCsv(content: string, channel: string): Promise<ImportResult> {
  const parsed = parseCsv(content);
  const headerMap = buildHeaderMap(parsed.fields);
  const mappedFields = new Set(headerMap.values());

  let headerWarning: string | null = null;
  if (!mappedFields.has("name")) {
    headerWarning = "The file must include an “Outlet Name” column.";
  } else if (!mappedFields.has("phone")) {
    headerWarning = "The file must include a “Phone Number” column.";
  }
  if (!headerWarning && parsed.errors.length > 0) {
    headerWarning = `The file contained ${parsed.errors.length} parsing issue(s); rows were read on a best-effort basis.`;
  }

  // Collect normalised phones first so database duplicate detection is one query.
  const get = (row: Record<string, string>, field: string): string => {
    for (const [header, mapped] of headerMap) {
      if (mapped === field) return (row[header] ?? "").trim();
    }
    return "";
  };

  const filePhones: string[] = [];
  for (const raw of parsed.rows) {
    const normalised = normalizeLaoPhone(get(raw, "phone"));
    if (normalised) filePhones.push(normalised);
  }
  const dbDuplicates = await databaseDuplicateSet(Array.from(new Set(filePhones)));

  const seenInFile = new Map<string, number>();
  const rows: ImportRowResult[] = [];

  parsed.rows.forEach((raw, index) => {
    const lineNumber = index + 2;
    const errors: string[] = [];
    const warnings: string[] = [];

    const name = get(raw, "name");
    const ownerName = get(raw, "ownerName");
    const phoneRaw = get(raw, "phone");
    const provinceRaw = get(raw, "province");
    const districtRaw = get(raw, "district");
    const categoryRaw = get(raw, "category");
    const statusRaw = get(raw, "status");
    const channelRaw = get(raw, "channel");
    const notesRaw = get(raw, "notes");
    const verifiedRaw = parseBoolean(get(raw, "whatsappVerified"));
    const consentRaw = parseBoolean(get(raw, "marketingConsent"));

    if (name.trim().length < 2) errors.push("Outlet name is missing or too short.");

    const province = PROVINCES.find((item) => item.name.toLowerCase() === provinceRaw.toLowerCase());
    if (!province) {
      errors.push(provinceRaw ? `Unknown province “${provinceRaw}”.` : "Province is required.");
    }

    let district: string | undefined;
    if (province) {
      district = province.districts.find((item) => item.toLowerCase() === districtRaw.toLowerCase());
      if (!district) {
        if (!districtRaw) {
          district = province.districts[0];
          warnings.push(`District is missing. The row uses “${district}” as a placeholder.`);
        } else {
          district = province.districts[0];
          warnings.push(`District “${districtRaw}” is not listed for ${province.name}; the row uses “${district}”.`);
        }
      }
    }

    const category = CATEGORY_LOOKUP.get(categoryRaw.toLowerCase());
    if (!category) {
      errors.push(categoryRaw ? `Unknown outlet category “${categoryRaw}”.` : "Outlet category is required.");
    }

    const normalisedPhone = normalizeLaoPhone(phoneRaw);
    if (!phoneRaw) {
      warnings.push("Phone number is missing. The outlet will be imported as ineligible.");
    } else if (!normalisedPhone) {
      warnings.push(`Phone number “${phoneRaw}” is not a valid Lao mobile number. Insert as ineligible. ${PHONE_HELP}`);
    }

    if (ownerName.trim().length < 2) warnings.push("Owner name is missing or too short.");

    const digits = normalisedPhone ? phoneDigits(normalisedPhone) : "";
    let duplicate: ImportRowResult["duplicate"] = null;
    if (digits.length >= 8 && normalisedPhone) {
      if (dbDuplicates.has(normalisedPhone)) duplicate = "database";
      const previous = seenInFile.get(digits);
      if (duplicate === null && previous !== undefined) duplicate = "file";
      if (previous === undefined) seenInFile.set(digits, lineNumber);
    }
    if (duplicate === "database") warnings.push("This phone number already exists in the outlet database.");
    if (duplicate === "file") warnings.push("This phone number appears more than once in the file.");

    const status = ["Active", "Inactive", "Pending Review"].find(
      (candidate) => candidate.toLowerCase() === statusRaw.toLowerCase(),
    );
    const mappedChannel = OUTLET_CHANNELS.find((candidate) => candidate.toLowerCase() === channelRaw.toLowerCase());

    const values: OutletFormValues | null =
      errors.length > 0
        ? null
        : {
            name,
            ownerName: ownerName.trim().length >= 2 ? ownerName : "Not recorded",
            phone: normalisedPhone ?? phoneRaw,
            province: province!.name,
            district: district ?? province!.districts[0],
            village: get(raw, "village"),
            address: "",
            category: category!,
            status: (status as OutletFormValues["status"]) ?? "Pending Review",
            channel: (channel as OutletFormValues["channel"]) ?? mappedChannel ?? "CSV import",
            whatsappVerified: verifiedRaw === true && normalisedPhone !== null,
            marketingConsent: consentRaw === true,
            notes: notesRaw,
          };

    const status_: ImportRowResult["status"] =
      errors.length > 0 ? "Error" : warnings.length > 0 ? "Warning" : "Importable";

    rows.push({ lineNumber, status: status_, duplicate, errors, warnings, values, raw });
  });

  const errorRows = rows.filter((row) => row.status === "Error").length;
  return {
    rows,
    headerWarning,
    parseError: parsed.rows.length === 0 ? "No data rows were found in the file." : null,
    totalRows: rows.length,
    importableRows: rows.length - errorRows,
    errorRows,
    warningRows: rows.filter((row) => row.status === "Warning").length,
    duplicateRows: rows.filter((row) => row.duplicate !== null).length,
  };
}

/** Persist a preview (no outlets are written) and return the row-level result. */
export async function previewImport(
  values: ImportPreviewValues,
  actorId: string,
  recordAudit: AuditRecorder,
): Promise<{ result: ImportResult; job: ImportJobDocument }> {
  if (!values.content.trim()) throw new BadRequestError("The uploaded file is empty.");
  const result = await parseOutletCsv(values.content, values.channel);

  const job = await ImportJobModel.create({
    fileName: values.fileName,
    channel: values.channel,
    status: result.parseError ? "Failed" : "Ready",
    totalRows: result.totalRows,
    importableRows: result.importableRows,
    errorRows: result.errorRows,
    warningRows: result.warningRows,
    duplicateRows: result.duplicateRows,
    headerWarning: result.headerWarning,
    parseError: result.parseError,
    previewRows: result.rows.slice(0, 200).map((row) => ({
      lineNumber: row.lineNumber,
      status: row.status,
      duplicate: row.duplicate,
      message: [...row.errors, ...row.warnings].join(" "),
      raw: row.raw,
    })),
    createdBy: actorId,
    startedAt: new Date(),
    completedAt: new Date(),
  });

  await recordAudit({
    type: "import",
    message: `Previewed import “${values.fileName}” (${result.totalRows} rows).`,
    actorId,
    targetType: "import",
    targetId: job._id,
    metadata: { totalRows: result.totalRows, errorRows: result.errorRows, duplicateRows: result.duplicateRows },
  });

  return { result, job };
}

export interface CommitOutcome {
  jobId: string;
  imported: number;
  skipped: number;
  invalid: number;
  totalRows: number;
}

const COMMIT_BATCH_SIZE = 500;

/** Commit a previously previewed (or re-uploaded) file. */
export async function commitImport(
  values: ImportCommitValues,
  actorId: string,
  recordAudit: AuditRecorder,
): Promise<CommitOutcome> {
  const result = await parseOutletCsv(values.content, values.channel);
  if (result.parseError) throw new BadRequestError(result.parseError);

  const importable = result.rows.filter((row) => row.status !== "Error" && row.values !== null);
  const invalid = result.rows.length - importable.length;

  const toWrite = importable.filter((row) => {
    if (values.duplicatePolicy === "import") return true;
    return row.duplicate === null;
  });
  const skipped = importable.length - toWrite.length;

  let imported = 0;
  for (let index = 0; index < toWrite.length; index += COMMIT_BATCH_SIZE) {
    const batch = toWrite.slice(index, index + COMMIT_BATCH_SIZE).map((row) => ({
      ...row.values!,
      channel: row.values!.channel ?? values.channel,
      lastUpdatedBy: actorId,
      consentRecordedAt: row.values!.marketingConsent ? new Date() : null,
      consentSource: row.values!.marketingConsent ? "CSV import" : null,
      importJobId: values.jobId ?? null,
    }));
    const created = await OutletModel.insertMany(batch, { ordered: false });
    imported += created.length;
  }

  await refreshDuplicateFlags();

  const job = await ImportJobModel.create({
    fileName: values.fileName,
    channel: values.channel,
    status: "Completed",
    totalRows: result.totalRows,
    importableRows: result.importableRows,
    errorRows: result.errorRows,
    warningRows: result.warningRows,
    duplicateRows: result.duplicateRows,
    importedCount: imported,
    skippedCount: skipped,
    invalidCount: invalid,
    headerWarning: result.headerWarning,
    previewRows: result.rows.slice(0, 200).map((row) => ({
      lineNumber: row.lineNumber,
      status: row.status,
      duplicate: row.duplicate,
      message: [...row.errors, ...row.warnings].join(" "),
      raw: row.raw,
    })),
    createdBy: actorId,
    startedAt: new Date(),
    completedAt: new Date(),
  });

  await recordAudit({
    type: "import",
    message: `Imported “${values.fileName}”: ${imported} created, ${skipped} skipped, ${invalid} invalid.`,
    actorId,
    targetType: "import",
    targetId: job._id,
    metadata: { imported, skipped, invalid, totalRows: result.totalRows },
  });

  return { jobId: String(job._id), imported, skipped, invalid, totalRows: result.totalRows };
}

export async function listImportJobs(query: { status: string; page: number; limit: number }) {
  const filter = query.status === "all" ? {} : { status: query.status };
  const skip = (query.page - 1) * query.limit;
  const [items, total] = await Promise.all([
    ImportJobModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit).lean({ virtuals: true }),
    ImportJobModel.countDocuments(filter),
  ]);
  return { items, total };
}
