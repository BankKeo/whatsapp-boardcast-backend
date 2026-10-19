import type { Request, Response } from "express";
import { paginationMeta, sendCreated, sendNoContent, sendSuccess } from "../../common/http/respond";
import { recordAudit } from "../audit-logs/auditLog.service";
import * as outletService from "./outlet.service";
import * as importService from "../imports/import.service";
import type { OutletFormValues, OutletListQuery } from "./outlet.schema";
import { toOutletFilterInput } from "./outlet.schema";
import { OUTLET_CSV_TEMPLATE } from "./outlet.template";
import type { ImportCommitValues, ImportPreviewValues } from "../imports/importJob.schema";

export async function list(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as OutletListQuery;
  const { items, total } = await outletService.listOutlets(query);
  sendSuccess(res, items, paginationMeta(query.page, query.limit, total));
}

export async function stats(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await outletService.outletStats());
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const doc = await outletService.getOutlet(req.params.id);
  sendSuccess(res, outletService.toOutletView(doc));
}

export async function create(req: Request, res: Response): Promise<void> {
  const values = req.validated?.body as OutletFormValues;
  const doc = await outletService.createOutlet(values, req.auth!.userId, recordAudit);
  sendCreated(res, outletService.toOutletView(doc));
}

export async function update(req: Request, res: Response): Promise<void> {
  const values = req.validated?.body as Partial<OutletFormValues>;
  const doc = await outletService.updateOutlet(req.params.id, values, req.auth!.userId, recordAudit);
  sendSuccess(res, outletService.toOutletView(doc));
}

export async function remove(req: Request, res: Response): Promise<void> {
  await outletService.deleteOutlet(req.params.id, req.auth!.userId, recordAudit);
  sendNoContent(res);
}

export async function bulk(req: Request, res: Response): Promise<void> {
  const { outlets } = req.validated?.body as { outlets: OutletFormValues[] };
  const outcome = await outletService.bulkCreateOutlets(outlets, req.auth!.userId, recordAudit);
  sendCreated(res, outcome);
}

export async function breakdown(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as OutletListQuery;
  sendSuccess(res, await outletService.audienceBreakdown(toOutletFilterInput(query)));
}

export async function exportCsv(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as OutletListQuery;
  const csv = await outletService.exportOutletsCsv(query);

  await recordAudit({
    type: "outlet",
    message: "Exported the outlet register.",
    actorId: req.auth!.userId,
    targetType: "outlet",
    metadata: { filters: { province: query.province, category: query.category } },
  });

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="outlets.csv"');
  res.status(200).send(csv);
}

/* ----------------------------- CSV import ----------------------------- */

export function importTemplate(_req: Request, res: Response): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="outlet-import-template.csv"');
  res.status(200).send(OUTLET_CSV_TEMPLATE);
}

export async function importPreview(req: Request, res: Response): Promise<void> {
  const values = req.validated?.body as ImportPreviewValues;
  const { result, job } = await importService.previewImport(values, req.auth!.userId, recordAudit);
  sendSuccess(res, {
    jobId: String(job._id),
    summary: {
      totalRows: result.totalRows,
      importableRows: result.importableRows,
      errorRows: result.errorRows,
      warningRows: result.warningRows,
      duplicateRows: result.duplicateRows,
    },
    headerWarning: result.headerWarning,
    parseError: result.parseError,
    rows: result.rows.map((row) => ({
      lineNumber: row.lineNumber,
      status: row.status,
      duplicate: row.duplicate,
      errors: row.errors,
      warnings: row.warnings,
      values: row.values,
    })),
  });
}

export async function importCommit(req: Request, res: Response): Promise<void> {
  const values = req.validated?.body as ImportCommitValues;
  const outcome = await importService.commitImport(values, req.auth!.userId, recordAudit);
  sendSuccess(res, outcome);
}

export async function importJobs(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as { status: string; page: number; limit: number };
  const { items, total } = await importService.listImportJobs(query);
  sendSuccess(res, items, paginationMeta(query.page, query.limit, total));
}
