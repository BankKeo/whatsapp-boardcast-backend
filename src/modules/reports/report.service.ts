/**
 * Reporting service.
 *
 * All figures are aggregated from persisted campaign and recipient records
 * (docs/starter-project.md §5.6). Attempted, sent, delivered, read and failed
 * counts are kept distinct — queued messages are never counted as sent and each
 * message is counted once. Date-range and dimension filters are applied server
 * side, and province/category breakdowns join recipient rows to their outlet.
 */

import { Types, type PipelineStage } from "mongoose";
import { CampaignModel } from "../campaigns/campaign.model";
import { CampaignRecipientModel } from "../campaigns/campaignRecipient.model";
import { OutletModel } from "../outlets/outlet.model";
import { outletStats } from "../outlets/outlet.service";
import { toCsv } from "../../common/utils/csv";
import { PROVINCES } from "../../common/constants/laos";
import { OUTLET_CATEGORIES } from "../../common/constants/domain";
import type { ReportFailureQuery, ReportFilters } from "./report.schema";

const ATTEMPTED = ["Attempted", "Sent", "Delivered", "Read", "Failed"];

function dateMatch(range: { from: Date | null; to: Date | null }, field = "createdAt") {
  if (!range.from && !range.to) return {};
  const bounds: Record<string, Date> = {};
  if (range.from) bounds.$gte = range.from;
  if (range.to) bounds.$lte = range.to;
  return { [field]: bounds };
}

function recipientMatch(filters: ReportFilters): Record<string, unknown> {
  const match: Record<string, unknown> = { status: { $in: ATTEMPTED } };
  if (filters.campaignId) match.campaignId = new Types.ObjectId(filters.campaignId);
  Object.assign(match, dateMatch({ from: filters.from, to: filters.to }));
  return match;
}

const COUNTS_STAGE: PipelineStage.Group = {
  $group: {
    _id: null,
    attempted: { $sum: { $cond: [{ $in: ["$status", ATTEMPTED] }, 1, 0] } },
    sent: { $sum: { $cond: [{ $in: ["$status", ["Sent", "Delivered", "Read"]] }, 1, 0] } },
    delivered: { $sum: { $cond: [{ $in: ["$status", ["Delivered", "Read"]] }, 1, 0] } },
    read: { $sum: { $cond: [{ $eq: ["$status", "Read"] }, 1, 0] } },
    failed: { $sum: { $cond: [{ $eq: ["$status", "Failed"] }, 1, 0] } },
  },
};

export async function reportOverview(filters: ReportFilters) {
  const [counts] = await CampaignRecipientModel.aggregate([
    { $match: recipientMatch(filters) },
    COUNTS_STAGE,
  ]);

  const campaignFilter: Record<string, unknown> = {
    status: { $in: ["Completed", "Sending", "Failed"] },
    ...dateMatch({ from: filters.from, to: filters.to }, "createdAt"),
  };
  const campaignsReported = await CampaignModel.countDocuments(campaignFilter);

  const outletAggregates = await outletStats();

  const attempted = counts?.attempted ?? 0;
  const delivered = counts?.delivered ?? 0;
  const sent = counts?.sent ?? 0;

  return {
    outlets: {
      total: outletAggregates.total,
      eligible: outletAggregates.eligible,
      consented: outletAggregates.consented,
      complete: outletAggregates.complete,
      needsReview: outletAggregates.needsReview,
      incomplete: outletAggregates.incomplete,
    },
    campaigns: { reported: campaignsReported },
    messages: {
      attempted,
      sent,
      delivered,
      read: counts?.read ?? 0,
      failed: counts?.failed ?? 0,
    },
    deliveryRate: attempted > 0 ? delivered / attempted : 0,
    readRate: delivered > 0 ? (counts?.read ?? 0) / delivered : 0,
    readAvailable: sent > 0 && (counts?.read ?? 0) > 0,
  };
}

export async function campaignPerformance(filters: ReportFilters) {
  const match = recipientMatch(filters);
  const rows = await CampaignRecipientModel.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$campaignId",
        attempted: { $sum: { $cond: [{ $in: ["$status", ATTEMPTED] }, 1, 0] } },
        sent: { $sum: { $cond: [{ $in: ["$status", ["Sent", "Delivered", "Read"]] }, 1, 0] } },
        delivered: { $sum: { $cond: [{ $in: ["$status", ["Delivered", "Read"]] }, 1, 0] } },
        read: { $sum: { $cond: [{ $eq: ["$status", "Read"] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ["$status", "Failed"] }, 1, 0] } },
      },
    },
    { $lookup: { from: "campaigns", localField: "_id", foreignField: "_id", as: "campaign" } },
    { $unwind: "$campaign" },
    {
      $project: {
        _id: 0,
        campaignId: { $toString: "$_id" },
        name: "$campaign.name",
        status: "$campaign.status",
        owner: "$campaign.owner",
        createdAt: "$campaign.createdAt",
        sentAt: "$campaign.sentAt",
        scheduledAt: "$campaign.scheduledAt",
        recipients: "$campaign.recipients",
        attempted: 1,
        sent: 1,
        delivered: 1,
        read: 1,
        failed: 1,
      },
    },
    { $sort: { sentAt: -1, createdAt: -1 } },
  ]);

  return rows.map((row) => ({
    ...row,
    deliveryRate: row.attempted > 0 ? row.delivered / row.attempted : 0,
    readRate: row.delivered > 0 ? row.read / row.delivered : 0,
  }));
}

