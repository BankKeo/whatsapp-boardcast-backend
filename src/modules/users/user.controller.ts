import type { Request, Response } from "express";
import { paginationMeta, sendCreated, sendSuccess } from "../../common/http/respond";
import { recordAudit } from "../audit-logs/auditLog.service";
import * as userService from "./user.service";
import type { UserCreateValues } from "./user.schema";
import type { UserStatus } from "../../common/constants/domain";

export async function list(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as { search: string; role: never; status: never; page: number; limit: number };
  const { items, total } = await userService.listUsers(query);
  sendSuccess(res, items, paginationMeta(query.page, query.limit, total));
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const user = await userService.getUser(req.params.id);
  sendSuccess(res, userService.toTeamMemberView(user));
}

export async function create(req: Request, res: Response): Promise<void> {
  const values = req.validated?.body as UserCreateValues;
  const user = await userService.createUser(values, req.auth!.userId, recordAudit);
  sendCreated(res, userService.toTeamMemberView(user));
}

export async function update(req: Request, res: Response): Promise<void> {
  const values = req.validated?.body as { name?: string; role?: never };
  const user = await userService.updateUser(req.params.id, values, req.auth!.userId, recordAudit);
  sendSuccess(res, userService.toTeamMemberView(user));
}

export async function updateStatus(req: Request, res: Response): Promise<void> {
  const { status } = req.validated?.body as { status: UserStatus };
  const user = await userService.updateUserStatus(req.params.id, status, req.auth!.userId, recordAudit);
  sendSuccess(res, userService.toTeamMemberView(user));
}
