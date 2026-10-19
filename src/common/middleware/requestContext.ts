/**
 * Request correlation.
 *
 * Every request gets an id (from `X-Request-Id` when supplied by an upstream
 * proxy, otherwise generated) that is echoed back and included in logs and error
 * responses, so a user-reported failure can be traced end to end.
 */

import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

const HEADER = "x-request-id";

export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.header(HEADER);
  const requestId = incoming && incoming.length <= 128 ? incoming : randomUUID();
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
};
