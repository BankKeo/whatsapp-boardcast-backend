/**
 * Zod schemas for outlet requests.
 *
 * Mirrors `whatsapp-boardcast-dashboard/lib/schemas/outlet.ts` (same validation
 * messages and rules) so the server accepts exactly what the client form
 * produces, and extends it with the consent metadata and list query the backend
 * needs. Ported phone logic lives in `src/common/utils/phone.ts`.
 */

import { z } from "zod";
import {
  DATA_QUALITY_FILTERS,
  ELIGIBILITY_FILTERS,
  CONSENT_FILTERS,
  OUTLET_CATEGORIES,
  OUTLET_CHANNELS,
  OUTLET_STATUSES,
  PHONE_STATUS_FILTERS,
} from "../../common/constants/domain";
import { PROVINCE_NAMES, districtsFor } from "../../common/constants/laos";
import { normalizeLaoPhone } from "../../common/utils/phone";

export const PHONE_HELP =
  "Lao mobile number in international format, for example +856 20 5555 1188.";

const objectId = z
  .string()
  .regex(/^[a-f\d]{24}$/i, "A valid identifier is required.");

export const outletFormBase = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Outlet name must be at least 2 characters.")
    .max(120, "Outlet name must be 120 characters or fewer."),
  ownerName: z
    .string()
    .trim()
    .min(2, "Owner name must be at least 2 characters.")
    .max(120, "Owner name must be 120 characters or fewer."),
  phone: z
    .string()
    .trim()
    .min(1, "Phone number is required.")
    .refine((value) => normalizeLaoPhone(value) !== null, {
      message: `Enter a valid ${PHONE_HELP}`,
    }),
  province: z.enum(PROVINCE_NAMES, "Select a province."),
  district: z.string().trim().min(1, "Select a district."),
  village: z.string().trim().max(80, "Village must be 80 characters or fewer."),
  address: z.string().trim().max(300, "Address must be 300 characters or fewer.").default(""),
  category: z.enum(OUTLET_CATEGORIES, "Select an outlet category."),
  status: z.enum(OUTLET_STATUSES, "Select a status."),
  channel: z.enum(OUTLET_CHANNELS, "Select how the record was sourced."),
  whatsappVerified: z.boolean(),
  marketingConsent: z.boolean(),
  /** Required when consent is recorded so withdrawal can be audited. */
  consentSource: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(400, "Notes must be 400 characters or fewer."),
});

export const outletFormSchema = outletFormBase
  .refine((value) => districtsFor(value.province).includes(value.district), {
    message: "Choose a district that belongs to the selected province.",
    path: ["district"],
  })
  .refine((value) => !value.whatsappVerified || normalizeLaoPhone(value.phone) !== null, {
    message: "A contact cannot be verified on WhatsApp without a valid phone number.",
    path: ["whatsappVerified"],
  });

export type OutletFormValues = z.infer<typeof outletFormSchema>;

/**
 * PATCH body: every field optional. Cross-field rules (district belongs to the
 * province, verified requires a usable number) are re-checked by the service on
 * the merged record, so a partial update can never bypass them.
 */
export const outletUpdateSchema = outletFormBase.partial();

export const outletFiltersSchema = z.object({
  search: z.string().trim().max(120).default(""),
  provinces: z.array(z.enum(PROVINCE_NAMES)).default([]),
  districts: z.array(z.string().trim()).default([]),
  categories: z.array(z.enum(OUTLET_CATEGORIES)).default([]),
  eligibility: z.enum(ELIGIBILITY_FILTERS).default("any"),
  consent: z.enum(CONSENT_FILTERS).default("any"),
  phoneStatus: z.enum(PHONE_STATUS_FILTERS).default("any"),
  dataQuality: z.enum(DATA_QUALITY_FILTERS).default("any"),
});

export type OutletFilters = z.infer<typeof outletFiltersSchema>;

export const OUTLET_SORT_KEYS = [
  "name",
  "ownerName",
  "phone",
  "province",
  "district",
  "category",
  "eligibility",
  "lastUpdated",
] as const;

/**
 * Accept both a repeated query key (`?provinces=A&provinces=B`, which qs parses
 * as an array) and a single value (`?provinces=A`) for the multi-select filters
 * used by the outlet table and the segment builder.
 */
function asArray(value: unknown): unknown {
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

const provinceArray = z.preprocess(asArray, z.array(z.enum(PROVINCE_NAMES)).default([]));
const districtArray = z.preprocess(asArray, z.array(z.string().trim()).default([]));
const categoryArray = z.preprocess(asArray, z.array(z.enum(OUTLET_CATEGORIES)).default([]));

/**
 * Outlet listing query.
 *
 * Singular filter names (`province`, `category`, …) match the documented API
 * example in docs/starter-project.md §5.2; the plural array form is used
 * internally by saved segments.
 */
export const outletListQuerySchema = z.object({
  search: z.string().trim().max(120).default(""),
  province: z.enum(PROVINCE_NAMES).optional(),
  provinces: provinceArray,
  district: z.string().trim().max(120).optional(),
  districts: districtArray,
  category: z.enum(OUTLET_CATEGORIES).optional(),
  categories: categoryArray,
  eligibility: z.enum(ELIGIBILITY_FILTERS).default("any"),
  consent: z.enum(CONSENT_FILTERS).default("any"),
  phoneStatus: z.enum(PHONE_STATUS_FILTERS).default("any"),
  dataQuality: z.enum(DATA_QUALITY_FILTERS).default("any"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(OUTLET_SORT_KEYS).default("name"),
  direction: z.enum(["asc", "desc"]).default("asc"),
});

export type OutletListQuery = z.infer<typeof outletListQuerySchema>;

export interface OutletFilterInput {
  search: string;
  provinces: string[];
  districts: string[];
  categories: string[];
  eligibility: "any" | "eligible" | "ineligible";
  consent: "any" | "consented" | "not-consented";
  phoneStatus: "any" | "Valid" | "Invalid" | "Missing";
  dataQuality: "any" | "Complete" | "Needs review" | "Incomplete";
}

/** Convert a listing query into the array-shaped filter the query builder uses. */
export function toOutletFilterInput(query: OutletListQuery): OutletFilterInput {
  return {
    search: query.search,
    provinces: query.provinces.length > 0 ? query.provinces : query.province ? [query.province] : [],
    districts: query.districts.length > 0 ? query.districts : query.district ? [query.district] : [],
    categories: query.categories.length > 0 ? query.categories : query.category ? [query.category] : [],
    eligibility: query.eligibility,
    consent: query.consent,
    phoneStatus: query.phoneStatus,
    dataQuality: query.dataQuality,
  };
}

export const outletIdParamSchema = z.object({ id: objectId });

export const bulkOutletSchema = z.object({
  outlets: z.array(outletFormSchema).min(1).max(500),
});
