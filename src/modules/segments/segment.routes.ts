import { Router } from "express";
import { validate } from "../../common/middleware/validate";
import { asyncHandler } from "../../common/middleware/asyncHandler";
import { authenticate, authorize } from "../auth/auth.middleware";
import { objectIdParamSchema } from "../../common/validators/objectId";
import {
  segmentFormSchema,
  segmentListQuerySchema,
  segmentPreviewSchema,
  segmentRecipientsQuerySchema,
  segmentUpdateSchema,
} from "./segment.schema";
import * as controller from "./segment.controller";

const router = Router();
const READ_ROLES = ["Administrator", "Marketing Manager", "Campaign Creator", "Read-Only Analyst"] as const;
const WRITE_ROLES = ["Administrator", "Marketing Manager", "Campaign Creator"] as const;

router.use(authenticate);

router.get("/", authorize(...READ_ROLES), validate({ query: segmentListQuerySchema }), asyncHandler(controller.list));

router.post(
  "/preview",
  authorize(...READ_ROLES),
  validate({ body: segmentPreviewSchema }),
  asyncHandler(controller.preview),
);

router.post("/", authorize(...WRITE_ROLES), validate({ body: segmentFormSchema }), asyncHandler(controller.create));

router.get("/:id", authorize(...READ_ROLES), validate({ params: objectIdParamSchema }), asyncHandler(controller.getOne));

router.patch(
  "/:id",
  authorize(...WRITE_ROLES),
  validate({ params: objectIdParamSchema, body: segmentUpdateSchema }),
  asyncHandler(controller.update),
);

router.delete(
  "/:id",
  authorize("Administrator", "Marketing Manager"),
  validate({ params: objectIdParamSchema }),
  asyncHandler(controller.remove),
);

router.get(
  "/:id/recipients",
  authorize(...READ_ROLES),
  validate({ params: objectIdParamSchema, query: segmentRecipientsQuerySchema }),
  asyncHandler(controller.recipients),
);

export const segmentRoutes = router;
