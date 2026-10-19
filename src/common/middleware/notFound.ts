import type { RequestHandler } from "express";
import { NotFoundError } from "../errors/AppError";

/** Fallback for unmatched routes — forwards a consistent 404 to the error handler. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`No route matches ${req.method} ${req.originalUrl}.`));
};
