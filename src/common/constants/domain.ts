/**
 * Shared domain constants for the Partner Club WhatsApp Marketing System.
 *
 * The stored values deliberately match the contracts already used by the
 * dashboard (whatsapp-boardcast-dashboard/types/*) so API responses can be
 * consumed by the existing UI without a translation layer, while still
 * satisfying the richer consent/eligibility model described in
 * docs/starter-project.md.
 *
 * Every list is exported `as const` so the TypeScript union type and the
 * Mongoose `enum` / Zod `z.enum` all come from one source of truth.
 */

/* -------------------------------- Users -------------------------------- */

export const USER_ROLES = [
  "Administrator",
  "Marketing Manager",
  "Campaign Creator",
  "Read-Only Analyst",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ["Active", "Invited", "Deactivated"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/* ------------------------------- Outlets ------------------------------- */

export const OUTLET_CATEGORIES = [
  "On-Trade",
  "Off-Trade",
  "Modern Trade",
] as const;
export type OutletCategory = (typeof OUTLET_CATEGORIES)[number];

export const OUTLET_STATUSES = ["Active", "Inactive", "Pending Review"] as const;
export type OutletStatus = (typeof OUTLET_STATUSES)[number];

/** Where a record came from (`source` in docs/starter-project.md). */
export const OUTLET_CHANNELS = [
  "Field team",
  "CSV import",
  "Distributor list",
  "Partner referral",
] as const;
export type OutletChannel = (typeof OUTLET_CHANNELS)[number];

/** Phone usability, derived from the stored number. */
export const PHONE_STATUSES = ["Valid", "Invalid", "Missing"] as const;
export type PhoneStatus = (typeof PHONE_STATUSES)[number];

/**
 * WhatsApp eligibility. `Eligible` mirrors the dashboard's `isEligible()`
 * (verified AND valid phone). `Needs review` covers a valid number that has not
 * been verified yet, and `Ineligible` covers an unusable number.
 */
export const WHATSAPP_ELIGIBILITY = [
  "Eligible",
  "Ineligible",
  "Needs review",
] as const;
export type WhatsappEligibility = (typeof WHATSAPP_ELIGIBILITY)[number];

/** Data quality buckets — matches `getDataQuality()` in the dashboard. */
export const DATA_QUALITY_LEVELS = [
  "Complete",
  "Needs review",
  "Incomplete",
] as const;
export type DataQuality = (typeof DATA_QUALITY_LEVELS)[number];

/** Marketing consent state, kept alongside the dashboard's boolean flag. */
export const CONSENT_STATUSES = ["Unknown", "Opted in", "Opted out"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

/* ------------------------------- Segments ------------------------------ */

/** Filter operators accepted by the whitelisted audience query builder. */
export const ELIGIBILITY_FILTERS = ["any", "eligible", "ineligible"] as const;
export type EligibilityFilter = (typeof ELIGIBILITY_FILTERS)[number];

export const CONSENT_FILTERS = ["any", "consented", "not-consented"] as const;
export type ConsentFilter = (typeof CONSENT_FILTERS)[number];

export const PHONE_STATUS_FILTERS = [
  "any",
  "Valid",
  "Invalid",
  "Missing",
] as const;
export type PhoneStatusFilter = (typeof PHONE_STATUS_FILTERS)[number];

export const DATA_QUALITY_FILTERS = [
  "any",
  "Complete",
  "Needs review",
  "Incomplete",
] as const;
export type DataQualityFilter = (typeof DATA_QUALITY_FILTERS)[number];

/* ------------------------------ Campaigns ------------------------------ */

export const CAMPAIGN_STATUSES = [
  "Draft",
  "Pending Approval",
  "Scheduled",
  "Sending",
  "Completed",
  "Cancelled",
  "Failed",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_OBJECTIVES = [
  "Seasonal promotion",
  "New product announcement",
  "Partner Club update",
  "Promotional reminder",
  "Outlet re-engagement",
] as const;
export type CampaignObjective = (typeof CAMPAIGN_OBJECTIVES)[number];

export const CAMPAIGN_LANGUAGES = ["en", "lo"] as const;
export type CampaignLanguage = (typeof CAMPAIGN_LANGUAGES)[number];

/** Per-recipient delivery lifecycle, feeding `Campaign.metrics`. */
export const CAMPAIGN_RECIPIENT_STATUSES = [
  "Queued",
  "Attempted",
  "Sent",
  "Delivered",
  "Read",
  "Failed",
] as const;
export type CampaignRecipientStatus =
  (typeof CAMPAIGN_RECIPIENT_STATUSES)[number];

/* ------------------------------ Templates ------------------------------ */

export const TEMPLATE_CATEGORIES = [
  "Seasonal Promotion",
  "New Product Announcement",
  "Partner Club Update",
  "Promotional Reminder",
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const TEMPLATE_STATUSES = [
  "Approved",
  "Pending Approval",
  "Rejected",
  "Draft",
] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export const TEMPLATE_LANGUAGES = CAMPAIGN_LANGUAGES;

/** Positional variables available to campaign message composition. */
export const TEMPLATE_VARIABLE_LIBRARY = [
  { key: "{{1}}", label: "Outlet name", example: "Sok Dee Minimart" },
  { key: "{{2}}", label: "Owner name", example: "Khamla S." },
  { key: "{{3}}", label: "Province", example: "Vientiane Capital" },
  { key: "{{4}}", label: "Promotion period", example: "1–15 Nov 2026" },
  { key: "{{5}}", label: "Campaign reference", example: "PC-2026-0184" },
  { key: "{{6}}", label: "Contact number", example: "+856 20 5555 1188" },
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLE_LIBRARY)[number];

/* ------------------------- Imports / audit / settings ------------------ */

export const IMPORT_JOB_STATUSES = [
  "Pending",
  "Validating",
  "Ready",
  "Importing",
  "Completed",
  "Failed",
  "Cancelled",
] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

/** Activity feed / audit log categories — mirrors dashboard `ActivityType`. */
export const ACTIVITY_TYPES = [
  "campaign",
  "outlet",
  "segment",
  "template",
  "team",
  "integration",
  "auth",
  "settings",
  "import",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const REFRESH_TOKEN_STATUSES = ["Active", "Revoked", "Expired"] as const;
export type RefreshTokenStatus = (typeof REFRESH_TOKEN_STATUSES)[number];

/** Roles allowed to approve and dispatch campaigns. */
export const APPROVER_ROLES: readonly UserRole[] = [
  "Administrator",
  "Marketing Manager",
];
