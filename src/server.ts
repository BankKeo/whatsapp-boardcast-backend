/**
 * Process entry point.
 *
 * Connects to MongoDB, starts the scheduler and HTTP listener, and shuts down
 * cleanly on SIGINT/SIGTERM (closing the listener and the database connection).
 */

import http from "node:http";
import { createApp } from "./app";
import { connectDatabase, disconnectDatabase } from "./config/database";
import { env, whatsappIsSimulated } from "./config/env";
import { logger } from "./config/logger";
import { startScheduler, stopScheduler } from "./modules/jobs/scheduler";
import { queue } from "./modules/jobs/queue";

async function main(): Promise<void> {
  await connectDatabase();

  const app = createApp();
  const server = http.createServer(app);

  server.listen(env.PORT, () => {
    logger.info(
      {
        port: env.PORT,
        prefix: env.API_PREFIX,
        environment: env.NODE_ENV,
        whatsappProvider: env.WHATSAPP_PROVIDER,
        simulated: whatsappIsSimulated,
        queue: queue.stats(),
      },
      "Partner Club API listening",
    );
    if (whatsappIsSimulated) {
      logger.warn("WhatsApp integration is running in SIMULATED mode — no real messages are sent.");
    }
  });

  startScheduler();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Shutting down");
    stopScheduler();
    server.close();
    await disconnectDatabase();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => logger.error({ err: reason }, "Unhandled promise rejection"));
  process.on("uncaughtException", (error) => {
    logger.error({ err: error }, "Uncaught exception");
    process.exit(1);
  });
}

void main().catch((error) => {
  logger.error({ err: error }, "Failed to start the server");
  process.exit(1);
});
