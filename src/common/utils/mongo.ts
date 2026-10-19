import type { SchemaOptions, Types } from "mongoose";

/**
 * Shared Mongoose schema options.
 *
 * Every API resource is returned to the dashboard with a string `id` (the UI
 * uses opaque ids such as `out-00001`), so `_id` is renamed and `__v` removed in
 * `toJSON`. `timestamps` gives us `createdAt` / `updatedAt`, which the outlet
 * table reads directly.
 */
export const baseSchemaOptions = {
  timestamps: true,
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform(_doc: unknown, ret: Record<string, unknown>) {
      if (ret._id instanceof Object) {
        ret.id = String(ret._id);
      } else if (typeof ret._id === "string") {
        ret.id = ret._id;
      }
      delete ret._id;
      return ret;
    },
  },
} satisfies SchemaOptions;

/** True when the value is a usable MongoDB ObjectId (string or ObjectId). */
export function isObjectId(value: unknown): value is Types.ObjectId | string {
  if (value instanceof Object) {
    return "toHexString" in value;
  }
  return typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
}
