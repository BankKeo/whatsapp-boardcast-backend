/**
 * Audience segment model.
 *
 * Stores a structured, whitelisted filter definition (never a raw Mongo query),
 * matching `whatsapp-boardcast-dashboard/types/segment.ts`. The outlets service
 * translates `filters` into a safe query at read time.
 */

import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";
import {
  CONSENT_FILTERS,
  DATA_QUALITY_FILTERS,
  ELIGIBILITY_FILTERS,
  OUTLET_CATEGORIES,
  PHONE_STATUS_FILTERS,
} from "../../common/constants/domain";
import { baseSchemaOptions } from "../../common/utils/mongo";

/** Embedded filter document — mirrors the dashboard's `OutletFilters`. */
export const segmentFiltersSchema = new Schema(
  {
    search: { type: String, trim: true, maxlength: 120, default: "" },
    provinces: { type: [String], default: [] },
    districts: { type: [String], default: [] },
    categories: { type: [String], enum: OUTLET_CATEGORIES, default: [] },
    eligibility: { type: String, enum: ELIGIBILITY_FILTERS, default: "any" },
    consent: { type: String, enum: CONSENT_FILTERS, default: "any" },
    phoneStatus: { type: String, enum: PHONE_STATUS_FILTERS, default: "any" },
    dataQuality: { type: String, enum: DATA_QUALITY_FILTERS, default: "any" },
  },
  { _id: false },
);

const segmentSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 3, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 300, default: "" },
    filters: { type: segmentFiltersSchema, required: true, default: () => ({}) },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    /** Last computed match count, refreshed on save and on demand. */
    lastMatchCount: { type: Number, default: 0, min: 0 },
    lastPreviewedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);

segmentSchema.index({ name: "text", description: "text" });
/* Indexed separately — a compound index over two array fields is invalid in MongoDB. */
segmentSchema.index({ "filters.provinces": 1 });
segmentSchema.index({ "filters.categories": 1 });

export type Segment = InferSchemaType<typeof segmentSchema>;
export type SegmentDocument = HydratedDocument<Segment>;

export const SegmentModel = model("Segment", segmentSchema);
