/**
 * Database seed script.
 *
 * Creates a controlled initial administrator, Lao province/district reference
 * data, a fictional outlet register, audience segments, message templates,
 * example campaigns (draft + completed with simulated results) and default
 * settings (docs/starter-project.md §14).
 *
 * All contact details are obviously fictional. Never seed real customer data.
 *
 * Usage:
 *   pnpm seed              # full demo dataset
 *   pnpm seed --keep       # add to existing data without wiping
 *   pnpm seed --only=admin # create/refresh only the administrator account
 */

import { connectDatabase, disconnectDatabase } from "../src/config/database";
import { env } from "../src/config/env";
import { logger } from "../src/config/logger";
import { hashPassword } from "../src/common/utils/password";
import { normalizeLaoPhone } from "../src/common/utils/phone";
import { PROVINCES } from "../src/common/constants/laos";
import { OUTLET_CATEGORIES, OUTLET_CHANNELS, USER_ROLES } from "../src/common/constants/domain";
import { UserModel } from "../src/modules/users/user.model";
import { ProvinceModel } from "../src/modules/outlets/province.model";
import { OutletModel } from "../src/modules/outlets/outlet.model";
import { SegmentModel } from "../src/modules/segments/segment.model";
import { MessageTemplateModel } from "../src/modules/templates/template.model";
import { CampaignModel } from "../src/modules/campaigns/campaign.model";
import { CampaignRecipientModel } from "../src/modules/campaigns/campaignRecipient.model";
import { ApplicationSettingModel } from "../src/modules/settings/applicationSetting.model";
import { SETTING_KEYS } from "../src/modules/settings/applicationSetting.model";
import { defaultSections } from "../src/modules/settings/setting.schema";
import { AuditLogModel } from "../src/modules/audit-logs/auditLog.model";
import { refreshDuplicateFlags } from "../src/modules/outlets/outlet.service";
import { recomputeCampaignMetrics } from "../src/modules/campaigns/campaign.metrics";

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

const rand = mulberry32(20261017);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
const chance = (probability: number): boolean => rand() < probability;
const pad = (value: number, size: number): string => String(value).padStart(size, "0");

const OUTLET_PREFIXES = ["Sok Dee", "Phonxay", "Mekong", "Lao Star", "Baan", "Nam Ngum", "Sabai", "Vangvieng", "Tha Deua", "Khamla"];
const OUTLET_SUFFIXES = ["Mini Mart", "Restaurant", "Beer Garden", "Grocery", "Guesthouse Café", "Wholesale", "Karaoke Bar", "Night Market Stall"];
const OWNERS = ["Khamla S.", "Bounmy P.", "Somsanith V.", "Malee I.", "Anousone C.", "Vilay K.", "Sengphet D.", "Noy T."];

function fakePhone(index: number): string {
  return normalizeLaoPhone(`+856 20 ${pad(5000 + (index % 4000), 4)} ${pad(1000 + (index % 9000), 4)}`)!;
}

function iso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

