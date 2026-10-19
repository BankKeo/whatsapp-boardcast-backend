/**
 * Zod validation middleware.
 *
 * Parses (and where schemas apply defaults/coercion, replaces) `body`, `query`
 * and `params` before the controller runs. Invalid input becomes a
 * `VALIDATION_ERROR` with field-level paths, so the frontend can highlight the
 * offending fields (docs/starter-project.md §9).
 */

import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { ValidationError, type ErrorDetail } from "../errors/AppError";

export interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

function toDetails(issues: { path: PropertyKey[]; message: string }[]): ErrorDetail[] {
  return issues.map((issue) => ({
    path: issue.path.map(String).join(".") || "(root)",
    message: issue.message,
  }));
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, _res, next) => {
    const details: ErrorDetail[] = [];
    const validated: NonNullable<typeof req.validated> = {};

    for (const key of ["body", "query", "params"] as const) {
      const schema = schemas[key];
      if (!schema) continue;

      const result = schema.safeParse(req[key]);
      if (!result.success) {
        details.push(...toDetails(result.error.issues));
        continue;
      }

      validated[key] = result.data;
      // `req.query`/`req.params` are plain objects in Express 4 and safe to
      // replace with the parsed (defaulted/coerced) values.
      if (key === "body") req.body = result.data;
      if (key === "query") req.query = result.data as typeof req.query;
      if (key === "params") req.params = result.data as typeof req.params;
    }

    if (details.length > 0) {
      next(new ValidationError("Please check the submitted information.", details));
      return;
    }

    req.validated = validated;
    next();
  };
}
