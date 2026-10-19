/**
 * CSV generation and parsing helpers.
 *
 * Generation neutralises spreadsheet formula injection (docs/starter-project.md
 * §8): cells beginning with `=`, `@`, tab or carriage return — or `+`/`-` that
 * are not part of a number such as a phone number — are prefixed with a single
 * quote so a spreadsheet treats them as text.
 */

import Papa from "papaparse";

function needsFormulaGuard(text: string): boolean {
  const first = text[0];
  if (first === undefined) return false;
  if (first === "=" || first === "@" || first === "\t" || first === "\r") return true;
  if (first === "+" || first === "-") {
    // `+856 20 …` is a phone number, not a formula; `+cmd|…` is not.
    return !/^[+-][\d\s()+-]*$/.test(text);
  }
  return false;
}

export function csvValue(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = needsFormulaGuard(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  const lines = [headers.map(csvValue).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvValue).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

export interface ParsedCsv {
  fields: string[];
  rows: Record<string, string>[];
  errors: string[];
}

/** Parse CSV text into header-keyed rows, reporting (not throwing) issues. */
export function parseCsv(text: string): ParsedCsv {
  const cleaned = text.replace(/^\uFEFF/, "");
  const parsed = Papa.parse<Record<string, string>>(cleaned, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });
  return {
    fields: (parsed.meta?.fields ?? []).filter(Boolean),
    rows: parsed.data,
    errors: parsed.errors.map((error) => `Row ${(error.row ?? 0) + 2}: ${error.message}`),
  };
}
