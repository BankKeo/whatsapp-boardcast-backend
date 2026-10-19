/**
 * Express request augmentation.
 *
 * `auth` is attached by the authentication middleware after verifying the access
 * token; `validated` holds the parsed result of the Zod validation middleware so
 * controllers never read unvalidated input.
 */

import type { AuthContext } from "../auth/auth.types";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
      validated?: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

export {};
