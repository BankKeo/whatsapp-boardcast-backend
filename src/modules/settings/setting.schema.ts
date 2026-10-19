/**
 * Settings schemas.
 *
 * Each section has its own Zod schema and a default, so a new section can ship
 * without a database migration while values stay validated server-side
 * (docs/starter-project.md §5.7, §9).
 */

import { z } from "zod";
import { SETTING_KEYS, type SettingKey } from "./applicationSetting.model";

export const sectionSchemas = {
  "company.profile": z.object({
    legalName: z.string().trim().min(2).max(160).default("Lao Brewery Co., Ltd."),
    group: z.string().trim().max(120).default("Carlsberg Group"),
    programme: z.string().trim().max(120).default("Partner Club"),
    country: z.string().trim().max(80).default("Laos"),
    dialCode: z.string().trim().regex(/^\+\d{1,4}$/).default("+856"),
  }),
  "whatsapp.connection": z.object({
    businessAccountId: z.string().trim().nullable().default(null),
    phoneNumberId: z.string().trim().nullable().default(null),
    displayName: z.string().trim().nullable().default(null),
    sendWindowStart: z.string().regex(/^\d{2}:\d{2}$/).default("08:00"),
    sendWindowEnd: z.string().regex(/^\d{2}:\d{2}$/).default("20:00"),
  }),
  "outlet.database": z.object({
    duplicatePolicy: z.enum(["flag", "block"]).default("flag"),
    defaultChannel: z.string().trim().max(60).default("Field team"),
    defaultStatus: z.string().trim().max(60).default("Pending Review"),
  }),
  "provinces.categories": z.object({
    provinces: z.array(z.string().trim().min(1)).default([]),
    categories: z.array(z.string().trim().min(1)).default([]),
  }),
  "user.permissions": z.object({
    approverRoles: z.array(z.string().trim()).default(["Administrator", "Marketing Manager"]),
    exportRoles: z.array(z.string().trim()).default(["Administrator", "Marketing Manager"]),
  }),
  "approval.workflow": z.object({
    requireApproval: z.boolean().default(true),
    approverRoles: z.array(z.string().trim()).default(["Administrator", "Marketing Manager"]),
  }),
  "messaging.limits": z.object({
    dailyCapPerContact: z.number().int().min(1).max(50).default(4),
    maxRecipientsPerCampaign: z.number().int().min(1).max(1_000_000).default(100_000),
  }),
  "contact.consent": z.object({
    requireExplicitConsent: z.boolean().default(true),
    allowImportWithoutConsent: z.boolean().default(true),
    consentSourceRequired: z.boolean().default(true),
  }),
  "reporting.pricing": z.object({
    configured: z.boolean().default(false),
    currency: z.string().trim().length(3).default("USD"),
    costPerMessage: z.number().nonnegative().default(0),
  }),
} satisfies Record<SettingKey, z.ZodTypeAny>;

export type SectionSchemas = typeof sectionSchemas;
export type SectionValues<K extends SettingKey> = z.infer<SectionSchemas[K]>;

/** Default values derived from each section schema. */
export function defaultSections(): Record<SettingKey, unknown> {
  const result = {} as Record<SettingKey, unknown>;
  for (const key of SETTING_KEYS) {
    result[key] = sectionSchemas[key].parse({});
  }
  return result;
}

export const updateSettingSchema = z.object({
  key: z.enum(SETTING_KEYS),
  /** Validated against the section schema for `key` in the service layer. */
  value: z.unknown(),
});

export type UpdateSettingValues = z.infer<typeof updateSettingSchema>;
