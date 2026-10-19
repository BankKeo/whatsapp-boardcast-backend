/**
 * Redaction helpers for audit metadata.
 *
 * Audit entries may carry request context; secrets, password material and full
 * contact numbers must never be persisted in clear text (docs/starter-project.md
 * §8).
 */

const SENSITIVE_KEYS = new Set([
  "password",
  "newpassword",
  "currentpassword",
  "passwordhash",
  "token",
  "accesstoken",
  "refreshtoken",
  "tokenhash",
  "secret",
  "authorization",
  "cookie",
]);

/** Keep the last two digits of a phone number so a record stays identifiable. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 2) return "••";
  return `••••${digits.slice(-2)}`;
}

function redactValue(key: string, value: unknown): unknown {
  const normalised = key.toLowerCase();
  if (SENSITIVE_KEYS.has(normalised)) return "[redacted]";
  if (normalised.includes("phone") && typeof value === "string") return maskPhone(value);
  if (Array.isArray(value)) return value.map((item) => redactObject(item));
  if (value && typeof value === "object") return redactObject(value as Record<string, unknown>);
  return value;
}

export function redactObject(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = redactValue(key, value);
  }
  return output;
}
