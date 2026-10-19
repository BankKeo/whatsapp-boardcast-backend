/**
 * MongoDB connection management.
 *
 * One shared connection for the process. Connection events are logged so a
 * dropped database is visible in production, and `connectDatabase()` retries
 * with capped exponential backoff before giving up.
 */

import mongoose from "mongoose";
import { env, isTest } from "./env";
import { logger } from "./logger";

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let listenersBound = false;

function bindConnectionEvents(): void {
  if (listenersBound) return;
  listenersBound = true;

  mongoose.connection.on("connected", () => logger.info("MongoDB connected"));
  mongoose.connection.on("disconnected", () => logger.warn("MongoDB disconnected"));
  mongoose.connection.on("reconnected", () => logger.info("MongoDB reconnected"));
  mongoose.connection.on("error", (error) => logger.error({ err: error }, "MongoDB error"));
}

export async function connectDatabase(uri: string = env.MONGODB_URI): Promise<typeof mongoose> {
  bindConnectionEvents();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await mongoose.connect(uri, {
        // Fail quickly instead of buffering requests for an unreachable server.
        serverSelectionTimeoutMS: isTest ? 5_000 : 10_000,
        autoIndex: !isTest,
      });
      return mongoose;
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) {
        logger.error({ err: error, attempt }, "Unable to connect to MongoDB");
        throw error;
      }
      const delayMs = BASE_DELAY_MS * 2 ** (attempt - 1);
      logger.warn({ attempt, delayMs }, "MongoDB connection failed, retrying");
      await delay(delayMs);
    }
  }

  throw new Error("Unreachable");
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
}
