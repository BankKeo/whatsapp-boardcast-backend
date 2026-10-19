/**
 * Province / district reference model.
 *
 * docs/starter-project.md §4.2 asks for editable province and district data so
 * Settings can add values without a deploy. Districts are embedded because they
 * are always read together with their province and the list is small.
 */

import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";
import { REGIONS } from "../../common/constants/laos";
import { baseSchemaOptions } from "../../common/utils/mongo";

const provinceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    /** North | Central | South */
    region: { type: String, enum: REGIONS, required: true },
    districts: { type: [String], default: [] },
    active: { type: Boolean, default: true },
  },
  baseSchemaOptions,
);

provinceSchema.index({ region: 1, name: 1 });

export type Province = InferSchemaType<typeof provinceSchema>;
export type ProvinceDocument = HydratedDocument<Province>;

export const ProvinceModel = model("Province", provinceSchema);
