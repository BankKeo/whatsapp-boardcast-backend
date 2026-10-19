import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import { OutletModel } from "../../src/modules/outlets/outlet.model";
import {
  authHeader,
  createActiveUser,
  login,
  resetTestDb,
  startTestDb,
  stopTestDb,
  TEST_PASSWORD,
} from "../helpers/testDb";

let app: Express;

const ADMINS = { email: "admin@test.local", role: "Administrator" as const };
const ANALYST = { email: "analyst@test.local", role: "Read-Only Analyst" as const };

function outletBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "Sok Dee Mini Mart",
    ownerName: "Khamla Sisouphan",
    phone: "+856 20 5555 1188",
    province: "Vientiane Capital",
    district: "Chanthabouly",
    village: "Ban Phonxay",
    address: "Unit 1",
    category: "Off-Trade",
    status: "Active",
    channel: "Field team",
    whatsappVerified: true,
    marketingConsent: true,
    consentSource: "Field team form",
    notes: "",
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
});

describe("Authentication", () => {
  it("signs in a valid user and rejects a bad password without revealing which field failed", async () => {
    await createActiveUser(ADMINS);

    const bad = await request(app).post("/api/v1/auth/login").send({ email: ADMINS.email, password: "wrong" });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("UNAUTHORIZED");

    const unknown = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "nobody@test.local", password: TEST_PASSWORD });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(bad.body.error.message);

    const good = await request(app).post("/api/v1/auth/login").send({ email: ADMINS.email, password: TEST_PASSWORD });
    expect(good.status).toBe(200);
    expect(good.body.data.accessToken).toBeTruthy();
  });

  it("returns the current user and refuses unauthenticated access", async () => {
    await createActiveUser(ADMINS);
    const token = await login(app, ADMINS.email);

    const anonymous = await request(app).get("/api/v1/auth/me");
    expect(anonymous.status).toBe(401);

    const me = await request(app).get("/api/v1/auth/me").set(authHeader(token));
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe(ADMINS.email);
    expect(me.body.data.passwordHash).toBeUndefined();
  });

  it("invalidates existing access tokens after a password change", async () => {
    await createActiveUser(ADMINS);
    const token = await login(app, ADMINS.email);

    const changed = await request(app)
      .post("/api/v1/auth/change-password")
      .set(authHeader(token))
      .send({ currentPassword: TEST_PASSWORD, newPassword: "Another-Password-456" });
    expect(changed.status).toBe(200);

    const stale = await request(app).get("/api/v1/auth/me").set(authHeader(token));
    expect(stale.status).toBe(401);

    const relogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: ADMINS.email, password: "Another-Password-456" });
    expect(relogin.status).toBe(200);
  });

  it("reports validation errors with field paths", async () => {
    const response = await request(app).post("/api/v1/auth/login").send({ email: "not-an-email" });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.details.some((detail: { path: string }) => detail.path === "email")).toBe(true);
  });
});

describe("Authorization", () => {
  it("blocks a Read-Only Analyst from managing outlets", async () => {
    await createActiveUser(ANALYST);
    const token = await login(app, ANALYST.email);

    const response = await request(app).post("/api/v1/outlets").set(authHeader(token)).send(outletBody());
    expect(response.status).toBe(403);
  });

  it("restricts user administration to administrators", async () => {
    await createActiveUser(ANALYST);
    const token = await login(app, ANALYST.email);
    const response = await request(app).get("/api/v1/users").set(authHeader(token));
    expect(response.status).toBe(403);
  });
});

