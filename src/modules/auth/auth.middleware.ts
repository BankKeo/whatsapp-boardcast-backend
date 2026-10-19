/**
 * Authentication and authorization middleware.
 *
 * `authenticate` resolves the signed-in principal from the access token (bearer
 * header or HTTP-only cookie) and re-checks the account status and token version
 * on every request, so deactivation and password changes take effect immediately.
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";
import { UnauthorizedError, ForbiddenError } from "../../common/errors/AppError";
import type { UserRole } from "../../common/constants/domain";
import { UserModel } from "../users/user.model";
import { verifyAccessToken } from "./auth.service";
import { ACCESS_COOKIE } from "./auth.cookies";

function extractToken(req: Request): string | null {
  const header = req.header("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() || null;
  }
  const cookieToken = (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE];
  return cookieToken ?? null;
}

export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const token = extractToken(req);
    if (!token) throw new UnauthorizedError();

    const claims = verifyAccessToken(token);
    const user = await UserModel.findById(claims.sub);
    if (!user || user.status !== "Active") {
      throw new UnauthorizedError("This account is not active.");
    }
    if (user.tokenVersion !== claims.tv) {
      throw new UnauthorizedError("Your session is no longer valid. Please sign in again.");
    }

    req.auth = {
      userId: String(user._id),
      email: user.email,
      name: user.name,
      role: user.role as UserRole,
    };
    next();
  } catch (error) {
    next(error);
  }
};

/** Restrict a route to the given roles. Must run after `authenticate`. */
export function authorize(...roles: UserRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      next(new UnauthorizedError());
      return;
    }
    if (roles.length > 0 && !roles.includes(req.auth.role)) {
      next(new ForbiddenError(`This action requires one of: ${roles.join(", ")}.`));
      return;
    }
    next();
  };
}

/** Convenience: any authenticated user. */
export const requireAuth: RequestHandler[] = [authenticate];
