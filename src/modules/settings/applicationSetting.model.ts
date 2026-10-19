/**
 * Application settings — key/value document store.
 *
 * Backs the Settings screen sections (company profile, WhatsApp connection,
 * approval workflow, messaging limits, contact consent). A key/value shape lets
 * new sections ship without a schema migration, while `value` stays `Mixed`
 * because each section has its own Zod schema (validated in the service layer,
 * never trusted from the client).
 */

import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";
import { baseSchemaOptions } from "../../common/utils/mongo";

export const SETTING_KEYS = [
  "company.profile",
  "whatsapp.connection",
  "outlet.database",
  "provinces.categories",
  "user.permissions",
  "approval.workflow",
  "messaging.limits",
  "contact.consent",
  "reporting.pricing",
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

const applicationSettingSchema = new Schema(
  {
    key: { type: String, enum: SETTING_KEYS, required: true, unique: true },
    value: { type: Schema.Types.Mixed, default: null },
    description: { type: String, default: "" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  baseSchemaOptions,
);

export type ApplicationSetting = InferSchemaType<typeof applicationSettingSchema>;
export type ApplicationSettingDocument = HydratedDocument<ApplicationSetting>;

export const ApplicationSettingModel = model("ApplicationSetting", applicationSettingSchema);
