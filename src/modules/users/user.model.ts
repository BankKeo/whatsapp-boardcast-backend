/**
 * User / team member model.
 *
 * Combines the dashboard's team member shape (`types/team.ts`: name, email,
 * role, status, lastActive, invitedAt) with the authentication fields required
 * by docs/starter-project.md §4.1 (passwordHash, lastLoginAt, activation).
 * Roles use the dashboard's display values so the Team table needs no mapping.
 */

import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";
import { USER_ROLES, USER_STATUSES } from "../../common/constants/domain";
import { baseSchemaOptions } from "../../common/utils/mongo";

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      maxlength: 200,
    },
    /**
     * bcrypt hash only — plaintext passwords are never stored. Null while a
     * member is `Invited`; set when the invitation is accepted. Services must
     * reject login for users without a hash.
     */
    passwordHash: { type: String, default: null, select: false },
    role: { type: String, enum: USER_ROLES, default: "Read-Only Analyst", index: true },
    status: { type: String, enum: USER_STATUSES, default: "Invited", index: true },

    lastLoginAt: { type: Date, default: null },
    lastActive: { type: Date, default: null },
    invitedAt: { type: Date, default: () => new Date() },
    invitedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    deactivatedAt: { type: Date, default: null },

    /** Bumped on password change so existing refresh tokens can be revoked. */
    tokenVersion: { type: Number, default: 0 },
  },
  baseSchemaOptions,
);

/** Case-insensitive uniqueness is enforced by the lowercase + unique index. */
userSchema.index({ role: 1, status: 1 });

export type User = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<User>;

export const UserModel = model("User", userSchema);
