import type { Request, Response } from "express";
import { paginationMeta, sendCreated, sendSuccess } from "../../common/http/respond";
import { recordAudit } from "../audit-logs/auditLog.service";
import * as campaignService from "./campaign.service";
import type {
  CampaignCreateValues,
  CampaignListQuery,
  CampaignRecipientQuery,
} from "./campaign.service";

export async function list(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as CampaignListQuery;
  const { items, total } = await campaignService.listCampaigns(query);
  sendSuccess(res, items, paginationMeta(query.page, query.limit, total));
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const doc = await campaignService.getCampaign(req.params.id);
  sendSuccess(res, campaignService.toCampaignView(doc));
}

export async function create(req: Request, res: Response): Promise<void> {
  const values = req.validated?.body as CampaignCreateValues;
  const { campaign, created } = await campaignService.createCampaign(values, req.auth!.userId, recordAudit);
  const view = campaignService.toCampaignView(campaign);
  if (created) sendCreated(res, view);
  else sendSuccess(res, view, { idempotentReplay: true });
}

export async function update(req: Request, res: Response): Promise<void> {
  const values = req.validated?.body as Parameters<typeof campaignService.updateCampaign>[1];
  const doc = await campaignService.updateCampaign(req.params.id, values, req.auth!.userId, recordAudit);
  sendSuccess(res, campaignService.toCampaignView(doc));
}

export async function preview(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await campaignService.previewCampaign(req.params.id));
}

export async function submit(req: Request, res: Response): Promise<void> {
  const doc = await campaignService.submitCampaign(req.params.id, req.auth!.userId, recordAudit);
  sendSuccess(res, campaignService.toCampaignView(doc));
}

export async function approve(req: Request, res: Response): Promise<void> {
  const doc = await campaignService.approveCampaign(req.params.id, req.auth!.userId, recordAudit);
  sendSuccess(res, campaignService.toCampaignView(doc));
}

export async function schedule(req: Request, res: Response): Promise<void> {
  const { scheduledAt } = req.validated?.body as { scheduledAt: Date | null };
  const doc = await campaignService.scheduleCampaign(req.params.id, scheduledAt, req.auth!.userId, recordAudit);
  sendSuccess(res, campaignService.toCampaignView(doc));
}

export async function cancel(req: Request, res: Response): Promise<void> {
  const { reason } = (req.validated?.body ?? {}) as { reason?: string };
  const doc = await campaignService.cancelCampaign(req.params.id, reason, req.auth!.userId, recordAudit);
  sendSuccess(res, campaignService.toCampaignView(doc));
}

export async function send(req: Request, res: Response): Promise<void> {
  const { campaign, outcome } = await campaignService.createRecipientJobs(
    req.params.id,
    req.auth!.userId,
    recordAudit,
  );
  sendSuccess(
    res,
    campaignService.toCampaignView(campaign, { dispatch: outcome }),
    { simulated: true },
  );
}

export async function duplicate(req: Request, res: Response): Promise<void> {
  const doc = await campaignService.duplicateCampaign(req.params.id, req.auth!.userId, recordAudit);
  sendCreated(res, campaignService.toCampaignView(doc));
}

export async function recipients(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as CampaignRecipientQuery;
  const { items, total } = await campaignService.listRecipients(req.params.id, query);
  sendSuccess(res, items, paginationMeta(query.page, query.limit, total));
}

export async function report(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await campaignService.campaignReport(req.params.id));
}
