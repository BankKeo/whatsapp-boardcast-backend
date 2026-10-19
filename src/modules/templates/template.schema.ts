/**
 * Zod schemas for message templates.
 * Mirrors `whatsapp-boardcast-dashboard/lib/schemas/template.ts`.
 */

import { z } from "zod";
import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_LANGUAGES,
  TEMPLATE_STATUSES,
} from "../../common/constants/domain";

export const templateFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "Template name must be at least 3 characters.")
    .max(80, "Template name must be 80 characters or fewer."),
  category: z.enum(TEMPLATE_CATEGORIES, "Select a template category."),
  language: z.enum(TEMPLATE_LANGUAGES, "Select a language."),
  body: z
    .string()
    .trim()
    .min(20, "Template body must be at least 20 characters.")
    .max(1024, "WhatsApp template bodies are limited to 1,024 characters."),
  notes: z.string().trim().max(300, "Notes must be 300 characters or fewer.").default(""),
});

export type TemplateFormValues = z.infer<typeof templateFormSchema>;

export const templateUpdateSchema = templateFormSchema.partial();

export const templateListQuerySchema = z.object({
  search: z.string().trim().default(""),
  status: z.union([z.enum(TEMPLATE_STATUSES), z.literal("all")]).default("all"),
  language: z.union([z.enum(TEMPLATE_LANGUAGES), z.literal("all")]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** Extract positional variables in ascending order, e.g. `["{{1}}","{{2}}"]`. */
export function extractVariables(body: string): string[] {
  const matches = body.match(/\{\{\d+\}\}/g);
  return matches ? Array.from(new Set(matches)).sort() : [];
}
