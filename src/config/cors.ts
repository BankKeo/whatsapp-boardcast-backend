/**
 * CORS configuration.
 *
 * Only the explicitly configured browser origins may call the API
 * (docs/starter-project.md §8). Requests with no `Origin` (server-to-server,
 * health checks, curl) are allowed; an unknown browser origin is rejected.
 */

import type { CorsOptions } from "cors";
import { allowedOrigins } from "./env";

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin ${origin} is not allowed by CORS.`));
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id", "Idempotency-Key"],
  exposedHeaders: ["X-Request-Id"],
  maxAge: 600,
};