describe("Outlets", () => {
  it("creates, reads, updates and deletes an outlet", async () => {
    await createActiveUser(ADMINS);
    const token = await login(app, ADMINS.email);

    const created = await request(app).post("/api/v1/outlets").set(authHeader(token)).send(outletBody());
    expect(created.status).toBe(201);
    expect(created.body.data.id).toBeTruthy();
    expect(created.body.data.whatsappEligibility).toBe("Eligible");
    const id = created.body.data.id as string;

    const fetched = await request(app).get(`/api/v1/outlets/${id}`).set(authHeader(token));
    expect(fetched.status).toBe(200);
    expect(fetched.body.data.name).toBe("Sok Dee Mini Mart");

    const updated = await request(app)
      .patch(`/api/v1/outlets/${id}`)
      .set(authHeader(token))
      .send({ marketingConsent: false });
    expect(updated.status).toBe(200);
    expect(updated.body.data.consentStatus).toBe("Opted out");
    expect(updated.body.data.consentRevokedAt).not.toBeNull();

    const removed = await request(app).delete(`/api/v1/outlets/${id}`).set(authHeader(token));
    expect(removed.status).toBe(204);
    expect(await OutletModel.countDocuments()).toBe(0);
  });

  it("validates the phone number and rejects a verified contact without one", async () => {
    await createActiveUser(ADMINS);
    const token = await login(app, ADMINS.email);

    const invalid = await request(app)
      .post("/api/v1/outlets")
      .set(authHeader(token))
      .send(outletBody({ phone: "+1 555 010 0000" }));
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.details.some((detail: { path: string }) => detail.path === "phone")).toBe(true);

    const mismatchedDistrict = await request(app)
      .post("/api/v1/outlets")
      .set(authHeader(token))
      .send(outletBody({ district: "Pakse" }));
    expect(mismatchedDistrict.status).toBe(422);
  });

  it("flags duplicate phone numbers without merging records", async () => {
    await createActiveUser(ADMINS);
    const token = await login(app, ADMINS.email);

    await request(app).post("/api/v1/outlets").set(authHeader(token)).send(outletBody({ name: "First Store" }));
    await request(app).post("/api/v1/outlets").set(authHeader(token)).send(outletBody({ name: "Second Store" }));

    const docs = await OutletModel.find({}).sort({ name: 1 });
    expect(docs).toHaveLength(2);
    expect(docs.every((doc) => doc.duplicatePhone)).toBe(true);
    expect(docs.every((doc) => doc.dataQualityStatus === "Needs review")).toBe(true);
    expect(new Set(docs.map((doc) => doc.name)).size).toBe(2);
  });

  it("filters, sorts and paginates", async () => {
    await createActiveUser(ADMINS);
    const token = await login(app, ADMINS.email);

    await OutletModel.create([
      outletBody({ name: "Alpha Store", province: "Vientiane Capital", phone: "+856 20 5000 0001" }),
      outletBody({ name: "Beta Store", province: "Savannakhet", category: "On-Trade", phone: "+856 20 5000 0002" }),
      outletBody({ name: "Gamma Store", province: "Savannakhet", category: "On-Trade", phone: "+856 20 5000 0003" }),
    ]);

    const filtered = await request(app)
      .get("/api/v1/outlets")
      .query({ province: "Savannakhet", category: "On-Trade", page: 1, limit: 1 })
      .set(authHeader(token));
    expect(filtered.status).toBe(200);
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.meta.total).toBe(2);
    expect(filtered.body.meta.totalPages).toBe(2);

    // The dashboard's multi-select filters arrive as repeated query keys.
    const multi = await request(app)
      .get("/api/v1/outlets")
      .query({ provinces: ["Vientiane Capital", "Savannakhet"] })
      .set(authHeader(token));
    expect(multi.status).toBe(200);
    expect(multi.body.meta.total).toBe(3);

    const singleNarrowed = await request(app)
      .get("/api/v1/outlets")
      .query({ provinces: ["Vientiane Capital"], categories: ["Off-Trade"] })
      .set(authHeader(token));
    expect(singleNarrowed.status).toBe(200);
    expect(singleNarrowed.body.meta.total).toBe(1);

    // The plural filter also drives the audience breakdown.
    const breakdown = await request(app)
      .get("/api/v1/outlets/breakdown")
      .query({ provinces: ["Savannakhet"], categories: ["On-Trade"] })
      .set(authHeader(token));
    expect(breakdown.status).toBe(200);
    expect(breakdown.body.data.matched).toBe(2);
  });

  it("returns dashboard statistics", async () => {
    await createActiveUser(ADMINS);
    const token = await login(app, ADMINS.email);
    await OutletModel.create(outletBody({ phone: "+856 20 5000 0010" }));

    const response = await request(app).get("/api/v1/outlets/stats").set(authHeader(token));
    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
    expect(response.body.data.eligible).toBe(1);
  });
});

