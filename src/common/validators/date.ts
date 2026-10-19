/**
 * Shared date validators.
 *
 * `z.coerce.date().nullable()` is a trap: `coerce` runs before `nullable`, so a
 * `null` input becomes `new Date(null)` (1970) instead of `null`. These helpers
 * map empty input to `null` first, then coerce real values.
 */

import { z } from "zod";

function emptyToNull(value: unknown): unknown {
  if (value === "" || value === null) return null;
  return value;
}

/** Nullable date with a `null` default. */
export const nullableDate = z.preprocess(emptyToNull, z.coerce.date().nullable()).default(null);

/** Nullable, optional date — present-but-empty becomes `null`. */
export const optionalNullableDate = z.preprocess(emptyToNull, z.coerce.date().nullable()).optional();
