/**
 * Authentication service.
 *
 * Owns password verification, JWT access-token signing, and refresh-token
 * rotation/revocation. Refresh tokens are random opaque values; only their
 * SHA-256 hash is stored, so a database leak does not yield usable sessions.
 *
 * Reuse detection: presenting a refresh token that was already rotated revokes
 * every token for that user, which is the standard mitigation for a stolen
 * refresh token.
 */

import jwt from "jsonwebtoken";
import type { Types } from "mongoose";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { generateOpaqueToken, sha256 } from "../../common/utils/crypto";
import { parseDuration } from "../../common/utils/duration";
import { hashPassword, verifyPassword } from "../../common/utils/password";
import { ForbiddenError, UnauthorizedError } from "../../common/errors/AppError";
import type { UserRole } from "../../common/constants/domain";
import { RefreshTokenModel } from "./refreshToken.model";
import { UserModel, type UserDocument } from "../users/user.model";
import type { IssuedTokens } from "./auth.cookies";
import type { AccessTokenClaims } from "../../common/auth/auth.types";

export interface SessionMeta {
  ip?: string | null;
  userAgent?: string | null;
}

function accessExpiryDate(): Date {
  return new Date(Date.now() + parseDuration(env.ACCESS_TOKEN_TTL));
}

function signAccessToken(user: UserDocument): string {
  const claims: AccessTokenClaims = {
    sub: String(user._id),
    email: user.email,
    role: user.role as UserRole,
    tv: user.tokenVersion,
    type: "access",
  };
  return jwt.sign(claims, env.ACCESS_TOKEN_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const decoded = jwt.verify(token, env.ACCESS_TOKEN_SECRET);
  if (typeof decoded === "string" || decoded.type !== "access") {
    throw new UnauthorizedError("The authentication token is invalid.");
  }
  return decoded as AccessTokenClaims;
}

async function persistRefreshToken(
  userId: Types.ObjectId,
  meta: SessionMeta,
): Promise<{ raw: string; expiresAt: Date }> {
  const raw = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + parseDuration(env.REFRESH_TOKEN_TTL));
  await RefreshTokenModel.create({
    userId,
    tokenHash: sha256(raw),
    expiresAt,
    createdByIp: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { raw, expiresAt };
}

export async function issueTokens(user: UserDocument, meta: SessionMeta = {}): Promise<IssuedTokens> {
  const accessToken = signAccessToken(user);
  const { raw, expiresAt } = await persistRefreshToken(user._id as Types.ObjectId, meta);
  return {
    accessToken,
    refreshToken: raw,
    accessExpiresAt: accessExpiryDate(),
    refreshExpiresAt: expiresAt,
  };
}

/** Verify hashed password; throws a generic error so account existence is not revealed. */
export async function verifyCredentials(email: string, password: string): Promise<UserDocument> {
  const user = await UserModel.findOne({ email }).select("+passwordHash");
  const invalid = new UnauthorizedError("The email or password is incorrect.");

  if (!user || !user.passwordHash) throw invalid;
  const matches = await verifyPassword(password, user.passwordHash);
  if (!matches) throw invalid;

  if (user.status === "Deactivated") {
    throw new ForbiddenError("This account has been deactivated. Contact an administrator.");
  }
  if (user.status !== "Active") {
    throw new ForbiddenError("This account has not been activated yet. Contact an administrator.");
  }
  return user;
}

export async function login(
  email: string,
  password: string,
  meta: SessionMeta = {},
): Promise<{ user: UserDocument; tokens: IssuedTokens }> {
  const user = await verifyCredentials(email, password);
  user.lastLoginAt = new Date();
  user.lastActive = new Date();
  await user.save();
  const tokens = await issueTokens(user, meta);
  return { user, tokens };
}

/**
 * Rotate a refresh token. Returns the new pair and the owning user so the caller
 * can re-issue cookies.
 */
export async function rotateRefreshToken(
  rawToken: string,
  meta: SessionMeta = {},
): Promise<{ user: UserDocument; tokens: IssuedTokens }> {
  const invalid = new UnauthorizedError("The session is no longer valid. Please sign in again.");
  const hash = sha256(rawToken);
  const record = await RefreshTokenModel.findOne({ tokenHash: hash });
  if (!record) throw invalid;

  if (record.status !== "Active") {
    // Reuse of a rotated/revoked token — treat as a compromise.
    await RefreshTokenModel.updateMany(
      { userId: record.userId, status: "Active" },
      { $set: { status: "Revoked", revokedAt: new Date() } },
    );
    record.reusedDetectedAt = new Date();
    await record.save();
    logger.warn({ userId: String(record.userId) }, "Refresh token reuse detected; all sessions revoked");
    throw invalid;
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    record.status = "Expired";
    await record.save();
    throw invalid;
  }

  const user = await UserModel.findById(record.userId).select("+passwordHash");
  if (!user || user.status !== "Active") throw invalid;

  const tokens = await issueTokens(user, meta);
  record.status = "Revoked";
  record.revokedAt = new Date();
  record.replacedByHash = sha256(tokens.refreshToken);
  await record.save();

  return { user, tokens };
}

/** Revoke a single refresh token (logout). Idempotent. */
export async function revokeRefreshToken(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  await RefreshTokenModel.updateOne(
    { tokenHash: sha256(rawToken), status: "Active" },
    { $set: { status: "Revoked", revokedAt: new Date() } },
  );
}

/** Revoke every active refresh token for a user (password change, admin action). */
export async function revokeAllUserTokens(userId: string | Types.ObjectId): Promise<void> {
  await RefreshTokenModel.updateMany(
    { userId, status: "Active" },
    { $set: { status: "Revoked", revokedAt: new Date() } },
  );
}

export async function changePassword(
  user: UserDocument,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const withHash = await UserModel.findById(user._id).select("+passwordHash");
  if (!withHash) throw new UnauthorizedError();
  const matches = await verifyPassword(currentPassword, withHash.passwordHash);
  if (!matches) {
    throw new UnauthorizedError("Your current password is incorrect.");
  }
  withHash.passwordHash = await hashPassword(newPassword);
  withHash.tokenVersion += 1;
  await withHash.save();
  await revokeAllUserTokens(withHash._id as Types.ObjectId);
}

/** Shape returned to the client — never includes the password hash. */
export function sanitizeUser(user: UserDocument) {
  const json = user.toJSON() as Record<string, unknown>;
  delete json.passwordHash;
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    lastLoginAt: user.lastLoginAt ?? null,
    lastActive: user.lastActive ?? null,
    invitedAt: user.invitedAt ?? null,
    createdAt: json.createdAt,
    updatedAt: json.updatedAt,
  };
}
