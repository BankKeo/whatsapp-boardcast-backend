import type { Request, Response } from "express";
import { sendSuccess } from "../../common/http/respond";
import { recordAudit } from "../audit-logs/auditLog.service";
import * as settingService from "./setting.service";
import { SETTING_KEYS } from "./applicationSetting.model";
import type { SettingKey } from "./applicationSetting.model";
import { ValidationError } from "../../common/errors/AppError";

export async function list(_req: Request, res: Response): Promise<void> {
  const [sections, integrations] = await Promise.all([
    settingService.getSettings(),
    settingService.integrationStatus(),
  ]);
  sendSuccess(res, { sections, integrations, keys: SETTING_KEYS });
}

export async function update(req: Request, res: Response): Promise<void> {
  const { key, value } = req.validated?.body as { key: SettingKey; value: unknown };
  if (!SETTING_KEYS.includes(key)) throw new ValidationError(`Unknown settings key “${key}”.`);
  const section = await settingService.updateSetting(key, value, req.auth!.userId, recordAudit);
  sendSuccess(res, section);
}
