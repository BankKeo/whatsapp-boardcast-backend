import type { Request, Response } from "express";
import { paginationMeta, sendCreated, sendNoContent, sendSuccess } from "../../common/http/respond";
import { recordAudit } from "../audit-logs/auditLog.service";
import * as segmentService from "./segment.service";
import type { OutletFilterInput } from "../outlets/outlet.service";

export async function list(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as { search: string; page: number; limit: number };
  const { items, total } = await segmentService.listSegments(query);
  sendSuccess(res, items, paginationMeta(query.page, query.limit, total));
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const doc = await segmentService.getSegment(req.params.id);
  sendSuccess(res, segmentService.toSegmentView(doc));
}

export async function create(req: Request, res: Response): Promise<void> {
  const values = req.validated?.body as { name: string; description: string; filters: OutletFilterInput };
  const doc = await segmentService.createSegment(values, req.auth!.userId, recordAudit);
  sendCreated(res, segmentService.toSegmentView(doc));
}

export async function update(req: Request, res: Response): Promise<void> {
  const values = req.validated?.body as {
    name?: string;
    description?: string;
    filters?: OutletFilterInput;
  };
  const doc = await segmentService.updateSegment(req.params.id, values, req.auth!.userId, recordAudit);
  sendSuccess(res, segmentService.toSegmentView(doc));
}

export async function remove(req: Request, res: Response): Promise<void> {
  await segmentService.deleteSegment(req.params.id, req.auth!.userId, recordAudit);
  sendNoContent(res);
}

export async function preview(req: Request, res: Response): Promise<void> {
  const { filters, limit } = req.validated?.body as { filters: OutletFilterInput; limit: number };
  sendSuccess(res, await segmentService.previewSegment(filters, limit));
}

export async function recipients(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as { page: number; limit: number };
  const result = await segmentService.segmentRecipients(req.params.id, query.page, query.limit);
  sendSuccess(res, result.items, {
    ...paginationMeta(query.page, query.limit, result.total),
    segmentId: result.segmentId,
    consentApplied: true,
    eligibilityApplied: true,
    deduplicatedBy: "phone",
  });
}
