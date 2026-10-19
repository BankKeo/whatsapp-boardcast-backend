/**
 * Job processor registration.
 *
 * Wires concrete processors onto the queue without creating an import cycle
 * (the campaign module registers its dispatcher here; the queue itself has no
 * knowledge of campaigns). Scheduled-campaign sweeps live in the scheduler.
 */

import { queue } from "./queue";
import { dispatchCampaign } from "../campaigns/campaign.service";

let registered = false;

export function registerJobProcessors(): void {
  if (registered) return;
  registered = true;
  queue.configure({ concurrency: 4 });
  queue.register("campaign-dispatch", async (payload) => {
    await dispatchCampaign(String(payload));
  });
}
