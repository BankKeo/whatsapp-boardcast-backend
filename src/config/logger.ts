/**
 * Structured logger (Pino).
 *
 * Sensitive values are redacted before they are written, per
 * docs/starter-project.md §8 (passwords, tokens, secrets, contact data). Console
 * output is pretty-printed in development and JSON everywhere else.
 */

import pino from "pino";
import { env, isDevelopment, isTest } from "./env";

const redactPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers.set-cookie",
  "req.body.password",
  "req.body.newPassword",
  "req.body.currentPassword",
  "req.body.refreshToken",
  "req.body.accessToken",
  "password",
  "passwordHash",
  "newPassword",
  "currentPassword",
  "refreshToken",
  "accessToken",
  "token",
  "tokenHash",
];

export const logger = pino({
  level: isTest ? "silent" : env.LOG_LEVEL,
  redact: { paths: redactPaths, censor: "[redacted]" },
  transport: isDevelopment
    ? {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:standard", singleLine: true },
      }
    : undefined,
});
