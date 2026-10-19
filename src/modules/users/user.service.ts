/**
 * User administration service.
 *
 * Implements docs/starter-project.md §5.7: listing, creation, updates, status
 * changes, and the "never deactivate the last administrator" safety rule.
 */

import type { FilterQuery, Types } from "mongoose";
import { escapeRegex } from "../../common/utils/escape";
import { hashPassword } from "../../common/utils/password";
import { ConflictError, NotFoundError } from "../../common/errors/AppError";
import type { UserRole, UserStatus } from "../../common/constants/domain";
import { UserModel, type UserDocument } from "./user.model";
import { revokeAllUserTokens } from "../auth/auth.service";
import type { AuditInput } from "../audit-logs/auditLog.service";
import type { UserCreateValues } from "./user.schema";

export interface ListUsersQuery {
  search: string;
  role: UserRole | "all";
  status: UserStatus | "all";
  page: number;
  limit: number;
}

export type AuditRecorder = (input: AuditInput) => Promise<void>;

export interface TeamMemberView {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  lastActive: Date | null;
  lastLoginAt: Date | null;
  invitedAt: Date | null;
  createdAt: Date | undefined;
  updatedAt: Date | undefined;
}

export function toTeamMemberView(user: UserDocument): TeamMemberView {
  const json = user.toJSON() as Record<string, unknown>;
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role as UserRole,
    status: user.status as UserStatus,
    lastActive: user.lastActive ?? null,
    lastLoginAt: user.lastLoginAt ?? null,
    invitedAt: user.invitedAt ?? null,
    createdAt: json.createdAt as Date | undefined,
    updatedAt: json.updatedAt as Date | undefined,
  };
}

export async function countActiveAdministrators(excludeId?: string | Types.ObjectId): Promise<number> {
  const filter: FilterQuery<UserDocument> = { role: "Administrator", status: "Active" };
  if (excludeId) filter._id = { $ne: excludeId };
  return UserModel.countDocuments(filter);
}

export async function listUsers(query: ListUsersQuery) {
  const filter: FilterQuery<UserDocument> = {};
  if (query.role !== "all") filter.role = query.role;
  if (query.status !== "all") filter.status = query.status;
  if (query.search) {
    const regex = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ name: regex }, { email: regex }];
  }

  const skip = (query.page - 1) * query.limit;
  const [users, total] = await Promise.all([
    UserModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit),
    UserModel.countDocuments(filter),
  ]);

  return { items: users.map(toTeamMemberView), total };
}

export async function getUser(id: string): Promise<UserDocument> {
  const user = await UserModel.findById(id);
  if (!user) throw new NotFoundError("Team member not found.");
  return user;
}

export async function createUser(
  values: UserCreateValues,
  createdBy: string,
  recordAudit: AuditRecorder,
): Promise<UserDocument> {
  const existing = await UserModel.findOne({ email: values.email });
  if (existing) {
    throw new ConflictError("A team member with this email already exists.", [
      { path: "email", message: "Already in use." },
    ]);
  }

  const passwordHash = values.password ? await hashPassword(values.password) : null;
  const status: UserStatus = values.password ? "Active" : values.status;

  const user = await UserModel.create({
    name: values.name,
    email: values.email,
    role: values.role,
    status,
    passwordHash,
    invitedAt: new Date(),
    invitedBy: createdBy,
  });

  await recordAudit({
    type: "team",
    message: `Invited ${user.name} (${user.role}).`,
    actorId: createdBy,
    targetType: "user",
    targetId: user._id,
    metadata: { email: user.email, role: user.role, status: user.status },
  });

  return user;
}

export async function updateUser(
  id: string,
  values: { name?: string; role?: UserRole },
  actorId: string,
  recordAudit: AuditRecorder,
): Promise<UserDocument> {
  const user = await getUser(id);
  const changes: Record<string, unknown> = {};

  if (values.name !== undefined && values.name !== user.name) {
    user.name = values.name;
    changes.name = values.name;
  }

  if (values.role !== undefined && values.role !== user.role) {
    // Removing the last administrator role would lock everyone out.
    if (user.role === "Administrator" && values.role !== "Administrator") {
      const remaining = await countActiveAdministrators(user._id);
      if (remaining === 0) {
        throw new ConflictError(
          "The last active administrator cannot be demoted. Promote another administrator first.",
        );
      }
    }
    user.role = values.role;
    changes.role = values.role;
  }

  if (Object.keys(changes).length > 0) {
    await user.save();
    await recordAudit({
      type: "team",
      message: `Updated ${user.name}'s profile.`,
      actorId,
      targetType: "user",
      targetId: user._id,
      metadata: changes,
    });
  }

  return user;
}

export async function updateUserStatus(
  id: string,
  status: UserStatus,
  actorId: string,
  recordAudit: AuditRecorder,
): Promise<UserDocument> {
  const user = await getUser(id);
  if (user.status === status) return user;

  if (status !== "Active" && user.role === "Administrator") {
    const remaining = await countActiveAdministrators(user._id);
    if (remaining === 0) {
      throw new ConflictError(
        "The last active administrator cannot be deactivated. Promote another administrator first.",
      );
    }
  }

  user.status = status;
  if (status === "Deactivated") {
    user.deactivatedAt = new Date();
    // Invalidate existing sessions immediately.
    await revokeAllUserTokens(user._id as Types.ObjectId);
  } else {
    user.deactivatedAt = null;
  }
  await user.save();

  await recordAudit({
    type: "team",
    message: `${user.name}'s account was marked ${status}.`,
    actorId,
    targetType: "user",
    targetId: user._id,
    metadata: { status },
  });

  return user;
}
