/**
 * Zod schemas for authentication requests (docs/starter-project.md §5.1, §9).
 */

import { z } from "zod";
import { PASSWORD_MIN } from "../users/user.schema";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password.").max(200),
});

export type LoginValues = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  /** Optional when the refresh token is supplied in the HTTP-only cookie. */
  refreshToken: z.string().min(1).optional(),
});

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

export const logoutSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});
