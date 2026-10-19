/**
 * Mock / demo dataset seeder.
 *
 * Creates a small, deterministic dataset for local development and UI review:
 * **10 records for each entity collection** (users, outlets, segments, message
 * templates, campaigns, campaign recipients, import jobs, audit logs).
 *
 * Reference and configuration collections are seeded in full because they are
 * not "mock rows": the complete Lao province/district list (18 provinces) and
 * every application-settings key (9 sections).
 *
 * All contact details are obviously fictional. Never seed real customer data.
 *
 * Usage:
 *   npm run seed:mock            # wipe demo collections, then seed
 *   npm run seed:mock -- --keep  # add to existing data without wiping
 */

import { connectDatabase, disconnectDatabase } from "../src/config/database";
import { env } from "../src/config/env";
import { logger } from "../src/config/logger";
import { hashPassword } from "../src/common/utils/password";
import { normalizeLaoPhone } from "../src/common/utils/phone";
import { PROVINCES } from "../src/common/constants/laos";
import { OUTLET_CATEGORIES, TEMPLATE_VARIABLE_LIBRARY } from "../src/common/constants/domain";
import { UserModel } from "../src/modules/users/user.model";
import { ProvinceModel } from "../src/modules/outlets/province.model";
import { OutletModel } from "../src/modules/outlets/outlet.model";
import { SegmentModel } from "../src/modules/segments/segment.model";
import { MessageTemplateModel } from "../src/modules/templates/template.model";
import { CampaignModel } from "../src/modules/campaigns/campaign.model";
import { CampaignRecipientModel } from "../src/modules/campaigns/campaignRecipient.model";
import { ImportJobModel } from "../src/modules/imports/importJob.model";
import { ApplicationSettingModel, SETTING_KEYS } from "../src/modules/settings/applicationSetting.model";
import { defaultSections } from "../src/modules/settings/setting.schema";
import { AuditLogModel } from "../src/modules/audit-logs/auditLog.model";
import { RefreshTokenModel } from "../src/modules/auth/refreshToken.model";
import { WebhookEventModel } from "../src/modules/whatsapp/webhookEvent.model";
import {
  audienceBreakdown,
  refreshDuplicateFlags,
  type OutletFilterInput,
} from "../src/modules/outlets/outlet.service";
import { recomputeCampaignMetrics } from "../src/modules/campaigns/campaign.metrics";

const COUNT = 10;

/* Deterministic RNG so repeated seeds produce the same demo dataset. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261019);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
const pad = (value: number, size: number): string => String(value).padStart(size, "0");

function iso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

function fakePhone(index: number): string {
  return normalizeLaoPhone(`+856 20 ${pad(5000 + (index % 4000), 4)} ${pad(1000 + ((index * 37) % 9000), 4)}`)!;
}

/**
 * Drop text indexes that still use the legacy `language` override and rebuild
 * them from the current schema. `syncIndexes()` does not detect an option-only
 * change, so this must be done explicitly for existing databases.
 */
async function ensureTextIndexes(): Promise<void> {
  for (const model of [MessageTemplateModel, CampaignModel]) {
    const indexes = await model.collection.indexes().catch(() => []);
    for (const index of indexes) {
      if (index.language_override === "language" && index.name) {
        await model.collection.dropIndex(index.name).catch(() => undefined);
      }
    }
    await model.createIndexes();
  }
}

