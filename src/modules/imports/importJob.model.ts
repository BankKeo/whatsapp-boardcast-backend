/**
 * Import job model.
 *
 * Records every CSV import and its per-bucket counts, matching the dashboard's
 * `CsvImportResult` (total / importable / error / warning / duplicate rows) and
 * the preview→commit flow described in docs/starter-project.md §5.2. But at a
 * glance the whole job is auditable without re-parsing the file.
 *
 * Full row-level results can run into hundreds of thousands of rows, so only a
 * bounded `previewRows` sample is embedded here; a dedicated
 * `ImportJobRow` collection (or the error report file) holds the rest.
 */

import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";
import {
  IMPORT_JOB_STATUSES,
  OUTLET_CHANNELS,
} from "../../common/constants/domain";
import { baseSchemaOptions } from "../../common/utils/mongo";

const importPreviewRowSchema = new Schema(
  {
    lineNumber: { type: Number, required: true },
    status: { type: String, enum: ["Importable", "Warning", "Error"], required: true },
    duplicate: { type: String, enum: ["file", "database", null], default: null },
    message: { type: String, default: "" },
    raw: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const importJobSchema = new Schema(
  {
    fileName: { type: String, required: true, trim: true, maxlength: 300 },
    /** `channel` written onto the created outlets. */
    channel: { type: String, enum: OUTLET_CHANNELS, default: "CSV import" },
    status: { type: String, enum: IMPORT_JOB_STATUSES, default: "Pending", index: true },

    totalRows: { type: Number, default: 0, min: 0 },
    importableRows: { type: Number, default: 0, min: 0 },
    errorRows: { type: Number, default: 0, min: 0 },
    warningRows: { type: Number, default: 0, min: 0 },
    duplicateRows: { type: Number, default: 0, min: 0 },

    importedCount: { type: Number, default: 0, min: 0 },
    skippedCount: { type: Number, default: 0, min: 0 },
    invalidCount: { type: Number, default: 0, min: 0 },

    headerWarning: { type: String, default: null },
    parseError: { type: String, default: null },
    error: { type: String, default: null },

    /** Bounded sample of row results for the preview table. */
    previewRows: { type: [importPreviewRowSchema], default: [] },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);

importJobSchema.index({ createdAt: -1 });

export type ImportJob = InferSchemaType<typeof importJobSchema>;
export type ImportJobDocument = HydratedDocument<ImportJob>;

export const ImportJobModel = model("ImportJob", importJobSchema);
