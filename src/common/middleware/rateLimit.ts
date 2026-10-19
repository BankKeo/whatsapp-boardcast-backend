/**
 * Rate limiting (docs/starter-project.md §8).
 *
 * A generous global limiter protects the API as a whole, while a stricter
 * limiter is applied to the authentication endpoints where brute force matters.
 */

import rateLimit from "express-rate-limit";
import { env, isTest } from "../../config/env";

const jsonHandler = (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) => {
  res.status(429).json({
    success: false,
    error: {
      code: "RATE_LIMITED",
      message: "Too many requests. Please slow down and try again.",
      details: [],
    },
  });
};

export const globalRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  handler: jsonHandler,
});

export const authRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: () => isTest,
  handler: jsonHandler,
});