describe("CSV import", () => {
  const header = "Outlet Name,Owner Name,Phone Number,Province,District,Outlet Category\n";

  it("warns about missing headers and validates rows", async () => {
    await createActiveUser(ADMINS);
    const token = await login(app, ADMINS.email);

    const preview = await request(app)
      .post("/api/v1/outlets/import/preview")
      .set(authHeader(token))
      .send({ fileName: "outlets.csv", content: "Foo,Bar\n1,2\n" });
    expect(preview.status).toBe(200);
    expect(preview.body.data.headerWarning).toContain("Outlet Name");
  });

  it("reports row-level errors, duplicates and imports valid rows", async () => {
    await createActiveUser(ADMINS);
    const token = await login(app, ADMINS.email);

    await OutletModel.create(outletBody({ name: "Existing", phone: "+856 20 5000 0099" }));

    const csv =
      header +
      "New Store A,Owner A,+856 20 5000 0098,Vientiane Capital,Chanthabouly,Off-Trade\n" +
      "Bad Province,Owner B,+856 20 5000 0097,Nowhere,Nowhere,Off-Trade\n" +
      "Duplicate,Owner C,+856 20 5000 0099,Vientiane Capital,Chanthabouly,Off-Trade\n";

    const preview = await request(app)
      .post("/api/v1/outlets/import/preview")
      .set(authHeader(token))
      .send({ fileName: "outlets.csv", content: csv });
    expect(preview.status).toBe(200);
    expect(preview.body.data.summary.errorRows).toBe(1);
    expect(preview.body.data.summary.duplicateRows).toBe(1);

    const commit = await request(app)
      .post("/api/v1/outlets/import/commit")
      .set(authHeader(token))
      .send({ fileName: "outlets.csv", content: csv, duplicatePolicy: "skip" });
    expect(commit.status).toBe(200);
    expect(commit.body.data.imported).toBe(1);
    expect(commit.body.data.invalid).toBe(1);
    expect(commit.body.data.skipped).toBe(1);
    expect(await OutletModel.countDocuments()).toBe(2);
  });
});

describe("Audience segments", () => {
  async function seedMixedOutlets() {
    await OutletModel.create([
      outletBody({ name: "Consented", phone: "+856 20 5100 0001", marketingConsent: true }),
      outletBody({ name: "Not consented", phone: "+856 20 5100 0002", marketingConsent: false }),
      outletBody({ name: "Opted out", phone: "+856 20 5100 0003", marketingConsent: false, consentRevokedAt: new Date() }),
      outletBody({ name: "Bad number", phone: "+856 20 5100 000X", whatsappVerified: false, marketingConsent: true }),
    ]);
  }

  it("previews an audience with server-calculated counts", async () => {
    await createActiveUser(ADMINS);
    const token = await login(app, ADMINS.email);
    await seedMixedOutlets();

    const preview = await request(app)
      .post("/api/v1/segments/preview")
      .set(authHeader(token))
      .send({ filters: { categories: ["Off-Trade"] }, limit: 10 });

    expect(preview.status).toBe(200);
    expect(preview.body.data.count).toBe(4);
    expect(preview.body.data.breakdown.consented).toBe(2);
    expect(preview.body.data.breakdown.withoutConsent).toBe(2);
    expect(preview.body.data.breakdown.unreachable).toBe(1);
  });

  it("only returns consented, eligible recipients for a segment", async () => {
    await createActiveUser(ADMINS);
    const token = await login(app, ADMINS.email);
    await seedMixedOutlets();

    const created = await request(app)
      .post("/api/v1/segments")
      .set(authHeader(token))
      .send({
        name: "All off-trade",
        description: "Everything",
        filters: { categories: ["Off-Trade"] },
      });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const recipients = await request(app).get(`/api/v1/segments/${id}/recipients`).set(authHeader(token));
    expect(recipients.status).toBe(200);
    expect(recipients.body.meta.total).toBe(1);
    expect(recipients.body.data[0].name).toBe("Consented");
  });
});
