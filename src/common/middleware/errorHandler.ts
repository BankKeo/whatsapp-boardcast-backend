/**
 * Central error handler.
 *
 * Converts thrown errors into the standard error envelope with an appropriate
 * status code (docs/starter-project.md §10, §8). Stack traces, database
 * internals and secrets are never returned once NODE_ENV=production.
 */

import type { ErrorRequestHandler, NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { ZodError } from "zod";
import { isProduction } from "../../config/env";
import { logger } from "../../config/logger";
import { AppError, type ErrorDetail } from "../errors/AppError";

interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details: ErrorDetail[];
  };
}

function fromZod(error: ZodError): { status: number; code: string; message: string; details: ErrorDetail[] } {
  return {
    status: 422,
    code: "VALIDATION_ERROR",
    message: "Please check the submitted information.",
    details: error.issues.map((issue) => ({
      path: issue.path.map(String).join(".") || "(root)",
      message: issue.message,
    })),
  };
}

function fromMongooseValidation(error: mongoose.Error.ValidationError) {
  const details: ErrorDetail[] = Object.values(error.errors).map((item) => ({
    path: item.path,
    message: item.message,
  }));
  return {
    status: 422,
    code: "VALIDATION_ERROR",
    message: "Please check the submitted information.",
    details,
  };
}

function fromDuplicateKey(error: { keyPattern?: Record<string, unknown>; keyValue?: Record<string, unknown> }) {
  const fields = Object.keys(error.keyPattern ?? {});
  return {
    status: 409,
    code: "CONFLICT",
    message: fields.length
      ? `A record with this ${fields.join(", ")} already exists.`
      : "A record with these values already exists.",
    details: fields.map((field) => ({
      path: field,
      message: "Already in use.",
      value: error.keyValue?.[field],
    })),
  };
}

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (res.headersSent) {
    next(error);
    return;
  }

  let status = 500;
  let code = "INTERNAL_ERROR";
  let message = "An unexpected error occurred. Please try again.";
  let details: ErrorDetail[] = [];

  if (error instanceof AppError) {
    status = error.statusCode;
    code = error.code;
    message = error.message;
    details = error.details;
  } else if (error instanceof ZodError) {
    ({ status, code, message, details } = fromZod(error));
  } else if (error instanceof mongoose.Error.ValidationError) {
    ({ status, code, message, details } = fromMongooseValidation(error));
  } else if (error instanceof mongoose.Error.CastError) {
    status = 400;
    code = "BAD_REQUEST";
    message = `Invalid value for ${error.path}.`;
  } else if (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: number }).code === 11000
  ) {
    ({ status, code, message, details } = fromDuplicateKey(error as never));
  } else if (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "JsonWebTokenError"
  ) {
    status = 401;
    code = "UNAUTHORIZED";
    message = "The authentication token is invalid.";
  } else if (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "TokenExpiredError"
  ) {
    status = 401;
    code = "TOKEN_EXPIRED";
    message = "The authentication token has expired.";
  } else if (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { message?: unknown }).message === "string" &&
    (error as { message: string }).message.includes("not allowed by CORS")
  ) {
    status = 403;
    code = "FORBIDDEN";
    message = (error as { message: string }).message;
  } else if (error instanceof SyntaxError && "body" in error) {
    status = 400;
    code = "BAD_REQUEST";
    message = "The request body is not valid JSON.";
  }

  const logPayload = { err: error, code, status, requestId: req.requestId };
  if (status >= 500) {
    logger.error(logPayload, "Unhandled request error");
  } else {
    logger.warn({ code, status, requestId: req.requestId, path: req.originalUrl }, "Request rejected");
  }

  const body: ErrorBody = {
    success: false,
    error: {
      code,
      message: isProduction && status >= 500 ? "An unexpected error occurred. Please try again." : message,
      details,
    },
  };

  if (isProduction && status >= 500) {
    logger.error({ requestId: req.requestId, err: error }, "Unexpected error details");
  }

  res.status(status).json(body);
};