async function wipe(): Promise<void> {
  await Promise.all([
    OutletModel.deleteMany({}),
    SegmentModel.deleteMany({}),
    MessageTemplateModel.deleteMany({}),
    CampaignModel.deleteMany({}),
    CampaignRecipientModel.deleteMany({}),
    ProvinceModel.deleteMany({}),
    ApplicationSettingModel.deleteMany({}),
    AuditLogModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);
  logger.info("Cleared existing collections");
}

async function seedAdmin() {
  const passwordHash = await hashPassword(env.SEED_ADMIN_PASSWORD);
  const admin = await UserModel.findOneAndUpdate(
    { email: env.SEED_ADMIN_EMAIL },
    {
      $set: {
        name: env.SEED_ADMIN_NAME,
        email: env.SEED_ADMIN_EMAIL,
        role: "Administrator",
        status: "Active",
        passwordHash,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  logger.info({ email: admin.email }, "Seeded administrator (change the password after first sign-in)");
  return admin;
}

async function seedProvinces(): Promise<void> {
  await ProvinceModel.insertMany(
    PROVINCES.map((province) => ({ name: province.name, region: province.region, districts: province.districts })),
  );
  logger.info({ count: PROVINCES.length }, "Seeded provinces and districts");
}

async function seedOutlets(adminId: string) {
  const duplicates = new Set<number>();
  // Two shared numbers, to exercise duplicate handling.
  const sharedPhones = [fakePhone(7), fakePhone(11)];

  const docs = [];
  for (let index = 0; index < 180; index += 1) {
    const province = PROVINCES[index % PROVINCES.length];
    const district = province.districts[Math.floor(rand() * province.districts.length)];
    const useShared = index === 40 || index === 41 || index === 42 || index === 77;
    if (useShared) duplicates.add(index);

    const phoneRoll = rand();
    const rawPhone =
      phoneRoll < 0.03 ? "" : phoneRoll < 0.07 ? `020-0000-${pad(index, 4)}` : useShared ? sharedPhones[index % 2] : fakePhone(index);

    const whatsappVerified = Boolean(rawPhone) && normalizeLaoPhone(rawPhone) !== null && chance(0.85);
    const marketingConsent = chance(0.72);

    docs.push({
      name: `${pick(OUTLET_PREFIXES)} ${pick(OUTLET_SUFFIXES)} ${index + 1}`,
      ownerName: pick(OWNERS),
      phone: rawPhone,
      province: province.name,
      district,
      village: `Ban ${pick(["Phonxay", "Sikhottabong", "Khamma", "Tha Deua", "Nongbone", "Phonthan"])}`,
      address: `Unit ${1 + (index % 200)}, ${district}, ${province.name}`,
      category: OUTLET_CATEGORIES[index % OUTLET_CATEGORIES.length],
      status: pick(["Active", "Active", "Active", "Pending Review", "Inactive"]),
      channel: OUTLET_CHANNELS[index % OUTLET_CHANNELS.length],
      whatsappVerified,
      marketingConsent,
      consentRecordedAt: marketingConsent ? new Date(iso(30 + (index % 90))) : null,
      consentSource: marketingConsent ? pick(["Field team form", "Partner Club registration", "Distributor list"]) : null,
      notes: index % 9 === 0 ? "Demo record — replace before production use." : "",
      lastUpdatedBy: adminId,
    });
  }

  await OutletModel.insertMany(docs);
  await refreshDuplicateFlags();
  logger.info({ count: docs.length, duplicateRecords: duplicates.size }, "Seeded outlets");
}

async function seedSegments(adminId: string): Promise<void> {
  await SegmentModel.insertMany([
    {
      name: "Vientiane On-Trade — consented",
      description: "On-trade partners in Vientiane Capital with marketing consent and a valid number.",
      filters: { provinces: ["Vientiane Capital"], categories: ["On-Trade"], consent: "consented", eligibility: "eligible" },
      createdBy: adminId,
      updatedBy: adminId,
      lastMatchCount: 0,
    },
    {
      name: "Off-trade re-engagement",
      description: "Off-trade outlets that can be reached on WhatsApp.",
      filters: { categories: ["Off-Trade"], eligibility: "eligible" },
      createdBy: adminId,
      updatedBy: adminId,
    },
    {
      name: "Needs review",
      description: "Outlets with incomplete or duplicate contact data.",
      filters: { dataQuality: "Needs review" },
      createdBy: adminId,
      updatedBy: adminId,
    },
  ]);
  logger.info("Seeded audience segments");
}

async function seedTemplates(adminId: string) {
  const templates = await MessageTemplateModel.insertMany([
    {
      name: "Seasonal Promotion (EN)",
      category: "Seasonal Promotion",
      language: "en",
      body:
        "Hello {{1}}, {{2}} from {{3}}! Our Partner Club seasonal promotion runs {{4}}. Reference {{5}}. Show this message at the counter to redeem. Contact {{6}} for details.",
      variables: [
        { key: "{{1}}", label: "Outlet name", example: "Sok Dee Minimart" },
        { key: "{{2}}", label: "Owner name", example: "Khamla S." },
        { key: "{{3}}", label: "Province", example: "Vientiane Capital" },
        { key: "{{4}}", label: "Promotion period", example: "1–15 Nov 2026" },
        { key: "{{5}}", label: "Campaign reference", example: "PC-2026-0184" },
        { key: "{{6}}", label: "Contact number", example: "+856 20 5555 1188" },
      ],
      status: "Approved",
      approvalStatus: "Approved",
      externalApprovalId: "local-approval-demo-seasonal",
      notes: "Approved locally for demonstration; not a Meta approval.",
      createdBy: adminId,
      updatedBy: adminId,
    },
    {
      name: "New Product Announcement (LO)",
      category: "New Product Announcement",
      language: "lo",
      body: "ສະບາຍດີ {{1}}! ສິນຄ້າໃໝ່ຂອງພວກເຮົາພ້ອມແລ້ວ. ອ້າງອີງ {{5}}.",
      variables: [
        { key: "{{1}}", label: "Outlet name", example: "Sok Dee Minimart" },
        { key: "{{5}}", label: "Campaign reference", example: "PC-2026-0184" },
      ],
      status: "Approved",
      approvalStatus: "Approved",
      externalApprovalId: "local-approval-demo-product",
      notes: "Approved locally for demonstration.",
      createdBy: adminId,
      updatedBy: adminId,
    },
    {
      name: "Partner Club Update (draft)",
      category: "Partner Club Update",
      language: "en",
      body: "Dear {{1}}, here is the latest Partner Club update for {{3}}.",
      variables: [
        { key: "{{1}}", label: "Outlet name", example: "Sok Dee Minimart" },
        { key: "{{3}}", label: "Province", example: "Vientiane Capital" },
      ],
      status: "Draft",
      approvalStatus: "Draft",
      createdBy: adminId,
      updatedBy: adminId,
    },
  ]);
  logger.info({ count: templates.length }, "Seeded message templates");
  return templates;
}

async function seedCampaigns(adminId: string, templateId: string, templateName: string, secondTemplateId: string, secondTemplateName: string) {
  // Draft campaign.
  await CampaignModel.create({
    name: "Draft — December on-trade push",
    objective: "Seasonal promotion",
    description: "Prepared but not submitted. Safe to edit.",
    owner: "Khamla Sisouphan",
    status: "Draft",
    audience: { provinces: ["Vientiane Capital"], categories: ["On-Trade"], consent: "consented", eligibility: "eligible" },
    recipients: 0,
    templateId,
    templateName,
    language: "en",
    message: "Draft message body for the December on-trade promotion.",
    campaignReference: "PC-2026-0001",
    createdBy: adminId,
  });

  // Completed campaign with simulated results.
  const completed = await CampaignModel.create({
    name: "Completed — Partner Club launch",
    objective: "Partner Club update",
    description: "Simulated campaign used to populate reports.",
    owner: "Bounmy Phommaly",
    status: "Completed",
    audience: { categories: ["Off-Trade"], consent: "consented", eligibility: "eligible" },
    recipients: 0,
    templateId: secondTemplateId,
    templateName: secondTemplateName,
    language: "lo",
    message: "Partner Club launch message for off-trade partners.",
    campaignReference: "PC-2026-0002",
    createdBy: adminId,
    approvedBy: adminId,
    approvedAt: new Date(iso(21)),
    scheduledAt: new Date(iso(20)),
    startedAt: new Date(iso(20)),
    sentAt: new Date(iso(20)),
    completedAt: new Date(iso(19)),
  });

  const outlets = await OutletModel.find({ whatsappEligibility: "Eligible", consentStatus: "Opted in" }).limit(60);
  let index = 0;
  const recipients = outlets.map((outlet) => {
    const roll = rand();
    const status = roll < 0.06 ? "Failed" : roll < 0.2 ? "Delivered" : roll < 0.85 ? "Read" : "Sent";
    index += 1;
    return {
      campaignId: completed._id,
      outletId: outlet._id,
      outletNameSnapshot: outlet.name,
      phoneNumberSnapshot: outlet.phoneNormalized!,
      templateId: secondTemplateId,
      templateNameSnapshot: secondTemplateName,
      languageSnapshot: "lo",
      variables: {
        "{{1}}": outlet.name,
        "{{2}}": outlet.ownerName,
        "{{3}}": outlet.province,
        "{{5}}": "PC-2026-0002",
      },
      status,
      providerMessageId: `sim-seed-${pad(index, 5)}`,
      attemptCount: 1,
      attemptedAt: new Date(iso(20)),
      sentAt: status === "Failed" ? null : new Date(iso(20)),
      deliveredAt: ["Delivered", "Read"].includes(status) ? new Date(iso(20)) : null,
      readAt: status === "Read" ? new Date(iso(19)) : null,
      failedAt: status === "Failed" ? new Date(iso(20)) : null,
      failureCode: status === "Failed" ? "131026" : null,
      failureReason: status === "Failed" ? "Simulated provider rejection." : null,
      createdAt: new Date(iso(20)),
    };
  });

  if (recipients.length > 0) {
    await CampaignRecipientModel.insertMany(recipients);
    const metrics = await recomputeCampaignMetrics(completed._id);
    await CampaignModel.updateOne({ _id: completed._id }, { $set: { recipients: recipients.length, metrics } });
    logger.info({ recipients: recipients.length, metrics }, "Seeded completed campaign with simulated results");
  }

  // Scheduled campaign (future dispatch).
  await CampaignModel.create({
    name: "Scheduled — new year reminder",
    objective: "Promotional reminder",
    description: "Queued for the scheduler to pick up.",
    owner: "Malee Inthavong",
    status: "Scheduled",
    audience: { provinces: ["Savannakhet"], categories: ["On-Trade"], consent: "consented", eligibility: "eligible" },
    recipients: 0,
    templateId,
    templateName,
    language: "en",
    message: "New year promotional reminder for Savannakhet on-trade partners.",
    campaignReference: "PC-2026-0003",
    createdBy: adminId,
    approvedBy: adminId,
    approvedAt: new Date(iso(1)),
    scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  logger.info("Seeded campaigns");
}

async function seedSettings(): Promise<void> {
  const defaults = defaultSections();
  await ApplicationSettingModel.insertMany(
    SETTING_KEYS.map((key) => ({ key, value: defaults[key], description: `Default ${key} settings.` })),
  );
  logger.info({ count: SETTING_KEYS.length }, "Seeded default settings");
}

async function seedAudit(adminId: string): Promise<void> {
  await AuditLogModel.insertMany([
    {
      type: "settings",
      message: "Demo dataset seeded.",
      actorId: adminId,
      actorName: "Seed script",
      targetType: "system",
      metadata: { source: "scripts/seed.ts" },
    },
    {
      type: "integration",
      message: "WhatsApp integration is running in simulated (mock) mode.",
      actorName: "System",
      targetType: "integration",
    },
  ]);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const onlyAdmin = args.includes("--only=admin");
  const keep = args.includes("--keep");

  await connectDatabase();
  logger.info({ mongo: env.MONGODB_URI.replace(/\/\/[^@]*@/, "//***@") }, "Connected for seeding");

  if (!keep && !onlyAdmin) await wipe();

  const admin = await seedAdmin();
  const adminId = String(admin._id);

  if (onlyAdmin) {
    await disconnectDatabase();
    logger.info("Administrator account ready");
    return;
  }

  await seedProvinces();
  await seedOutlets(adminId);
  await seedSegments(adminId);
  const templates = await seedTemplates(adminId);
  await seedCampaigns(adminId, String(templates[0]._id), templates[0].name, String(templates[1]._id), templates[1].name);
  await seedSettings();
  await seedAudit(adminId);

  await disconnectDatabase();
  logger.info(
    { roles: USER_ROLES, signIn: env.SEED_ADMIN_EMAIL },
    "Seed complete. Sign in with the seeded administrator and change the password.",
  );
}

void main().catch(async (error) => {
  logger.error({ err: error }, "Seed failed");
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
