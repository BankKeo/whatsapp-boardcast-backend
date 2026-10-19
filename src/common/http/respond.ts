/**
 * Consistent API response envelope (docs/starter-project.md §10).
 */

import type { Response } from "express";

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown> | PaginationMeta;
}

export function buildMeta(meta: PaginationMeta): PaginationMeta {
  return meta;
}

export function paginationMeta(page: number, limit: number, total: number): PaginationMeta {
  return {
    page,
    limit,
    total,
    totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
  };
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  meta?: Record<string, unknown> | PaginationMeta,
): Response {
  const body: SuccessEnvelope<T> = meta === undefined ? { success: true, data } : { success: true, data, meta };
  return res.status(200).json(body);
}

export function sendCreated<T>(res: Response, data: T, meta?: Record<string, unknown>): Response {
  const body: SuccessEnvelope<T> = meta === undefined ? { success: true, data } : { success: true, data, meta };
  return res.status(201).json(body);
}

export function sendNoContent(res: Response): Response {
  return res.status(204).send();
}
