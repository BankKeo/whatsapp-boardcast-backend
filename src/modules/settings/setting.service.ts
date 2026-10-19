/**
 * Application settings service.
 *
 * A key/value store with per-section Zod validation (docs/starter-project.md
 * §5.7). Unknown keys are rejected and values are never trusted from the client.
 */

import { SETTING_KEYS, ApplicationSettingModel, type SettingKey } from "./applicationSetting.model";
import { defaultSections, sectionSchemas } from "./setting.schema";
import { ValidationError } from "../../common/errors/AppError";
import { getProviderHealth } from "../whatsapp/whatsapp.service";
import type { AuditInput } from "../audit-logs/auditLog.service";

export type AuditRecorder = (input: AuditInput) => Promise<void>;

export interface SettingSectionView {
  key: SettingKey;
  value: unknown;
  isDefault: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export async function getSettings(): Promise<Record<string, SettingSectionView>> {
  const docs = await ApplicationSettingModel.find();
  const byKey = new Map(docs.map((doc) => [doc.key as SettingKey, doc]));
  const defaults = defaultSections();

  const sections: Record<string, SettingSectionView> = {};
  for (const key of SETTING_KEYS) {
    const doc = byKey.get(key);
    sections[key] = {
      key,
      value: doc?.value ?? defaults[key],
      isDefault: !doc,
      updatedAt: doc?.updatedAt ?? null,
      updatedBy: doc?.updatedBy ? String(doc.updatedBy) : null,
    };
  }
  return sections;
}

function mergeSection(current: unknown, incoming: unknown): unknown {
  if (
    current &&
    incoming &&
    typeof current === "object" &&
    typeof incoming === "object" &&
    !Array.isArray(current) &&
    !Array.isArray(incoming)
  ) {
    return { ...(current as object), ...(incoming as object) };
  }
  return incoming;
}

export async function updateSetting(
  key: SettingKey,
  value: unknown,
  actorId: string,
  recordAudit: AuditRecorder,
): Promise<SettingSectionView> {
  const schema = sectionSchemas[key];
  const existing = await ApplicationSettingModel.findOne({ key });
  const defaults = defaultSections()[key];
  const merged = mergeSection(existing?.value ?? defaults, value);

  const parsed = schema.safeParse(merged);
  if (!parsed.success) {
    throw new ValidationError(`The ${key} settings are invalid.`, parsed.error.issues.map((issue) => ({
      path: `${key}.${issue.path.map(String).join(".")}`,
      message: issue.message,
    })));
  }

  const doc = await ApplicationSettingModel.findOneAndUpdate(
    { key },
    { $set: { value: parsed.data, updatedBy: actorId } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  await recordAudit({
    type: "settings",
    message: `Updated ${key} settings.`,
    actorId,
    targetType: "settings",
    targetId: doc._id,
    metadata: { key },
  });

  return {
    key,
    value: doc.value,
    isDefault: false,
    updatedAt: doc.updatedAt ?? null,
    updatedBy: doc.updatedBy ? String(doc.updatedBy) : null,
  };
}

/** Current integration status shown on the Settings screen (never faked). */
export async function integrationStatus() {
  return {
    whatsapp: await getProviderHealth(),
  };
}
