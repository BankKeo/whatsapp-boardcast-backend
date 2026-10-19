import bcrypt from "bcryptjs";
import { env } from "../../config/env";

/** Hash a plaintext password with bcrypt. Plaintext is never stored. */
export function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, env.BCRYPT_ROUNDS);
}

/** Constant-time comparison of a plaintext password against a stored hash. */
export function verifyPassword(plaintext: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) return Promise.resolve(false);
  return bcrypt.compare(plaintext, hash);
}
