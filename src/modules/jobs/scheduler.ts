/**
 * Scheduled-campaign sweep.
 *
 * Periodically finds campaigns whose scheduled time has passed and hands them to
 * the dispatcher. In a production deployment this is a worker process (or a
 * BullMQ repeatable job); with the in-memory queue it is a lightweight interval
 * that keeps the lifecycle moving without blocking requests.
 */

import { logger } from "../../config/logger";
import { CampaignModel } from "../campaigns/campaign.model";
import { dispatchScheduledCampaign } from "../campaigns/campaign.service";
import { queue } from "./queue";

const SWEEP_INTERVAL_MS = 60_000;

let timer: NodeJS.Timeout | null = null;
let sweeping = false;

async function sweep(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    const due = await CampaignModel.find({
      status: "Scheduled",
      scheduledAt: { $ne: null, $lte: new Date() },
    }).select("_id");

    for (const campaign of due) {
      try {
        await dispatchScheduledCampaign(String(campaign._id));
      } catch (error) {
        logger.error({ err: error, campaignId: String(campaign._id) }, "Scheduled campaign dispatch failed");
      }
    }
  } catch (error) {
    logger.error({ err: error }, "Scheduled campaign sweep failed");
  } finally {
    sweeping = false;
  }
}

export function startScheduler(): void {
  if (timer) return;
  timer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);
  // Don't keep the process alive solely for the sweep timer.
  timer.unref?.();
  logger.info({ queue: queue.stats() }, "Scheduler started");
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
