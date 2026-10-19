/**
 * Express application wiring.
 *
 * Ordered as docs/starter-project.md §8 requires: security headers, explicit CORS
 * allowlist, body limits, correlation ids, structured request logging, rate
 * limiting, the versioned API router, then the 404 and error handlers.
 */

import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { corsOptions } from "./config/cors";
import { apiRouter } from "./routes";
import { requestContext } from "./common/middleware/requestContext";
import { globalRateLimiter } from "./common/middleware/rateLimit";
import { notFoundHandler } from "./common/middleware/notFound";
import { errorHandler } from "./common/middleware/errorHandler";
import { registerJobProcessors } from "./modules/jobs/processors";

export function createApp(): Express {
  registerJobProcessors();

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(cors(corsOptions));
  app.use(requestContext);
  app.use(
    pinoHttp({
      logger,
      // The raw body is retained only for webhook signature verification.
      genReqId: (req) => (req as express.Request).requestId ?? "unknown",
    }),
  );

  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buffer) => {
        (req as express.Request & { rawBody?: string }).rawBody = buffer.toString("utf8");
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
  app.use(cookieParser());
  app.use(globalRateLimiter);

  app.get("/", (_req, res) => {
    res.json({
      success: true,
      data: {
        service: "Partner Club WhatsApp Marketing System API",
        version: env.API_PREFIX,
        documentation: "See README.md for the endpoint contract.",
      },
    });
  });

  app.use(env.API_PREFIX, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
