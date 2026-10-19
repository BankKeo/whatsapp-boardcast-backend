import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import { OutletModel } from "../../src/modules/outlets/outlet.model";
import { MessageTemplateModel } from "../../src/modules/templates/template.model";
import { CampaignRecipientModel } from "../../src/modules/campaigns/campaignRecipient.model";
import { queue } from "../../src/modules/jobs/queue";
import { authHeader, createActiveUser, login, resetTestDb, startTestDb, stopTestDb } from "../helpers/testDb";

let app: Express;
const ADMIN = { email: "admin@test.local", role: "Administrator" as const };

function outlet(overrides: Record<string, unknown> = {}) {
  return {
    name: "Outlet",
    ownerName: "Owner",
    phone: "+856 20 5555 1188",
    province: "Vientiane Capital",
    district: "Chanthabouly",
    village: "",
    address: "",
    category: "On-Trade",
    status: "Active",
    channel: "Field team",
    whatsappVerified: true,
    marketingConsent: true,
    notes: "",
    ...overrides,
  };
}

async function seedTemplate(status: "Approved" | "Draft", createdBy: string) {
  return MessageTemplateModel.create({
    name: `Template ${status}`,
    category: "Seasonal Promotion",
    language: "en",
    body: "Hello {{1}}, a Partner Club promotion is running for {{3}}. Reference {{5}}.",
    variables: [
      { key: "{{1}}", label: "Outlet name", example: "Sok Dee" },
      { key: "{{3}}", label: "Province", example: "Vientiane Capital" },
      { key: "{{5}}", label: "Campaign reference", example: "PC-2026-0001" },
    ],
    status,
    approvalStatus: status,
    externalApprovalId: status === "Approved" ? "local-approval-test" : null,
    createdBy,
  });
}

function campaignBody(templateId: string, overrides: Record<string, unknown> = {}) {
  return {
    details: {
      name: "Launch campaign",
      objective: "Seasonal promotion",
      description: "Integration test campaign",
      owner: "Khamla Sisouphan",
    },
    audience: {
      segmentId: null,
      segmentName: null,
      filters: { provinces: ["Vientiane Capital"], categories: ["On-Trade"], consent: "consented", eligibility: "eligible" },
    },
    message: {
      templateId,
      language: "en",
      message: "Hello partner, a Partner Club promotion is running this month.",
    },
    scheduledAt: null,
    ...overrides,
  };
}

beforeAll(async () => {
  await startTestDb();
  app = createApp();
});

afterAll(async () => {
  await stopTestDb();
});

afterEach(async () => {
  await resetTestDb();
  queue.reset();
});