async function groupPerformance(filters: ReportFilters, dimension: "province" | "category") {
  const match = recipientMatch(filters);
  const afterUnwind: PipelineStage[] = [
    { $lookup: { from: OutletModel.collection.name, localField: "outletId", foreignField: "_id", as: "outlet" } },
    { $unwind: "$outlet" },
  ];
  if (dimension === "province" && filters.province) afterUnwind.push({ $match: { "outlet.province": filters.province } });
  if (dimension === "category" && filters.category) afterUnwind.push({ $match: { "outlet.category": filters.category } });
  afterUnwind.push({
    $group: {
      _id: `$outlet.${dimension}`,
      attempted: { $sum: { $cond: [{ $in: ["$status", ATTEMPTED] }, 1, 0] } },
      sent: { $sum: { $cond: [{ $in: ["$status", ["Sent", "Delivered", "Read"]] }, 1, 0] } },
      delivered: { $sum: { $cond: [{ $in: ["$status", ["Delivered", "Read"]] }, 1, 0] } },
      read: { $sum: { $cond: [{ $eq: ["$status", "Read"] }, 1, 0] } },
      failed: { $sum: { $cond: [{ $eq: ["$status", "Failed"] }, 1, 0] } },
      campaigns: { $addToSet: "$campaignId" },
    },
  });

  const rows = await CampaignRecipientModel.aggregate([
    { $match: match },
    ...afterUnwind,
    {
      $project: {
        _id: 0,
        key: "$_id",
        attempted: 1,
        sent: 1,
        delivered: 1,
        read: 1,
        failed: 1,
        campaigns: { $size: "$campaigns" },
      },
    },
    { $sort: { delivered: -1 } },
  ]);

  const known = dimension === "province" ? PROVINCES.map((p) => p.name) : [...OUTLET_CATEGORIES];
  const byKey = new Map(rows.map((row) => [row.key as string, row]));

  return known.map((key) => {
    const row = byKey.get(key) ?? {
      key,
      attempted: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      campaigns: 0,
    };
    return {
      key,
      label: key,
      ...row,
      deliveryRate: row.attempted > 0 ? row.delivered / row.attempted : 0,
      readRate: row.delivered > 0 ? row.read / row.delivered : 0,
    };
  });
}

export function provincePerformance(filters: ReportFilters) {
  return groupPerformance(filters, "province");
}

export function categoryPerformance(filters: ReportFilters) {
  return groupPerformance(filters, "category");
}

export async function messageFailures(filters: ReportFailureQuery) {
  const match: Record<string, unknown> = {
    status: "Failed",
    ...(filters.campaignId ? { campaignId: new Types.ObjectId(filters.campaignId) } : {}),
    ...dateMatch({ from: filters.from, to: filters.to }),
  };

  const groups = await CampaignRecipientModel.aggregate([
    { $match: match },
    { $group: { _id: { code: "$failureCode", reason: "$failureReason" }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 25 },
  ]);

  const skip = (filters.page - 1) * filters.limit;
  const [items, total] = await Promise.all([
    CampaignRecipientModel.find(match as never)
      .sort({ failedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(filters.limit),
    CampaignRecipientModel.countDocuments(match as never),
  ]);

  return {
    summary: groups.map((group) => ({
      code: group._id?.code ?? "UNKNOWN",
      reason: group._id?.reason ?? null,
      count: group.count,
    })),
    items: items.map((doc) => ({
      id: String(doc._id),
      campaignId: String(doc.campaignId),
      outletId: String(doc.outletId),
      outletName: doc.outletNameSnapshot,
      status: doc.status,
      failureCode: doc.failureCode ?? null,
      failureReason: doc.failureReason ?? null,
      failedAt: doc.failedAt ?? null,
    })),
    total,
  };
}

export async function exportReportCsv(filters: ReportFilters, now = new Date()): Promise<string> {
  const rows = await campaignPerformance(filters);
  const headers = [
    "Campaign",
    "Status",
    "Owner",
    "Recipients",
    "Attempted",
    "Sent",
    "Delivered",
    "Read",
    "Failed",
    "Delivery Rate",
    "Read Rate",
  ];
  const body = rows.map((row) => [
    row.name ?? "",
    row.status ?? "",
    row.owner ?? "",
    row.recipients ?? 0,
    row.attempted,
    row.sent,
    row.delivered,
    row.read,
    row.failed,
    `${(row.deliveryRate * 100).toFixed(2)}%`,
    `${(row.readRate * 100).toFixed(2)}%`,
  ]);

  const footer = [
    `# Generated ${now.toISOString()}`,
    `# Note: metrics are derived from persisted recipient statuses. Mock-provider values are simulated, not real delivery evidence.`,
  ];
  return `${toCsv(headers, body)}${footer.join("\r\n")}\r\n`;
}
