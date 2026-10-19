import type { Request, Response } from "express";
import { sendSuccess } from "../../common/http/respond";
import { UserModel } from "../users/user.model";
import { recordAudit } from "../audit-logs/auditLog.service";
import { clearAuthCookies, setAuthCookies, REFRESH_COOKIE } from "./auth.cookies";
import * as authService from "./auth.service";
import type { loginSchema, changePasswordSchema } from "./auth.schema";
import type { z } from "zod";

function sessionMeta(req: Request) {
  return { ip: req.ip ?? null, userAgent: req.header("user-agent") ?? null };
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.validated?.body as z.infer<typeof loginSchema>;
  const { user, tokens } = await authService.login(email, password, sessionMeta(req));
  setAuthCookies(res, tokens);

  await recordAudit({
    type: "auth",
    message: `${user.name} signed in.`,
    actorId: user._id,
    actorName: user.name,
    ip: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
  });

  sendSuccess(res, {
    user: authService.sanitizeUser(user),
    accessToken: tokens.accessToken,
    accessExpiresAt: tokens.accessExpiresAt.toISOString(),
  });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const body = (req.validated?.body ?? {}) as { refreshToken?: string };
  const cookieToken = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  const raw = body.refreshToken ?? cookieToken;
  if (!raw) {
    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "A refresh token is required.", details: [] },
    });
    return;
  }

  const { user, tokens } = await authService.rotateRefreshToken(raw, sessionMeta(req));
  setAuthCookies(res, tokens);
  sendSuccess(res, {
    user: authService.sanitizeUser(user),
    accessToken: tokens.accessToken,
    accessExpiresAt: tokens.accessExpiresAt.toISOString(),
  });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const body = (req.validated?.body ?? {}) as { refreshToken?: string };
  const cookieToken = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  await authService.revokeRefreshToken(body.refreshToken ?? cookieToken);
  clearAuthCookies(res);

  if (req.auth) {
    await recordAudit({
      type: "auth",
      message: `${req.auth.name} signed out.`,
      actorId: req.auth.userId,
      actorName: req.auth.name,
      ip: req.ip ?? null,
    });
  }

  sendSuccess(res, { loggedOut: true });
}

export async function me(req: Request, res: Response): Promise<void> {
  const user = await UserModel.findById(req.auth!.userId);
  if (!user) {
    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "This account is not active.", details: [] },
    });
    return;
  }
  sendSuccess(res, authService.sanitizeUser(user));
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const { currentPassword, newPassword } = req.validated?.body as z.infer<typeof changePasswordSchema>;
  const user = await UserModel.findById(req.auth!.userId);
  if (!user) {
    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "This account is not active.", details: [] },
    });
    return;
  }

  await authService.changePassword(user, currentPassword, newPassword);
  clearAuthCookies(res);

  await recordAudit({
    type: "auth",
    message: `${user.name} changed their password.`,
    actorId: user._id,
    actorName: user.name,
    ip: req.ip ?? null,
  });

  sendSuccess(res, { passwordChanged: true, reauthenticate: true });
}
