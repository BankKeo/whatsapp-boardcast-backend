import type { UserRole } from "../constants/domain";

/** Authenticated principal resolved from a valid access token. */
export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
}

/** Claims embedded in the short-lived access JWT. */
export interface AccessTokenClaims {
  sub: string;
  email: string;
  role: UserRole;
  /** Bumped on password change so previously issued tokens can be rejected. */
  tv: number;
  type: "access";
}
