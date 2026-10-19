/**
 * Campaign metric rollups.
 *
 * Isolated from the campaign service so both the dispatcher and the webhook
 * processor can recompute metrics without a circular dependency. Counts are
 * derived from persisted recipient rows, so queued messages are never counted as
 * sent and the same message is never counted twice
 * (docs/starter-project.md §5.6).
 */

import { Types } from "mongoose";
import { CampaignModel } from "./campaign.model";
import { CampaignRecipientModel } from "./campaignRecipient.model";

export interface CampaignMetrics {
  attempted: number;
  sent: number;
  delivered: number;
  read: number | null;
  failed: number;
}

const ATTEMPTED = ["Attempted", "Sent", "Delivered", "Read", "Failed"];
const SENT = ["Sent", "Delivered", "Read"];
const DELIVERED = ["Delivered", "Read"];
const READ = ["Read"];

export async function computeCampaignMetrics(campaignId: string | Types.ObjectId): Promise<CampaignMetrics> {
  const rows = await CampaignRecipientModel.aggregate<{ _id: string; count: number }>([
    { $match: { campaignId: new Types.ObjectId(String(campaignId)) } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  const counts = new Map(rows.map((row) => [row._id, row.count]));
  const sum = (statuses: string[]) => statuses.reduce((total, status) => total + (counts.get(status) ?? 0), 0);

  const attempted = sum(ATTEMPTED);
  const hasReadData = (counts.get("Read") ?? 0) > 0;

  return {
    attempted,
    sent: sum(SENT),
    delivered: sum(DELIVERED),
    read: hasReadData ? sum(READ) : null,
    failed: sum(["Failed"]),
  };
}

export async function recomputeCampaignMetrics(campaignId: string | Types.ObjectId): Promise<CampaignMetrics> {
  const metrics = await computeCampaignMetrics(campaignId);
  await CampaignModel.updateOne({ _id: campaignId }, { $set: { metrics } });
  return metrics;
}

/** Mark a campaign Completed once no recipient is still queued or in flight. */
export async function maybeCompleteCampaign(campaignId: string | Types.ObjectId): Promise<boolean> {
  const pending = await CampaignRecipientModel.countDocuments({
    campaignId,
    status: { $in: ["Queued", "Attempted"] },
  });
  if (pending > 0) return false;

  const campaign = await CampaignModel.findById(campaignId).select("status sentAt");
  if (!campaign || !["Sending", "Scheduled"].includes(campaign.status)) return false;

  await recomputeCampaignMetrics(campaignId);
  await CampaignModel.updateOne(
    { _id: campaignId },
    { $set: { status: "Completed", completedAt: new Date(), sentAt: campaign.sentAt ?? new Date() } },
  );
  return true;
}
