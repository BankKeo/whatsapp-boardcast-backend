/**
 * Environment configuration.
 *
 * Every variable is validated with Zod at process start (docs/starter-project.md
 * §11). A misconfigured deployment fails fast with a readable report instead of
 * silently running in an insecure demo mode. Development/test fall back to
 * clearly-labelled local defaults; production must supply real secrets.
 */

import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

const nodeEnvs = ["development", "test", "production"] as const;
const providers = ["mock", "meta"] as const;

const DEV_ACCESS_SECRET = "dev-access-token-secret-change-me";
const DEV_REFRESH_SECRET = "dev-refresh-token-secret-change-me";

/** Comma-separated list → trimmed, non-empty array. */
const csv = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );

const bool = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(defaultValue)
    .transform((value) =>
      typeof value === "boolean" ? value : ["1", "true", "yes", "on"].includes(value.toLowerCase()),
    );

const envSchema = z
  .object({
    NODE_ENV: z.enum(nodeEnvs).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    API_PREFIX: z.string().default("/api/v1"),
    MONGODB_URI: z.string().min(1).default("mongodb://127.0.0.1:27017/whatsapp_boardcast"),
    FRONTEND_URL: z.string().default("http://localhost:3000"),
    /** Extra browser origins allowed by CORS, in addition to FRONTEND_URL. */
    CORS_ORIGINS: csv,

    ACCESS_TOKEN_SECRET: z.string().min(16).default(DEV_ACCESS_SECRET),
    REFRESH_TOKEN_SECRET: z.string().min(16).default(DEV_REFRESH_SECRET),
    ACCESS_TOKEN_TTL: z.string().default("15m"),
    REFRESH_TOKEN_TTL: z.string().default("30d"),
    COOKIE_SECURE: bool(false),
    COOKIE_DOMAIN: z.string().optional(),

    BCRYPT_ROUNDS: z.coerce.number().int().min(8).max(15).default(12),

    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(15 * 60 * 1000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(600),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(20),

    WHATSAPP_PROVIDER: z.enum(providers).default("mock"),
    WHATSAPP_API_VERSION: z.string().default("v21.0"),
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional(),
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
    WHATSAPP_APP_SECRET: z.string().optional(),
    /** Require a provider-approved template before a campaign can be dispatched. */
    WHATSAPP_REQUIRE_APPROVED_TEMPLATES: bool(true),
    /** Maximum marketing messages a contact may receive per rolling day. */
    MESSAGING_DAILY_CAP_PER_CONTACT: z.coerce.number().int().min(1).default(4),

    REDIS_URL: z.string().optional(),
    /** Set to enable the BullMQ-backed queue; otherwise the in-process queue runs. */
    QUEUE_DRIVER: z.enum(["memory", "redis"]).default("memory"),

    SEED_ADMIN_EMAIL: z.string().email().default("admin@partnerclub.local"),
    SEED_ADMIN_PASSWORD: z.string().min(10).default("ChangeMe-Admin-2026"),
    SEED_ADMIN_NAME: z.string().default("Partner Club Administrator"),
  })
  .superRefine((value, ctx) => {
    const isProd = value.NODE_ENV === "production";

    if (isProd) {
      if (value.ACCESS_TOKEN_SECRET === DEV_ACCESS_SECRET) {
        ctx.addIssue({
          code: "custom",
          path: ["ACCESS_TOKEN_SECRET"],
          message: "Set a unique ACCESS_TOKEN_SECRET in production.",
        });
      }
      if (value.REFRESH_TOKEN_SECRET === DEV_REFRESH_SECRET) {
        ctx.addIssue({
          code: "custom",
          path: ["REFRESH_TOKEN_SECRET"],
          message: "Set a unique REFRESH_TOKEN_SECRET in production.",
        });
      }
    }

    if (value.WHATSAPP_PROVIDER === "meta") {
      const required = [
        "WHATSAPP_ACCESS_TOKEN",
        "WHATSAPP_PHONE_NUMBER_ID",
        "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
        "WHATSAPP_APP_SECRET",
      ] as const;
      for (const key of required) {
        if (!value[key]) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required when WHATSAPP_PROVIDER=meta.`,
          });
        }
      }
    }

    if (value.QUEUE_DRIVER === "redis" && !value.REDIS_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["REDIS_URL"],
        message: "REDIS_URL is required when QUEUE_DRIVER=redis.",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Minimal `.env` loader (no dependency). Real environment variables always win,
 * so production is unaffected by a stray local file. Values may be quoted.
 */
function loadDotEnv(): void {
  try {
    const path = `${process.cwd()}/.env`;
    if (!existsSync(path)) return;

    for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator === -1) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // A malformed .env is reported by schema validation, not here.
  }
}

function loadEnv(): Env {
  loadDotEnv();
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env: Env = loadEnv();

export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
export const isDevelopment = env.NODE_ENV === "development";

/** WhatsApp provider credentials absent → simulated mode, never a real send. */
export const whatsappIsSimulated =
  env.WHATSAPP_PROVIDER === "mock" ||
  !env.WHATSAPP_ACCESS_TOKEN ||
  !env.WHATSAPP_PHONE_NUMBER_ID;

/** Browser origins allowed to call the API. */
export const allowedOrigins: string[] = Array.from(
  new Set([env.FRONTEND_URL, ...env.CORS_ORIGINS].filter(Boolean)),
);
