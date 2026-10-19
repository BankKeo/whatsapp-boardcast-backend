/**
 * Outlet (retail partner) model.
 *
 * Field names and enum values mirror the dashboard's `types/outlet.ts` so list,
 * detail, import and segment responses drop straight into the existing UI. The
 * consent/eligibility fields called for in docs/starter-project.md §4.2 are all
 * present: `consentSource`, `consentRevokedAt`, `whatsappEligibility`,
 * `dataQualityStatus`, `lastUpdatedBy`.
 *
 * Derived fields (`phoneNormalized`, `phoneStatus`, `whatsappEligibility`,
 * `consentStatus`, `dataQualityStatus`) are recomputed before every save so the
 * API never has to derive them at read time, and so they can be indexed.
 */

import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";
import {
  CONSENT_STATUSES,
  DATA_QUALITY_LEVELS,
  OUTLET_CATEGORIES,
  OUTLET_CHANNELS,
  OUTLET_STATUSES,
  PHONE_STATUSES,
  WHATSAPP_ELIGIBILITY,
  type ConsentStatus,
  type DataQuality,
  type PhoneStatus,
  type WhatsappEligibility,
} from "../../common/constants/domain";
import { getPhoneStatus, normalizeLaoPhone } from "../../common/utils/phone";
import { baseSchemaOptions } from "../../common/utils/mongo";

export interface OutletDerivedInput {
  phone: string;
  whatsappVerified: boolean;
  marketingConsent: boolean;
  consentRevokedAt?: Date | null;
  /** Set by the duplicate-detection service, not by the document itself. */
  duplicatePhone?: boolean;
}

export interface OutletDerived {
  phoneNormalized: string | null;
  phoneStatus: PhoneStatus;
  whatsappEligibility: WhatsappEligibility;
  consentStatus: ConsentStatus;
  dataQualityStatus: DataQuality;
}

/**
 * Single source of truth for the server-side rules in
 * docs/starter-project.md §4.2 and the dashboard's `outlet-service.ts`:
 *  - Eligible            = WhatsApp-verified AND a valid Lao phone number
 *  - Consent status      = Opted out > Opted in > Unknown
 *  - Data quality        = Incomplete (bad phone) / Needs review / Complete
 */
export function deriveOutletFields(input: OutletDerivedInput): OutletDerived {
  const phoneStatus = getPhoneStatus(input.phone);
  const phoneNormalized = normalizeLaoPhone(input.phone);
  const eligible = input.whatsappVerified && phoneStatus === "Valid";

  const whatsappEligibility: WhatsappEligibility = eligible
    ? "Eligible"
    : phoneStatus === "Valid"
      ? "Needs review"
      : "Ineligible";

  const consentStatus: ConsentStatus = input.consentRevokedAt
    ? "Opted out"
    : input.marketingConsent
      ? "Opted in"
      : "Unknown";

  const dataQualityStatus: DataQuality =
    phoneStatus !== "Valid"
      ? "Incomplete"
      : !input.whatsappVerified || !input.marketingConsent || input.duplicatePhone
        ? "Needs review"
        : "Complete";

  return { phoneNormalized, phoneStatus, whatsappEligibility, consentStatus, dataQualityStatus };
}

const outletSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    ownerName: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },

    /** Raw value exactly as captured, kept for auditing. */
    phone: { type: String, trim: true, default: "" },
    /** Canonical `+85620XXXXXXXX`; null when missing or invalid. */
    phoneNormalized: { type: String, default: null, index: true },
    phoneStatus: { type: String, enum: PHONE_STATUSES, default: "Missing", index: true },

    province: { type: String, required: true, trim: true, index: true },
    district: { type: String, required: true, trim: true, index: true },
    village: { type: String, trim: true, default: "" },
    address: { type: String, trim: true, maxlength: 300, default: "" },

    category: { type: String, enum: OUTLET_CATEGORIES, required: true, index: true },

    /** Confirmed on WhatsApp (opt-in verified by the platform). */
    whatsappVerified: { type: Boolean, default: false },
    whatsappEligibility: {
      type: String,
      enum: WHATSAPP_ELIGIBILITY,
      default: "Ineligible",
      index: true,
    },

    /** Marketing consent — never inferred from the presence of a phone number. */
    marketingConsent: { type: Boolean, default: false, index: true },
    consentStatus: { type: String, enum: CONSENT_STATUSES, default: "Unknown", index: true },
    consentRecordedAt: { type: Date, default: null },
    consentSource: { type: String, trim: true, maxlength: 160, default: null },
    consentEvidenceRef: { type: String, trim: true, default: null },
    consentRevokedAt: { type: Date, default: null },

    status: { type: String, enum: OUTLET_STATUSES, default: "Pending Review", index: true },
    channel: { type: String, enum: OUTLET_CHANNELS, default: "Field team", index: true },
    notes: { type: String, trim: true, maxlength: 400, default: "" },

    dataQualityStatus: {
      type: String,
      enum: DATA_QUALITY_LEVELS,
      default: "Incomplete",
      index: true,
    },
    /** True when another outlet shares this normalised number. */
    duplicatePhone: { type: Boolean, default: false, index: true },

    lastUpdatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    importJobId: { type: Schema.Types.ObjectId, ref: "ImportJob", default: null },
  },
  baseSchemaOptions,
);

/* Derived fields are recomputed on every full-document save. */
outletSchema.pre("validate", function (next) {
  const document = this as unknown as OutletDocument;
  const derived = deriveOutletFields({
    phone: document.phone,
    whatsappVerified: document.whatsappVerified,
    marketingConsent: document.marketingConsent,
    consentRevokedAt: document.consentRevokedAt,
    duplicatePhone: document.duplicatePhone,
  });
  document.phoneNormalized = derived.phoneNormalized;
  document.phoneStatus = derived.phoneStatus;
  document.whatsappEligibility = derived.whatsappEligibility;
  document.consentStatus = derived.consentStatus;
  document.dataQualityStatus = derived.dataQualityStatus;
  next();
});

/* Free-text search across the fields the outlet search box queries. */
outletSchema.index({ name: "text", ownerName: "text" });
/* Filter combinations used by the outlet table and the segment builder. */
outletSchema.index({ province: 1, category: 1 });
outletSchema.index({ province: 1, district: 1 });
outletSchema.index({ marketingConsent: 1, whatsappEligibility: 1 });
outletSchema.index({ status: 1, dataQualityStatus: 1 });
/*
 * NOTE: `phoneNormalized` is indexed but NOT unique. The dashboard treats a
 * shared number as a data-quality problem (`duplicatePhone`, surfaced on import
 * and in the "Needs review" bucket), not as a hard error, so we must not block
 * legitimate duplicates. See docs/schema-design.md §"Duplicate handling".
 */

export type Outlet = InferSchemaType<typeof outletSchema>;
export type OutletDocument = HydratedDocument<Outlet>;

export const OutletModel = model("Outlet", outletSchema);
