/**
 * Zod schemas for user / team administration.
 * Mirrors `whatsapp-boardcast-dashboard/lib/schemas/team.ts`.
 */

import { z } from "zod";
import { USER_ROLES, USER_STATUSES } from "../../common/constants/domain";

export const userInviteSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Enter the team member's full name.")
    .max(80, "Name must be 80 characters or fewer."),
  email: z.string().trim().toLowerCase().email("Enter a valid work email address."),
  role: z.enum(USER_ROLES, "Select a role."),
});

export type UserInviteValues = z.infer<typeof userInviteSchema>;

/**
 * Admin-created team member. A temporary password may be supplied (the account
 * becomes Active); otherwise the member is `Invited` and cannot sign in until an
 * administrator activates the account.
 */
export const userCreateSchema = userInviteSchema.extend({
  password: z
    .string()
    .min(10, "Temporary password must be at least 10 characters.")
    .max(200)
    .optional(),
  status: z.enum(USER_STATUSES).default("Invited"),
});

export type UserCreateValues = z.infer<typeof userCreateSchema>;

export const userUpdateSchema = z.object({
  name: userInviteSchema.shape.name.optional(),
  role: z.enum(USER_ROLES).optional(),
});

export const userStatusSchema = z.object({
  status: z.enum(USER_STATUSES),
});

export const PASSWORD_MIN = 10;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: z
      .string()
      .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters.`)
      .max(200),
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: "Choose a password different from the current one.",
    path: ["newPassword"],
  });

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export const userListQuerySchema = z.object({
  search: z.string().trim().default(""),
  role: z.union([z.enum(USER_ROLES), z.literal("all")]).default("all"),
  status: z.union([z.enum(USER_STATUSES), z.literal("all")]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
