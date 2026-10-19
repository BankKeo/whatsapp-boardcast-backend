/**
 * Small, dependency-free duration parser.
 *
 * Used for cookie lifetimes and refresh-token expiry where we need milliseconds.
 * Accepts `30s`, `15m`, `12h`, `30d` and bare numbers (interpreted as seconds,
 * matching `jsonwebtoken`'s `expiresIn` semantics).
 */

const UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

export function parseDuration(value: string): number {
  const input = value.trim();
  if (/^\d+$/.test(input)) return Number(input) * 1000;

  const match = /^(\d+)\s*(ms|s|m|h|d)$/i.exec(input);
  if (!match) {
    throw new Error(`Unsupported duration: "${value}". Use e.g. 15m, 12h, 30d.`);
  }
  const amount = Number(match[1]);
  const unit = UNITS[match[2].toLowerCase()];
  return amount * unit;
}
