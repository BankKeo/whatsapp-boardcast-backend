import { Router } from "express";
import { validate } from "../../common/middleware/validate";
import { asyncHandler } from "../../common/middleware/asyncHandler";
import { authenticate, authorize } from "../auth/auth.middleware";
import { objectIdParamSchema } from "../../common/validators/objectId";
import {
  campaignCreateSchema,
  campaignListQuerySchema,
  campaignRecipientQuerySchema,
  campaignScheduleSchema,
  campaignTransitionSchema,
  campaignUpdateSchema,
} from "./campaign.schema";
import * as controller from "./campaign.controller";

const router = Router();
const READ_ROLES = ["Administrator", "Marketing Manager", "Campaign Creator", "Read-Only Analyst"] as const;
const CREATE_ROLES = ["Administrator", "Marketing Manager", "Campaign Creator"] as const;
const APPROVER_ROLES = ["Administrator", "Marketing Manager"] as const;

router.use(authenticate);

router.get("/", authorize(...READ_ROLES), validate({ query: campaignListQuerySchema }), asyncHandler(controller.list));

router.post("/", authorize(...CREATE_ROLES), validate({ body: campaignCreateSchema }), asyncHandler(controller.create));

router.get("/:id", authorize(...READ_ROLES), validate({ params: objectIdParamSchema }), asyncHandler(controller.getOne));

router.patch(
  "/:id",
  authorize(...CREATE_ROLES),
  validate({ params: objectIdParamSchema, body: campaignUpdateSchema }),
  asyncHandler(controller.update),
);

router.post(
  "/:id/preview",
  authorize(...READ_ROLES),
  validate({ params: objectIdParamSchema }),
  asyncHandler(controller.preview),
);

router.post(
  "/:id/submit",
  authorize(...CREATE_ROLES),
  validate({ params: objectIdParamSchema }),
  asyncHandler(controller.submit),
);

router.post(
  "/:id/approve",
  authorize(...APPROVER_ROLES),
  validate({ params: objectIdParamSchema }),
  asyncHandler(controller.approve),
);

router.post(
  "/:id/schedule",
  authorize(...APPROVER_ROLES),
  validate({ params: objectIdParamSchema, body: campaignScheduleSchema }),
  asyncHandler(controller.schedule),
);

router.post(
  "/:id/cancel",
  authorize(...APPROVER_ROLES),
  validate({ params: objectIdParamSchema, body: campaignTransitionSchema }),
  asyncHandler(controller.cancel),
);

router.post(
  "/:id/send",
  authorize(...APPROVER_ROLES),
  validate({ params: objectIdParamSchema }),
  asyncHandler(controller.send),
);

router.post(
  "/:id/duplicate",
  authorize(...CREATE_ROLES),
  validate({ params: objectIdParamSchema }),
  asyncHandler(controller.duplicate),
);

router.get(
  "/:id/recipients",
  authorize(...READ_ROLES),
  validate({ params: objectIdParamSchema, query: campaignRecipientQuerySchema }),
  asyncHandler(controller.recipients),
);

router.get(
  "/:id/report",
  authorize(...READ_ROLES),
  validate({ params: objectIdParamSchema }),
  asyncHandler(controller.report),
);

export const campaignRoutes = router;