describe("Campaign lifecycle", () => {
  async function setup() {
    const admin = await createActiveUser(ADMIN);
    const token = await login(app, ADMIN.email);
    await OutletModel.create([
      outlet({ name: "Alpha", phone: "+856 20 5200 0001" }),
      outlet({ name: "Bravo", phone: "+856 20 5200 0002" }),
      outlet({ name: "Charlie", phone: "+856 20 5200 0003" }),
      outlet({ name: "Opted out", phone: "+856 20 5200 0004", marketingConsent: false, consentRevokedAt: new Date() }),
      outlet({ name: "Bad number", phone: "+856 20 5200 000X", whatsappVerified: false }),
      outlet({ name: "Off-trade", phone: "+856 20 5200 0005", category: "Off-Trade" }),
    ]);
    const template = await seedTemplate("Approved", String(admin._id));
    return { token, templateId: String(template._id) };
  }

  it("enforces the approval workflow before dispatch", async () => {
    const { token, templateId } = await setup();

    const created = await request(app)
      .post("/api/v1/campaigns")
      .set(authHeader(token))
      .send(campaignBody(templateId));
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("Draft");
    // Only the three consented, eligible on-trade outlets are deliverable.
    expect(created.body.data.recipients).toBe(3);
    const id = created.body.data.id as string;

    const sentTooEarly = await request(app).post(`/api/v1/campaigns/${id}/send`).set(authHeader(token));
    expect(sentTooEarly.status).toBe(409);

    const submitted = await request(app).post(`/api/v1/campaigns/${id}/submit`).set(authHeader(token));
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.status).toBe("Pending Approval");

    const approved = await request(app).post(`/api/v1/campaigns/${id}/approve`).set(authHeader(token));
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe("Scheduled");
    expect(approved.body.data.approvedAt).not.toBeNull();
  });

  it("never includes opted-out or unverified contacts in dispatch jobs", async () => {
    const { token, templateId } = await setup();
    const created = await request(app).post("/api/v1/campaigns").set(authHeader(token)).send(campaignBody(templateId));
    const id = created.body.data.id as string;
    await request(app).post(`/api/v1/campaigns/${id}/schedule`).set(authHeader(token)).send({ scheduledAt: null, language: "en" });

    const sent = await request(app).post(`/api/v1/campaigns/${id}/send`).set(authHeader(token));
    expect(sent.status).toBe(200);
    await queue.drain();

    const recipients = await CampaignRecipientModel.find({ campaignId: id });
    const phones = recipients.map((recipient) => recipient.phoneNumberSnapshot);
    expect(recipients).toHaveLength(3);
    expect(phones).not.toContain("+8562052000004"); // opted out
    expect(phones).not.toContain("+8562052000005"); // off-trade, out of audience
    expect(new Set(phones).size).toBe(phones.length); // one message per number

    const campaign = await request(app).get(`/api/v1/campaigns/${id}`).set(authHeader(token));
    expect(campaign.body.data.status).toBe("Completed");
    expect(campaign.body.data.metrics.attempted).toBe(3);
    expect(campaign.body.data.metrics.delivered).toBe(3);
    expect(campaign.body.data.simulated).toBe(true);
  });

  it("does not create duplicate recipient jobs on repeated dispatch", async () => {
    const { token, templateId } = await setup();
    const created = await request(app).post("/api/v1/campaigns").set(authHeader(token)).send(campaignBody(templateId));
    const id = created.body.data.id as string;
    await request(app).post(`/api/v1/campaigns/${id}/schedule`).set(authHeader(token)).send({ scheduledAt: null, language: "en" });

    await request(app).post(`/api/v1/campaigns/${id}/send`).set(authHeader(token));
    const repeat = await request(app).post(`/api/v1/campaigns/${id}/send`).set(authHeader(token));
    expect(repeat.status).toBe(409);
    await queue.drain();

    const recipients = await CampaignRecipientModel.find({ campaignId: id });
    expect(recipients).toHaveLength(3);
  });

  it("refuses to dispatch an unapproved template", async () => {
    const admin = await createActiveUser(ADMIN);
    const token = await login(app, ADMIN.email);
    await OutletModel.create(outlet({ phone: "+856 20 5300 0001" }));
    const draftTemplate = await seedTemplate("Draft", String(admin._id));

    const created = await request(app)
      .post("/api/v1/campaigns")
      .set(authHeader(token))
      .send(campaignBody(String(draftTemplate._id)));
    const id = created.body.data.id as string;
    await request(app).post(`/api/v1/campaigns/${id}/schedule`).set(authHeader(token)).send({ scheduledAt: null, language: "en" });

    const sent = await request(app).post(`/api/v1/campaigns/${id}/send`).set(authHeader(token));
    expect(sent.status).toBe(409);
    expect(sent.body.error.message).toContain("Draft");
    expect(await CampaignRecipientModel.countDocuments({ campaignId: id })).toBe(0);
  });

  it("treats repeated create requests with the same idempotency key as one campaign", async () => {
    const { token, templateId } = await setup();
    const body = campaignBody(templateId, { idempotencyKey: "idem-key-0001" });

    const first = await request(app).post("/api/v1/campaigns").set(authHeader(token)).send(body);
    const second = await request(app).post("/api/v1/campaigns").set(authHeader(token)).send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
  });

  it("reports blocking warnings before dispatch", async () => {
    const admin = await createActiveUser(ADMIN);
    const token = await login(app, ADMIN.email);
    const draftTemplate = await seedTemplate("Draft", String(admin._id));
    const created = await request(app)
      .post("/api/v1/campaigns")
      .set(authHeader(token))
      .send(campaignBody(String(draftTemplate._id)));

    const preview = await request(app)
      .post(`/api/v1/campaigns/${created.body.data.id}/preview`)
      .set(authHeader(token));
    expect(preview.status).toBe(200);
    expect(preview.body.data.blocking.length).toBeGreaterThan(0);
  });

  it("cannot edit a completed campaign", async () => {
    const { token, templateId } = await setup();
    const created = await request(app).post("/api/v1/campaigns").set(authHeader(token)).send(campaignBody(templateId));
    const id = created.body.data.id as string;
    await request(app).post(`/api/v1/campaigns/${id}/schedule`).set(authHeader(token)).send({ scheduledAt: null, language: "en" });
    await request(app).post(`/api/v1/campaigns/${id}/send`).set(authHeader(token));
    await queue.drain();

    const edited = await request(app)
      .patch(`/api/v1/campaigns/${id}`)
      .set(authHeader(token))
      .send({ details: { name: "Renamed while completed" } });
    expect(edited.status).toBe(409);
  });
});

