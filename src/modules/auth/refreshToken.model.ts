/**
 * Refresh token / session model.
 *
 * Supports the JWT refresh flow with rotation and revocation required by
 * docs/starter-project.md §5.1. Only a hash of the token is stored; the raw
 * token lives solely in the HTTP-only cookie. A TTL index removes expired rows.
 */

import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";
import { REFRESH_TOKEN_STATUSES } from "../../common/constants/domain";
import { baseSchemaOptions } from "../../common/utils/mongo";

const refreshTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    /** SHA-256 of the token; the plaintext token is never persisted. */
    tokenHash: { type: String, required: true, unique: true },
    status: { type: String, enum: REFRESH_TOKEN_STATUSES, default: "Active", index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    /** Rotation chain: the token that replaced this one. */
    replacedByHash: { type: String, default: null },
    /** Detects reuse of an already-rotated token (theft signal). */
    reusedDetectedAt: { type: Date, default: null },
    createdByIp: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  baseSchemaOptions,
);

/* MongoDB removes the row once the token can no longer be used. */
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RefreshToken = InferSchemaType<typeof refreshTokenSchema>;
export type RefreshTokenDocument = HydratedDocument<RefreshToken>;

export const RefreshTokenModel = model("RefreshToken", refreshTokenSchema);