async function wipe(): Promise<void> {
  await Promise.all([
    OutletModel.deleteMany({}),
    SegmentModel.deleteMany({}),
    MessageTemplateModel.deleteMany({}),
    CampaignModel.deleteMany({}),
    CampaignRecipientModel.deleteMany({}),
    ImportJobModel.deleteMany({}),
    ProvinceModel.deleteMany({}),
    ApplicationSettingModel.deleteMany({}),
    AuditLogModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
    WebhookEventModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);
  logger.info("Cleared existing collections");
}

/* ------------------------------------------------------------------ */
/* Users — 10                                                         */
/* ------------------------------------------------------------------ */

async function seedUsers(keep: boolean) {
  const passwordHash = await hashPassword(env.SEED_ADMIN_PASSWORD);

  const seeds = [
    { name: env.SEED_ADMIN_NAME, email: env.SEED_ADMIN_EMAIL, role: "Administrator", status: "Active", activeDaysAgo: 0 },
    { name: "Bounmy Phommaly", email: "bounmy.phommaly@partnerclub.local", role: "Marketing Manager", status: "Active", activeDaysAgo: 1 },
    { name: "Khamla Sisouphan", email: "khamla.sisouphan@partnerclub.local", role: "Campaign Creator", status: "Active", activeDaysAgo: 2 },
    { name: "Malee Inthavong", email: "malee.inthavong@partnerclub.local", role: "Read-Only Analyst", status: "Active", activeDaysAgo: 3 },
    { name: "Somsanith Vongsa", email: "somsanith.vongsa@partnerclub.local", role: "Marketing Manager", status: "Active", activeDaysAgo: 5 },
    { name: "Anousone Chanthavong", email: "anousone.chanthavong@partnerclub.local", role: "Campaign Creator", status: "Invited", activeDaysAgo: null },
    { name: "Vilay Keomany", email: "vilay.keomany@partnerclub.local", role: "Read-Only Analyst", status: "Active", activeDaysAgo: 8 },
    { name: "Sengphet Douangdara", email: "sengphet.douangdara@partnerclub.local", role: "Campaign Creator", status: "Active", activeDaysAgo: 11 },
    { name: "Noy Thammavong", email: "noy.thammavong@partnerclub.local", role: "Marketing Manager", status: "Invited", activeDaysAgo: null },
    { name: "Phoutthasone Inthavong", email: "phoutthasone.inthavong@partnerclub.local", role: "Administrator", status: "Active", activeDaysAgo: 14 },
  ] as const;

  if (keep) {
    // Upsert by email so `--keep` is safe to run repeatedly.
    for (const seed of seeds) {
      await UserModel.updateOne(
        { email: seed.email },
        {
          $set: {
            name: seed.name,
            role: seed.role,
            status: seed.status,
            passwordHash: seed.status === "Active" ? passwordHash : null,
            invitedAt: new Date(iso(30)),
            lastActive: seed.activeDaysAgo === null ? null : new Date(iso(seed.activeDaysAgo)),
            lastLoginAt: seed.activeDaysAgo === null ? null : new Date(iso(seed.activeDaysAgo)),
          },
        },
        { upsert: true, setDefaultsOnInsert: true },
      );
    }
  } else {
    await UserModel.insertMany(
      seeds.map((seed) => ({
        name: seed.name,
        email: seed.email,
        role: seed.role,
        status: seed.status,
        passwordHash: seed.status === "Active" ? passwordHash : null,
        invitedAt: new Date(iso(30)),
        lastActive: seed.activeDaysAgo === null ? null : new Date(iso(seed.activeDaysAgo)),
        lastLoginAt: seed.activeDaysAgo === null ? null : new Date(iso(seed.activeDaysAgo)),
      })),
    );
  }

  const admin = await UserModel.findOne({ email: env.SEED_ADMIN_EMAIL });
  logger.info({ count: seeds.length }, "Seeded users (admin + 9 team members)");
  return admin!;
}

/* ------------------------------------------------------------------ */
/* Outlets — 10                                                       */
/* ------------------------------------------------------------------ */

const OUTLET_SEEDS = [
  { name: "Sok Dee Mini Mart", owner: "Khamla S.", category: "Off-Trade", phone: true, verified: true, consent: true, revoked: false, status: "Active", channel: "Field team" },
  { name: "Mekong Beer Garden", owner: "Bounmy P.", category: "On-Trade", phone: true, verified: true, consent: true, revoked: false, status: "Active", channel: "Partner referral" },
  { name: "Phonxay Restaurant", owner: "Somsanith V.", category: "On-Trade", phone: true, verified: false, consent: true, revoked: false, status: "Pending Review", channel: "Field team" },
  { name: "Baan Grocery Wholesale", owner: "Malee I.", category: "Modern Trade", phone: true, verified: true, consent: false, revoked: false, status: "Active", channel: "Distributor list" },
  { name: "Nam Ngum Guesthouse Café", owner: "Anousone C.", category: "On-Trade", phone: false, verified: false, consent: false, revoked: false, status: "Pending Review", channel: "Field team" },
  { name: "Vangvieng Night Market Stall", owner: "Vilay K.", category: "Off-Trade", phone: "invalid", verified: false, consent: true, revoked: false, status: "Inactive", channel: "CSV import" },
  { name: "Sabai Karaoke Bar", owner: "Sengphet D.", category: "On-Trade", phone: "shared", verified: true, consent: true, revoked: false, status: "Active", channel: "Partner referral" },
  { name: "Tha Deua Mini Mart", owner: "Noy T.", category: "Off-Trade", phone: "shared", verified: true, consent: true, revoked: false, status: "Active", channel: "Field team" },
  { name: "Khamla Beer Garden", owner: "Phoutthasone I.", category: "On-Trade", phone: true, verified: true, consent: true, revoked: true, status: "Active", channel: "Partner referral" },
  { name: "Lao Star Modern Trade", owner: "Khamla S.", category: "Modern Trade", phone: true, verified: true, consent: true, revoked: false, status: "Active", channel: "Distributor list" },
] as const;

async function seedOutlets(adminId: string) {
  const sharedPhone = fakePhone(900);
  const docs = OUTLET_SEEDS.slice(0, COUNT).map((seed, index) => {
    const province = PROVINCES[index % PROVINCES.length];
    const district = province.districts[index % province.districts.length];
    const phone = seed.phone === true ? fakePhone(index) : seed.phone === "shared" ? sharedPhone : seed.phone === "invalid" ? "020-0000" : "";

    return {
      name: seed.name,
      ownerName: seed.owner,
      phone,
      province: province.name,
      district,
      village: `Ban ${pick(["Phonxay", "Sikhottabong", "Khamma", "Tha Deua", "Nongbone", "Phonthan"])}`,
      address: `Unit ${index + 1}, ${district}, ${province.name}`,
      category: seed.category,
      status: seed.status,
      channel: seed.channel,
      whatsappVerified: seed.verified,
      marketingConsent: seed.consent,
      consentRecordedAt: seed.consent ? new Date(iso(20 + index)) : null,
      consentSource: seed.consent ? pick(["Field team form", "Partner Club registration", "Distributor list"]) : null,
      consentRevokedAt: seed.revoked ? new Date(iso(2)) : null,
      notes: index % 5 === 0 ? "Demo record — replace before production use." : "",
      lastUpdatedBy: adminId,
    };
  });

  await OutletModel.insertMany(docs);
  await refreshDuplicateFlags();
  logger.info({ count: docs.length }, "Seeded outlets (incl. missing/invalid/duplicate/opted-out cases)");
}

/* ------------------------------------------------------------------ */
/* Segments — 10                                                      */
/* ------------------------------------------------------------------ */

const SEGMENT_SEEDS = [
  { name: "Vientiane on-trade — consented", description: "On-trade partners in Vientiane Capital with marketing consent and a valid number.", filters: { provinces: ["Vientiane Capital"], categories: ["On-Trade"], consent: "consented", eligibility: "eligible" } },
  { name: "Savannakhet off-trade", description: "Off-trade outlets in Savannakhet province.", filters: { provinces: ["Savannakhet"], categories: ["Off-Trade"] } },
  { name: "Champasack partners", description: "All partner outlets registered in Champasack.", filters: { provinces: ["Champasack"] } },
  { name: "Modern trade network", description: "Supermarkets and modern-trade accounts.", filters: { categories: ["Modern Trade"] } },
  { name: "Needs review", description: "Outlets with unverified numbers, missing consent or duplicates.", filters: { dataQuality: "Needs review" } },
  { name: "Incomplete records", description: "Outlets with missing or invalid phone numbers.", filters: { dataQuality: "Incomplete" } },
  { name: "Opted out", description: "Partners who withdrew marketing consent — excluded from sends.", filters: { consent: "not-consented" } },
  { name: "WhatsApp verified", description: "Outlets with a verified WhatsApp number.", filters: { eligibility: "eligible" } },
  { name: "Missing phone numbers", description: "Records that still need a contact number.", filters: { phoneStatus: "Missing" } },
  { name: "All field-team outlets", description: "Outlets captured by the field team, across all provinces.", filters: { search: "Ban" } },
] as const;

async function seedSegments(adminId: string) {
  const docs = [];
  for (const [index, seed] of SEGMENT_SEEDS.slice(0, COUNT).entries()) {
    const breakdown = await audienceBreakdown(seed.filters as unknown as OutletFilterInput);
    docs.push({
      name: seed.name,
      description: seed.description,
      filters: seed.filters,
      createdBy: adminId,
      updatedBy: adminId,
      lastMatchCount: breakdown.matched,
      lastPreviewedAt: new Date(iso(index)),
    });
  }
  await SegmentModel.insertMany(docs);
  logger.info({ count: docs.length }, "Seeded audience segments");
}

/* ------------------------------------------------------------------ */
/* Message templates — 10                                             */
/* ------------------------------------------------------------------ */

const TEMPLATE_SEEDS = [
  { name: "Seasonal Promotion (EN)", category: "Seasonal Promotion", language: "en", status: "Approved", body: "Hello {{1}}, {{2}} from {{3}}! Our Partner Club seasonal promotion runs {{4}}. Reference {{5}}. Show this message at the counter to redeem. Contact {{6}} for details.", vars: ["{{1}}", "{{2}}", "{{3}}", "{{4}}", "{{5}}", "{{6}}"] },
  { name: "New Product Announcement (LO)", category: "New Product Announcement", language: "lo", status: "Approved", body: "ສະບາຍດີ {{1}}! ສິນຄ້າໃໝ່ຂອງພວກເຮົາພ້ອມແລ້ວ. ອ້າງອີງ {{5}}.", vars: ["{{1}}", "{{5}}"] },
  { name: "Partner Club Update (EN)", category: "Partner Club Update", language: "en", status: "Approved", body: "Dear {{1}}, here is the latest Partner Club update for {{3}}. Reference {{5}}.", vars: ["{{1}}", "{{3}}", "{{5}}"] },
  { name: "Promotional Reminder (LO)", category: "Promotional Reminder", language: "lo", status: "Approved", body: "ສະບາຍດີ {{1}}! ການສົ່ງເສີມຂອງພວກເຮົາຈະສິ້ນສຸດໃນ {{4}}. ອ້າງອີງ {{5}}.", vars: ["{{1}}", "{{4}}", "{{5}}"] },
  { name: "Lao New Year Greeting (LO)", category: "Seasonal Promotion", language: "lo", status: "Approved", body: "ສະບາຍດີປີໃໝ່ {{1}}! ຂອບໃຈທີ່ເປັນຄູ່ຮ່ວມງານກັບ {{3}}. ອ້າງອີງ {{5}}.", vars: ["{{1}}", "{{3}}", "{{5}}"] },
  { name: "Outlet Re-engagement (EN)", category: "Partner Club Update", language: "en", status: "Approved", body: "Hello {{1}}, we have missed you at Partner Club! Call {{6}} to reactivate your account.", vars: ["{{1}}", "{{6}}"] },
  { name: "Weekend Promotion (EN)", category: "Promotional Reminder", language: "en", status: "Approved", body: "Hi {{1}}, this weekend only at {{3}}! Reference {{5}} — show this message to redeem.", vars: ["{{1}}", "{{3}}", "{{5}}"] },
  { name: "New Product Launch (EN)", category: "New Product Announcement", language: "en", status: "Pending Approval", body: "Hello {{1}}, a new product is launching in {{3}} during {{4}}. Ask your distributor for details.", vars: ["{{1}}", "{{3}}", "{{4}}"] },
  { name: "Distributor Notice (LO)", category: "Partner Club Update", language: "lo", status: "Pending Approval", body: "ສະບາຍດີ {{1}}! ແຈ້ງການສຳລັບຜູ້ຈຳໜ່າຍໃນ {{3}}. ອ້າງອີງ {{5}}.", vars: ["{{1}}", "{{3}}", "{{5}}"] },
  { name: "Partner Club Update (draft)", category: "Partner Club Update", language: "en", status: "Draft", body: "Dear {{1}}, here is the latest Partner Club update for {{3}}.", vars: ["{{1}}", "{{3}}"] },
] as const;

async function seedTemplates(adminId: string) {
  const docs = TEMPLATE_SEEDS.slice(0, COUNT).map((seed, index) => ({
    name: seed.name,
    category: seed.category,
    language: seed.language,
    body: seed.body,
    variables: seed.vars.map((key) => {
      const match = TEMPLATE_VARIABLE_LIBRARY.find((variable) => variable.key === key);
      return { key, label: match?.label ?? key, example: match?.example ?? "—" };
    }),
    status: seed.status,
    approvalStatus: seed.status,
    externalApprovalId: seed.status === "Approved" ? `local-approval-mock-${index + 1}` : null,
    notes: seed.status === "Approved" ? "Approved locally for demonstration; not a Meta approval." : "",
    usageCount: seed.status === "Approved" ? index % 4 : 0,
    createdBy: adminId,
    updatedBy: adminId,
  }));
  const inserted = await MessageTemplateModel.insertMany(docs);
  logger.info({ count: inserted.length }, "Seeded message templates");
  return inserted;
}

/* ------------------------------------------------------------------ */
/* Campaigns + recipients — 10 each                                   */
/* ------------------------------------------------------------------ */

const CAMPAIGN_SEEDS = [
  { name: "December on-trade push", status: "Draft", objective: "Seasonal promotion", language: "en" },
  { name: "New product launch — Vientiane", status: "Pending Approval", objective: "New product announcement", language: "lo" },
  { name: "New Year reminder — Savannakhet", status: "Scheduled", objective: "Promotional reminder", language: "en" },
  { name: "Partner Club weekly update", status: "Sending", objective: "Partner Club update", language: "en" },
  { name: "Partner Club launch", status: "Completed", objective: "Partner Club update", language: "lo" },
  { name: "Rainy season promotion", status: "Cancelled", objective: "Seasonal promotion", language: "en" },
  { name: "Distributor outreach", status: "Failed", objective: "Outlet re-engagement", language: "lo" },
  { name: "Modern trade onboarding", status: "Draft", objective: "Partner Club update", language: "en" },
  { name: "Lao New Year greeting", status: "Pending Approval", objective: "Seasonal promotion", language: "lo" },
  { name: "Q1 re-engagement", status: "Scheduled", objective: "Outlet re-engagement", language: "en" },
] as const;

async function seedCampaigns(
  adminId: string,
  templateDocs: { _id: unknown; name: string }[],
  outletDocs: {
    _id: unknown;
    name: string;
    ownerName: string;
    province: string;
    phoneNormalized?: string | null;
    phone: string;
  }[],
) {
  const docs = CAMPAIGN_SEEDS.slice(0, COUNT).map((seed, index) => {
    const template = templateDocs[index % templateDocs.length];
    const isApproved = ["Scheduled", "Sending", "Completed", "Failed"].includes(seed.status);
    const lifecycle: Record<string, unknown> = {};

    if (isApproved) {
      lifecycle.approvedBy = adminId;
      lifecycle.approvedAt = new Date(iso(14 - index));
      lifecycle.audienceSnapshot = { matched: COUNT, eligible: 8, consented: 7, deliverable: 7, unreachable: 2, withoutConsent: 3, notVerified: 1 };
    }
    if (seed.status === "Scheduled") lifecycle.scheduledAt = new Date(Date.now() + (index + 1) * 24 * 60 * 60 * 1000);
    if (["Sending", "Completed", "Failed"].includes(seed.status)) {
      lifecycle.startedAt = new Date(iso(12));
      lifecycle.sentAt = new Date(iso(12));
    }
    if (seed.status === "Completed") lifecycle.completedAt = new Date(iso(11));
    if (seed.status === "Cancelled") lifecycle.cancelledAt = new Date(iso(9));
    if (seed.status === "Cancelled" || seed.status === "Failed") lifecycle.cancelledBy = adminId;
    if (seed.status === "Failed") lifecycle.lastError = "Simulated provider failure during dispatch.";

    return {
      name: seed.name,
      objective: seed.objective,
      description: "Seeded demonstration campaign. Safe to edit or delete.",
      owner: ["Khamla Sisouphan", "Bounmy Phommaly", "Malee Inthavong", "Somsanith Vongsa"][index % 4],
      status: seed.status,
      audience: index === 4 ? { eligibility: "any", consent: "any" } : { provinces: [PROVINCES[index % PROVINCES.length].name], categories: [OUTLET_CATEGORIES[index % OUTLET_CATEGORIES.length]] },
      recipients: COUNT,
      recipientCount: COUNT,
      eligibleRecipientCount: 8,
      templateId: template._id,
      templateName: template.name,
      language: seed.language,
      message: "Seeded campaign message body using {{1}} and {{5}} placeholders.",
      promotionPeriod: "1–15 Nov 2026",
      campaignReference: `PC-2026-${pad(100 + index, 4)}`,
      createdBy: adminId,
      ...lifecycle,
    };
  });

  const inserted = await CampaignModel.insertMany(docs);
  logger.info({ count: inserted.length }, "Seeded campaigns");

  /* Recipients: 10 rows for the completed campaign. */
  const completed = inserted.find((campaign) => campaign.status === "Completed");
  if (!completed) return;

  const statuses = ["Read", "Read", "Read", "Read", "Read", "Delivered", "Delivered", "Sent", "Sent", "Failed"] as const;
  const recipients = outletDocs.slice(0, COUNT).map((outlet, index) => {
    const status = statuses[index];
    const sentAt = new Date(iso(12));
    return {
      campaignId: completed._id,
      outletId: outlet._id,
      outletNameSnapshot: outlet.name,
      phoneNumberSnapshot: outlet.phoneNormalized ?? (outlet.phone || "N/A"),
      templateId: completed.templateId,
      templateNameSnapshot: completed.templateName,
      languageSnapshot: completed.language,
      variables: {
        "{{1}}": outlet.name,
        "{{2}}": outlet.ownerName,
        "{{3}}": outlet.province,
        "{{5}}": completed.campaignReference ?? "PC-2026-0104",
      },
      status,
      providerMessageId: `mock-seed-${pad(index + 1, 5)}`,
      attemptCount: 1,
      attemptedAt: sentAt,
      sentAt: status === "Failed" ? null : sentAt,
      deliveredAt: ["Delivered", "Read"].includes(status) ? new Date(iso(11)) : null,
      readAt: status === "Read" ? new Date(iso(10)) : null,
      failedAt: status === "Failed" ? sentAt : null,
      failureCode: status === "Failed" ? "131026" : null,
      failureReason: status === "Failed" ? "Simulated provider rejection." : null,
      createdAt: sentAt,
    };
  });

  await CampaignRecipientModel.insertMany(recipients);
  const metrics = await recomputeCampaignMetrics(completed._id);
  await CampaignModel.updateOne({ _id: completed._id }, { $set: { recipients: recipients.length, recipientCount: recipients.length, metrics } });
  logger.info({ count: recipients.length, metrics }, "Seeded campaign recipients and recomputed metrics");
}

/* ------------------------------------------------------------------ */
/* Import jobs — 10                                                   */
/* ------------------------------------------------------------------ */

const IMPORT_SEEDS = [
  { fileName: "outlets-vientiane-batch-01.csv", status: "Completed", totalRows: 120, importableRows: 112, errorRows: 3, warningRows: 5, duplicateRows: 4, importedCount: 112, skippedCount: 8, invalidCount: 3 },
  { fileName: "outlets-savannakhet-batch-01.csv", status: "Completed", totalRows: 85, importableRows: 80, errorRows: 2, warningRows: 3, duplicateRows: 2, importedCount: 80, skippedCount: 5, invalidCount: 2 },
  { fileName: "outlets-champasack-batch-01.csv", status: "Ready", totalRows: 64, importableRows: 60, errorRows: 1, warningRows: 3, duplicateRows: 1, importedCount: 0, skippedCount: 0, invalidCount: 1 },
  { fileName: "distributor-list-q4.csv", status: "Failed", totalRows: 0, importableRows: 0, errorRows: 0, warningRows: 0, duplicateRows: 0, importedCount: 0, skippedCount: 0, invalidCount: 0 },
  { fileName: "outlets-luang-prabang.csv", status: "Cancelled", totalRows: 40, importableRows: 38, errorRows: 0, warningRows: 2, duplicateRows: 0, importedCount: 0, skippedCount: 0, invalidCount: 0 },
  { fileName: "outlets-oudomxay.csv", status: "Validating", totalRows: 33, importableRows: 0, errorRows: 0, warningRows: 0, duplicateRows: 0, importedCount: 0, skippedCount: 0, invalidCount: 0 },
  { fileName: "outlets-xieng-khouang.csv", status: "Pending", totalRows: 0, importableRows: 0, errorRows: 0, warningRows: 0, duplicateRows: 0, importedCount: 0, skippedCount: 0, invalidCount: 0 },
  { fileName: "outlets-bokeo-batch-02.csv", status: "Importing", totalRows: 57, importableRows: 55, errorRows: 1, warningRows: 1, duplicateRows: 1, importedCount: 0, skippedCount: 0, invalidCount: 1 },
  { fileName: "outlets-khammouane.csv", status: "Completed", totalRows: 48, importableRows: 46, errorRows: 1, warningRows: 1, duplicateRows: 1, importedCount: 46, skippedCount: 2, invalidCount: 1 },
  { fileName: "partner-club-signups.csv", status: "Completed", totalRows: 72, importableRows: 70, errorRows: 0, warningRows: 2, duplicateRows: 2, importedCount: 70, skippedCount: 2, invalidCount: 0 },
] as const;

async function seedImportJobs(adminId: string) {
  const docs = IMPORT_SEEDS.slice(0, COUNT).map((seed, index) => ({
    fileName: seed.fileName,
    channel: "CSV import",
    status: seed.status,
    totalRows: seed.totalRows,
    importableRows: seed.importableRows,
    errorRows: seed.errorRows,
    warningRows: seed.warningRows,
    duplicateRows: seed.duplicateRows,
    importedCount: seed.importedCount,
    skippedCount: seed.skippedCount,
    invalidCount: seed.invalidCount,
    headerWarning: seed.status === "Failed" ? "Missing required column: phone" : null,
    parseError: seed.status === "Failed" ? "Unable to parse CSV header row." : null,
    error: seed.status === "Failed" ? "Import aborted because the file header is invalid." : null,
    previewRows: [
      { lineNumber: 2, status: "Importable", duplicate: null, message: "", raw: { name: "Sok Dee Mini Mart", province: "Vientiane Capital" } },
      { lineNumber: 3, status: "Warning", duplicate: "file", message: "Duplicate phone number in file.", raw: { name: "Mekong Beer Garden", phone: "+8562050001001" } },
      { lineNumber: 4, status: "Error", duplicate: null, message: "Invalid Lao phone number.", raw: { name: "Baan Grocery", phone: "020-0000" } },
    ],
    createdBy: adminId,
    startedAt: new Date(iso(30 - index)),
    completedAt: ["Completed", "Failed", "Cancelled"].includes(seed.status) ? new Date(iso(29 - index)) : null,
  }));
  await ImportJobModel.insertMany(docs);
  logger.info({ count: docs.length }, "Seeded import jobs");
}

/* ------------------------------------------------------------------ */
/* Audit logs — 10                                                    */
/* ------------------------------------------------------------------ */

const AUDIT_SEEDS = [
  { type: "auth", message: "Administrator signed in." },
  { type: "outlet", message: "Outlet Sok Dee Mini Mart was created." },
  { type: "import", message: "Imported 112 outlets from outlets-vientiane-batch-01.csv." },
  { type: "segment", message: "Created audience segment Vientiane on-trade — consented." },
  { type: "template", message: "Message template Seasonal Promotion (EN) was approved locally." },
  { type: "campaign", message: "Campaign Partner Club launch was approved for dispatch." },
  { type: "campaign", message: "Campaign Partner Club launch completed with 10 recipients." },
  { type: "team", message: "Invitation sent to Noy Thammavong." },
  { type: "settings", message: "Messaging limits were updated." },
  { type: "integration", message: "WhatsApp integration is running in simulated (mock) mode." },
] as const;

async function seedAudit(adminId: string) {
  const docs = AUDIT_SEEDS.slice(0, COUNT).map((seed, index) => ({
    type: seed.type,
    message: seed.message,
    actorId: index === 9 ? null : adminId,
    actorName: index === 9 ? "System" : "Seed script",
    targetType: seed.type,
    metadata: { source: "scripts/seed-mock.ts" },
    createdAt: new Date(iso(index)),
  }));
  await AuditLogModel.insertMany(docs);
  logger.info({ count: docs.length }, "Seeded audit log entries");
}

/* ------------------------------------------------------------------ */
/* Settings + provinces (full reference/config sets)                  */
/* ------------------------------------------------------------------ */

async function seedSettings(): Promise<void> {
  const defaults = defaultSections();
  await ApplicationSettingModel.insertMany(
    SETTING_KEYS.map((key) => ({ key, value: defaults[key], description: `Default ${key} settings.` })),
  );
  logger.info({ count: SETTING_KEYS.length }, "Seeded default settings (all keys)");
}

async function seedProvinces(): Promise<void> {
  await ProvinceModel.insertMany(
    PROVINCES.map((province) => ({ name: province.name, region: province.region, districts: province.districts })),
  );
  logger.info({ count: PROVINCES.length }, "Seeded the complete Lao province/district reference list");
}

/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const keep = process.argv.slice(2).includes("--keep");

  await connectDatabase();
  logger.info({ mongo: env.MONGODB_URI.replace(/\/\/[^@]*@/, "//***@") }, "Connected for mock seeding");

  if (!keep) await wipe();

  // Rebuild text indexes so an older `language_override` definition does not
  // reject Lao template/campaign documents.
  await ensureTextIndexes();

  const admin = await seedUsers(keep);
  const adminId = String(admin._id);

  await seedProvinces();
  await seedOutlets(adminId);
  await seedSegments(adminId);
  const templates = await seedTemplates(adminId);
  const outlets = await OutletModel.find().sort({ createdAt: 1 }).limit(COUNT);
  await seedCampaigns(adminId, templates, outlets);
  await seedImportJobs(adminId);
  await seedAudit(adminId);
  await seedSettings();

  await disconnectDatabase();
  logger.info(
    { counts: { users: COUNT, outlets: COUNT, segments: COUNT, templates: COUNT, campaigns: COUNT, recipients: COUNT, importJobs: COUNT, auditLogs: COUNT } },
    `Mock seed complete. Sign in with ${env.SEED_ADMIN_EMAIL}`,
  );
}

void main().catch(async (error) => {
  logger.error({ err: error }, "Mock seed failed");
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
