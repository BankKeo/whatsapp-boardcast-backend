/**
 * CSV import template and export column headers.
 *
 * Kept beside the outlet module so the template the server serves and the
 * importer's accepted columns cannot drift.
 */

import { csvValue } from "../../common/utils/csv";

export const OUTLET_CSV_TEMPLATE_HEADERS = [
  "Outlet Name",
  "Owner Name",
  "Phone Number",
  "Province",
  "District",
  "Village",
  "Outlet Category",
  "WhatsApp Eligibility",
  "Marketing Consent",
  "Notes",
] as const;

const SAMPLE = [
  "Sok Dee Mini Mart",
  "Khamla Sisouphan",
  "+856 20 5555 1188",
  "Vientiane Capital",
  "Chanthabouly",
  "Ban Phonxay",
  "Off-Trade",
  "Eligible",
  "Consented",
  "Sample row — replace with your own data.",
];

export const OUTLET_CSV_TEMPLATE = `${OUTLET_CSV_TEMPLATE_HEADERS.map(csvValue).join(",")}\r\n${SAMPLE.map(
  csvValue,
).join(",")}\r\n`;
