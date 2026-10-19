import type { Request, Response } from "express";
import { paginationMeta, sendCreated, sendNoContent, sendSuccess } from "../../common/http/respond";
import { recordAudit } from "../audit-logs/auditLog.service";
import * as templateService from "./template.service";
import type { TemplateFormValues } from "./template.schema";
import type { TemplateStatus } from "../../common/constants/domain";

export async function list(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as templateService.ListTemplatesQuery;
  const { items, total } = await templateService.listTemplates(query);
  sendSuccess(res, items, paginationMeta(query.page, query.limit, total));
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const doc = await templateService.getTemplate(req.params.id);
  sendSuccess(res, templateService.toTemplateView(doc));
}

export async function create(req: Request, res: Response): Promise<void> {
  const values = req.validated?.body as TemplateFormValues;
  const doc = await templateService.createTemplate(values, req.auth!.userId, recordAudit);
  sendCreated(res, templateService.toTemplateView(doc));
}

export async function update(req: Request, res: Response): Promise<void> {
  const values = req.validated?.body as Partial<TemplateFormValues>;
  const doc = await templateService.updateTemplate(req.params.id, values, req.auth!.userId, recordAudit);
  sendSuccess(res, templateService.toTemplateView(doc));
}

export async function remove(req: Request, res: Response): Promise<void> {
  await templateService.deleteTemplate(req.params.id, req.auth!.userId, recordAudit);
  sendNoContent(res);
}

export async function submitForApproval(req: Request, res: Response): Promise<void> {
  const doc = await templateService.submitForApproval(req.params.id, req.auth!.userId, recordAudit);
  sendSuccess(res, templateService.toTemplateView(doc));
}

export async function refreshStatus(req: Request, res: Response): Promise<void> {
  const doc = await templateService.refreshStatus(req.params.id, req.auth!.userId, recordAudit);
  const simulated = doc.externalApprovalId?.startsWith("local-") ?? false;
  sendSuccess(res, { ...templateService.toTemplateView(doc), simulated }, { simulated });
}

export type { TemplateStatus };
