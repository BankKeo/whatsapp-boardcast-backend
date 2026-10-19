import { z } from "zod";

/** Shared `:id` route parameter schema — validates a MongoDB ObjectId. */
export const objectIdParamSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, "A valid identifier is required."),
});

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "A valid identifier is required.");
