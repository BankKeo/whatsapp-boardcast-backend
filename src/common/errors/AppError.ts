/**
 * Application error taxonomy.
 *
 * Every error the API returns deliberately carries a machine-readable `code`
 * plus an HTTP status, so the error handler can render the consistent envelope
 * from docs/starter-project.md §10 without leaking stack traces or database
 * internals.
 */

export type ErrorDetail = {
  path: string;
  message: string;
  [key: string]: unknown;
};

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: ErrorDetail[];
  /** Operational errors are expected and safe to expose; others are 500s. */
  readonly isOperational: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details: ErrorDetail[] = [],
    isOperational = true,
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message = "The request could not be processed.", details: ErrorDetail[] = []) {
    super(400, "BAD_REQUEST", message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication is required.") {
    super(401, "UNAUTHORIZED", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super(403, "FORBIDDEN", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "The requested resource was not found.") {
    super(404, "NOT_FOUND", message);
  }
}

export class ConflictError extends AppError {
  constructor(message = "The resource conflicts with an existing record.", details: ErrorDetail[] = []) {
    super(409, "CONFLICT", message, details);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Please check the submitted information.", details: ErrorDetail[] = []) {
    super(422, "VALIDATION_ERROR", message, details);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = "Too many requests. Please slow down and try again.") {
    super(429, "RATE_LIMITED", message);
  }
}

/** Returned when the WhatsApp provider is not configured but a real send was requested. */
export class ProviderNotConfiguredError extends AppError {
  constructor(message = "The WhatsApp provider is not configured.") {
    super(503, "PROVIDER_NOT_CONFIGURED", message);
  }
}
