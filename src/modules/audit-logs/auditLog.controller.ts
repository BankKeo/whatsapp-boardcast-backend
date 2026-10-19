import type { Request, Response } from "express";
import { paginationMeta, sendSuccess } from "../../common/http/respond";
import { listAuditLogs } from "./auditLog.service";
import type { AuditLogQuery } from "./auditLog.schema";

export async function list(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as AuditLogQuery;
  const { items, total } = await listAuditLogs(query);
  sendSuccess(res, items, paginationMeta(query.page, query.limit, total));
}