describe("Reporting", () => {
  it("aggregates persisted recipient data into a campaign report", async () => {
    const admin = await createActiveUser(ADMIN);
    const token = await login(app, ADMIN.email);
    await OutletModel.create([
      outlet({ name: "Alpha", phone: "+856 20 5400 0001" }),
      outlet({ name: "Bravo", phone: "+856 20 5400 0002" }),
    ]);
    const template = await seedTemplate("Approved", String(admin._id));
    const created = await request(app).post("/api/v1/campaigns").set(authHeader(token)).send(campaignBody(String(template._id)));
    const id = created.body.data.id as string;
    await request(app).post(`/api/v1/campaigns/${id}/schedule`).set(authHeader(token)).send({ scheduledAt: null, language: "en" });
    await request(app).post(`/api/v1/campaigns/${id}/send`).set(authHeader(token));
    await queue.drain();

    const report = await request(app).get(`/api/v1/campaigns/${id}/report`).set(authHeader(token));
    expect(report.status).toBe(200);
    expect(report.body.data.metrics.attempted).toBe(2);
    expect(report.body.data.deliveryRate).toBeGreaterThan(0);

    const overview = await request(app).get("/api/v1/reports/overview").set(authHeader(token));
    expect(overview.status).toBe(200);
    expect(overview.body.data.messages.attempted).toBe(2);

    const provinces = await request(app).get("/api/v1/reports/province-performance").set(authHeader(token));
    expect(provinces.status).toBe(200);
    const vCapital = provinces.body.data.find((row: { key: string }) => row.key === "Vientiane Capital");
    expect(vCapital.delivered).toBe(2);
  });
});

describe("WhatsApp webhooks", () => {
  it("verifies the handshake and deduplicates repeated events", async () => {
    const verify = await request(app).get("/api/v1/whatsapp/webhook").query({ "hub.verify_token": "anything", "hub.challenge": "12345" });
    expect(verify.status).toBe(200);
    expect(verify.text).toBe("12345");

    const admin = await createActiveUser(ADMIN);
    const token = await login(app, ADMIN.email);
    await OutletModel.create(outlet({ phone: "+856 20 5500 0001" }));
    const template = await seedTemplate("Approved", String(admin._id));
    const created = await request(app).post("/api/v1/campaigns").set(authHeader(token)).send(campaignBody(String(template._id)));
    const id = created.body.data.id as string;
    await request(app).post(`/api/v1/campaigns/${id}/schedule`).set(authHeader(token)).send({ scheduledAt: null, language: "en" });
    await request(app).post(`/api/v1/campaigns/${id}/send`).set(authHeader(token));
    await queue.drain();

    const recipient = await CampaignRecipientModel.findOne({ campaignId: id });
    const providerMessageId = recipient!.providerMessageId!;
    const payload = {
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                statuses: [{ id: providerMessageId, status: "failed", timestamp: Math.floor(Date.now() / 1000), errors: [{ code: 131026, title: "Rejected" }] }],
              },
            },
          ],
        },
      ],
    };

    const first = await request(app).post("/api/v1/whatsapp/webhook").send(payload);
    expect(first.status).toBe(200);
    expect(first.body.data.applied).toBe(1);

    const second = await request(app).post("/api/v1/whatsapp/webhook").send(payload);
    expect(second.body.data.applied).toBe(0);

    const updated = await CampaignRecipientModel.findById(recipient!._id);
    expect(updated!.status).toBe("Failed");
  });

  it("reports the integration as simulated in mock mode", async () => {
    await createActiveUser(ADMIN);
    const token = await login(app, ADMIN.email);
    const health = await request(app).get("/api/v1/whatsapp/health").set(authHeader(token));
    expect(health.status).toBe(200);
    expect(health.body.data.simulated).toBe(true);
    expect(health.body.data.connected).toBe(false);
  });
});
