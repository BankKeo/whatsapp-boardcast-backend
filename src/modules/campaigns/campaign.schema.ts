/**
 * Zod schemas for campaign creation, transitions and queries.
 * Mirrors `whatsapp-boardcast-dashboard/lib/schemas/campaign.ts`.
 */

import { z } from "zod";
import {
  CAMPAIGN_LANGUAGES,
  CAMPAIGN_OBJECTIVES,
  CAMPAIGN_RECIPIENT_STATUSES,
  CAMPAIGN_STATUSES,
} from "../../common/constants/domain";
import { outletFiltersSchema } from "../outlets/outlet.schema";
import { nullableDate, optionalNullableDate } from "../../common/validators/date";

export const campaignDetailsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "Campaign name must be at least 3 characters.")
    .max(120, "Campaign name must be 120 characters or fewer."),
  objective: z.enum(CAMPAIGN_OBJECTIVES, "Select a campaign objective."),
  description: z
    .string()
    .trim()
    .max(500, "Internal description must be 500 characters or fewer.")
    .default(""),
  owner: z.string().trim().min(2, "Select a campaign owner.").max(120),
});

export const campaignAudienceSchema = z
  .object({
    segmentId: z
      .string()
      .regex(/^[a-f\d]{24}$/i, "Invalid segment id.")
      .nullable()
      .default(null),
    segmentName: z.string().nullable().default(null),
    filters: outletFiltersSchema,
  })
  .refine(
    (value) =>
      value.filters.provinces.length > 0 ||
      value.filters.districts.length > 0 ||
      value.filters.categories.length > 0 ||
      value.filters.eligibility !== "any" ||
      value.filters.consent !== "any",
    {
      message: "Narrow the audience with at least one province, category or eligibility rule.",
      path: ["filters"],
    },
  );

export const campaignMessageSchema = z.object({
  templateId: z.string().regex(/^[a-f\d]{24}$/i, "Select a message template."),
  language: z.enum(CAMPAIGN_LANGUAGES),
  message: z
    .string()
    .trim()
    .min(20, "Message body must be at least 20 characters.")
    .max(1024, "WhatsApp template bodies are limited to 1,024 characters."),
  promotionPeriod: z.string().trim().max(120).optional(),
});

export const campaignScheduleSchema = z.object({
  scheduledAt: nullableDate,
  language: z.enum(CAMPAIGN_LANGUAGES),
});

/** Wizard payload: details + audience + message + optional schedule. */
export const campaignCreateSchema = z.object({
  details: campaignDetailsSchema,
  audience: campaignAudienceSchema,
  message: campaignMessageSchema,
  scheduledAt: nullableDate,
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

export type CampaignCreateValues = z.infer<typeof campaignCreateSchema>;

export const campaignUpdateSchema = z.object({
  details: campaignDetailsSchema.partial().optional(),
  audience: campaignAudienceSchema.optional(),
  message: campaignMessageSchema.partial().optional(),
  scheduledAt: optionalNullableDate,
});

/** State-transition requests that carry no body beyond an optional reason. */
export const campaignTransitionSchema = z.object({
  reason: z.string().trim().max(400).optional(),
});

export const campaignListQuerySchema = z.object({
  search: z.string().trim().default(""),
  status: z.union([z.enum(CAMPAIGN_STATUSES), z.literal("all")]).default("all"),
  province: z.union([z.string(), z.literal("all")]).default("all"),
  category: z.union([z.string(), z.literal("all")]).default("all"),
  owner: z.union([z.string(), z.literal("all")]).default("all"),
  /** Inclusive createdAt bounds, `YYYY-MM-DD`. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(["createdAt", "scheduledAt", "sentAt", "name", "status"]).default("createdAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});

export const campaignRecipientQuerySchema = z.object({
  status: z.union([z.enum(CAMPAIGN_RECIPIENT_STATUSES), z.literal("all")]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
