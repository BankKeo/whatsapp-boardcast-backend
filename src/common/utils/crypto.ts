import { createHash, randomBytes } from "node:crypto";

/** SHA-256 hex digest — used for refresh-token and webhook dedupe hashes. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Cryptographically random, URL-safe opaque token (never stored in clear). */
export function generateOpaqueToken(bytes = 48): string {
  return randomBytes(bytes).toString("base64url");
}
