import type { Request, Response } from "express";
import { paginationMeta, sendSuccess } from "../../common/http/respond";
import { recordAudit } from "../audit-logs/auditLog.service";
import * as reportService from "./report.service";
import type { ReportFailureQuery, ReportFilters } from "./report.schema";

export async function overview(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await reportService.reportOverview(req.validated?.query as ReportFilters));
}

export async function campaignPerformance(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await reportService.campaignPerformance(req.validated?.query as ReportFilters));
}

export async function provincePerformance(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await reportService.provincePerformance(req.validated?.query as ReportFilters));
}

export async function categoryPerformance(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await reportService.categoryPerformance(req.validated?.query as ReportFilters));
}

export async function messageFailures(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as ReportFailureQuery;
  const result = await reportService.messageFailures(query);
  sendSuccess(res, result.items, {
    ...paginationMeta(query.page, query.limit, result.total),
    summary: result.summary,
  });
}

export async function exportReport(req: Request, res: Response): Promise<void> {
  const filters = req.validated?.query as ReportFilters;
  const csv = await reportService.exportReportCsv(filters);

  await recordAudit({
    type: "settings",
    message: "Exported a campaign performance report.",
    actorId: req.auth!.userId,
    targetType: "report",
    metadata: { from: filters.from, to: filters.to, campaignId: filters.campaignId },
  });

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="campaign-report.csv"');
  res.status(200).send(csv);
}
