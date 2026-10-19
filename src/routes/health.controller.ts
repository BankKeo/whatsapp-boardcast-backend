import type { Request, Response } from "express";
import mongoose from "mongoose";
import { sendSuccess } from "../common/http/respond";
import { env, whatsappIsSimulated } from "../config/env";

const startedAt = Date.now();

/** Liveness/readiness for the platform and the frontend health badge. */
export function health(_req: Request, res: Response): void {
  const databaseState = mongoose.connection.readyState;
  sendSuccess(res, {
    status: databaseState === 1 ? "ok" : "degraded",
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    database: databaseState === 1 ? "connected" : "disconnected",
    environment: env.NODE_ENV,
    whatsapp: {
      provider: env.WHATSAPP_PROVIDER,
      simulated: whatsappIsSimulated,
    },
  });
}
