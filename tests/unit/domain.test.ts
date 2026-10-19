import { describe, expect, it } from "vitest";
import { normalizeLaoPhone, formatLaoPhone, getPhoneStatus, phoneDigits } from "../../src/common/utils/phone";
import { deriveOutletFields } from "../../src/modules/outlets/outlet.model";
import { buildOutletFilter, deliverableFilter } from "../../src/modules/outlets/outlet.service";
import { assertTransition } from "../../src/modules/campaigns/campaign.service";
import { csvValue, toCsv } from "../../src/common/utils/csv";
import { extractVariables } from "../../src/modules/templates/template.schema";
import { variablesForBody } from "../../src/modules/templates/template.service";
import { defaultSections } from "../../src/modules/settings/setting.schema";
import { parseDuration } from "../../src/common/utils/duration";
import { escapeRegex } from "../../src/common/utils/escape";

describe("Lao phone helpers", () => {
  it("normalises local, international and loose formats", () => {
    expect(normalizeLaoPhone("020 5555 1188")).toBe("+8562055551188");
    expect(normalizeLaoPhone("+856 20 5555 1188")).toBe("+8562055551188");
    expect(normalizeLaoPhone("2055551188")).toBe("+8562055551188");
    expect(normalizeLaoPhone("8562055551188")).toBe("+8562055551188");
  });

  it("rejects numbers that are not Lao mobiles", () => {
    expect(normalizeLaoPhone("12345")).toBeNull();
    expect(normalizeLaoPhone("+1 555 010 0000")).toBeNull();
    expect(normalizeLaoPhone("")).toBeNull();
  });

  it("classifies phone status and formats display values", () => {
    expect(getPhoneStatus("")).toBe("Missing");
    expect(getPhoneStatus("abc")).toBe("Invalid");
    expect(getPhoneStatus("+856 20 5555 1188")).toBe("Valid");
    expect(formatLaoPhone("+8562055551188")).toBe("+856 20 5555 1188");
    expect(phoneDigits("+856 20 5555 1188")).toBe("8562055551188");
  });
});

describe("Outlet derived fields", () => {
  it("only marks a contact eligible when verified and phone is valid", () => {
    const eligible = deriveOutletFields({ phone: "+856 20 5555 1188", whatsappVerified: true, marketingConsent: true });
    expect(eligible.whatsappEligibility).toBe("Eligible");
    expect(eligible.dataQualityStatus).toBe("Complete");

    const notVerified = deriveOutletFields({ phone: "+856 20 5555 1188", whatsappVerified: false, marketingConsent: true });
    expect(notVerified.whatsappEligibility).toBe("Needs review");

    const badPhone = deriveOutletFields({ phone: "nope", whatsappVerified: true, marketingConsent: true });
    expect(badPhone.whatsappEligibility).toBe("Ineligible");
    expect(badPhone.dataQualityStatus).toBe("Incomplete");
  });

  it("never infers consent from a phone number", () => {
    const result = deriveOutletFields({ phone: "+856 20 5555 1188", whatsappVerified: true, marketingConsent: false });
    expect(result.consentStatus).toBe("Unknown");
    expect(result.dataQualityStatus).toBe("Needs review");
  });

  it("honours consent withdrawal over the boolean flag", () => {
    const result = deriveOutletFields({
      phone: "+856 20 5555 1188",
      whatsappVerified: true,
      marketingConsent: true,
      consentRevokedAt: new Date(),
    });
    expect(result.consentStatus).toBe("Opted out");
  });
});

describe("Outlet query construction", () => {
  it("builds a whitelisted filter and escapes search input", () => {
    const filter = buildOutletFilter({
      search: ".*+?",
      provinces: ["Vientiane Capital"],
      categories: ["On-Trade"],
      eligibility: "eligible",
      consent: "consented",
      phoneStatus: "Valid",
      dataQuality: "Complete",
    }) as { $and: { $or: { name: RegExp }[] }[]; };

    const searchFilter = filter.$and[0].$or[0].name;
    expect(searchFilter).toBeInstanceOf(RegExp);
    // Every regex metacharacter is escaped, so the search is a literal match.
    expect(searchFilter.source).toBe("\\.\\*\\+\\?");
  });

  it("maps ineligible to anything not eligible", () => {
    const filter = buildOutletFilter({ eligibility: "ineligible" }) as { $and: { whatsappEligibility?: unknown }[] };
    expect(filter.$and[0].whatsappEligibility).toEqual({ $ne: "Eligible" });
  });

  it("requires eligibility, consent and a usable number for dispatch", () => {
    const filter = deliverableFilter({}) as { $and: unknown[] };
    const serialised = JSON.stringify(filter);
    expect(serialised).toContain("Eligible");
    expect(serialised).toContain("Opted in");
    expect(filter.$and).toHaveLength(4);
  });

  it("escapeRegex neutralises special characters", () => {
    expect(escapeRegex("a.b*c")).toBe("a\\.b\\*c");
  });
});

describe("Campaign state machine", () => {
  it("allows valid transitions", () => {
    expect(() => assertTransition("Draft", "Pending Approval")).not.toThrow();
    expect(() => assertTransition("Pending Approval", "Scheduled")).not.toThrow();
    expect(() => assertTransition("Scheduled", "Sending")).not.toThrow();
    expect(() => assertTransition("Sending", "Completed")).not.toThrow();
  });

  it("rejects invalid transitions", () => {
    expect(() => assertTransition("Completed", "Sending")).toThrow();
    expect(() => assertTransition("Cancelled", "Sending")).toThrow();
    expect(() => assertTransition("Draft", "Completed")).toThrow();
  });
});

describe("CSV safety", () => {
  it("guards spreadsheet formula injection", () => {
    expect(csvValue("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(csvValue("@cmd")).toBe("'@cmd");
    expect(csvValue("+cmd|calc")).toBe("'+cmd|calc");
  });

  it("leaves phone numbers and plain text untouched", () => {
    expect(csvValue("+856 20 5555 1188")).toBe("+856 20 5555 1188");
    expect(csvValue("Sok Dee Mart")).toBe("Sok Dee Mart");
    expect(csvValue('has,comma')).toBe('"has,comma"');
  });

  it("writes a header row", () => {
    expect(toCsv(["Name"], [["Sok Dee"]])).toBe("Name\r\nSok Dee\r\n");
  });
});

describe("Template variables", () => {
  it("extracts positional variables in order", () => {
    expect(extractVariables("Hi {{2}} and {{1}}")).toEqual(["{{1}}", "{{2}}"]);
    expect(extractVariables("no variables")).toEqual([]);
  });

  it("maps known variables to labels", () => {
    const variables = variablesForBody("Hello {{1}} from {{9}}");
    expect(variables[0]).toMatchObject({ key: "{{1}}", label: "Outlet name" });
    expect(variables[1]).toMatchObject({ key: "{{9}}", label: "Unmapped variable" });
  });
});

describe("Settings defaults", () => {
  it("parses every section from an empty object", () => {
    const defaults = defaultSections();
    expect(defaults["company.profile"]).toMatchObject({ legalName: "Lao Brewery Co., Ltd." });
    expect(defaults["approval.workflow"]).toMatchObject({ requireApproval: true });
  });
});

describe("Duration parser", () => {
  it("parses units and bare seconds", () => {
    expect(parseDuration("15m")).toBe(15 * 60 * 1000);
    expect(parseDuration("30d")).toBe(30 * 24 * 60 * 60 * 1000);
    expect(parseDuration("45")).toBe(45 * 1000);
    expect(() => parseDuration("nope")).toThrow();
  });
});
