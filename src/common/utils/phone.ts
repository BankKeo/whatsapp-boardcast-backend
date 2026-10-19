/**
 * Lao phone number helpers.
 *
 * Ported from the dashboard (`whatsapp-boardcast-dashboard/lib/phone.ts`) so the
 * client and server agree on exactly which numbers are usable. The dashboard's
 * version returns a display string; here we split that into a canonical
 * `normalizeLaoPhone()` (digits-only E.164, safe to index and de-duplicate) and a
 * `formatLaoPhone()` for display.
 */

import type { PhoneStatus } from "../constants/domain";

/** Lao mobile numbers: +856 20 followed by 8 digits. */
export const LAO_MOBILE_PATTERN = /^\+85620\d{8}$/;

/**
 * Normalise a user-entered Lao mobile number to canonical `+85620XXXXXXXX`.
 * Accepts local (`020 …`), international (`+856 20 …`) and loose spacing.
 * Returns `null` when the value cannot be reconciled to a Lao mobile number.
 */
export function normalizeLaoPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim().replace(/[\s\-().]/g, "");
  if (!value) return null;
  if (value.startsWith("++")) value = value.slice(1);
  if (value.startsWith("00")) value = `+${value.slice(2)}`;

  if (value.startsWith("+")) {
    // Already international — keep as is.
  } else if (/^856\d{8,10}$/.test(value)) {
    value = `+${value}`;
  } else if (/^0\d{9,10}$/.test(value)) {
    // Local format, e.g. 020 5555 1188 → +8562055551188
    value = `+856${value.slice(1)}`;
  } else if (/^20\d{8}$/.test(value)) {
    // Subscriber format without the country or trunk prefix.
    value = `+856${value}`;
  }

  return LAO_MOBILE_PATTERN.test(value) ? value : null;
}

/** Display form: `+856 20 5555 1188`. Keeps invalid values visible so staff can fix them. */
export function formatLaoPhone(phone: string | null | undefined): string {
  if (!phone || !phone.trim()) return "—";
  const normalized = normalizeLaoPhone(phone);
  if (!normalized) return phone;
  const subscriber = normalized.slice(6);
  return `+856 20 ${subscriber.slice(0, 4)} ${subscriber.slice(4)}`;
}

export function getPhoneStatus(phone: string | null | undefined): PhoneStatus {
  if (!phone || !phone.trim()) return "Missing";
  return normalizeLaoPhone(phone) ? "Valid" : "Invalid";
}

/** Digits only, used for duplicate detection and search. */
export function phoneDigits(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "");
}
