/**
 * Authentication cookies.
 *
 * Refresh tokens live in an HTTP-only, SameSite cookie so browser JavaScript
 * never sees them (docs/starter-project.md §5.1). The access token is returned
 * in the response body and also set as a short-lived HTTP-only cookie as a
 * convenience for server-rendered clients.
 */

import type { CookieOptions, Response } from "express";
import { env } from "../../config/env";
import { parseDuration } from "../../common/utils/duration";

export const ACCESS_COOKIE = "pc_access";
export const REFRESH_COOKIE = "pc_refresh";

function baseCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    domain: env.COOKIE_DOMAIN || undefined,
  };
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

export function setAuthCookies(res: Response, tokens: IssuedTokens): void {
  const accessMaxAge = parseDuration(env.ACCESS_TOKEN_TTL);
  const refreshMaxAge = parseDuration(env.REFRESH_TOKEN_TTL);

  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...baseCookieOptions(),
    path: "/",
    maxAge: accessMaxAge,
  });

  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...baseCookieOptions(),
    // Scope the refresh token to the auth routes only.
    path: `${env.API_PREFIX}/auth`,
    maxAge: refreshMaxAge,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...baseCookieOptions(), path: "/" });
  res.clearCookie(REFRESH_COOKIE, {
    ...baseCookieOptions(),
    path: `${env.API_PREFIX}/auth`,
  });
}
