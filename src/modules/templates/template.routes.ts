import { Router } from "express";
import { validate } from "../../common/middleware/validate";
import { asyncHandler } from "../../common/middleware/asyncHandler";
import { authenticate, authorize } from "../auth/auth.middleware";
import { objectIdParamSchema } from "../../common/validators/objectId";
import { templateFormSchema, templateListQuerySchema, templateUpdateSchema } from "./template.schema";
import * as controller from "./template.controller";

const router = Router();
const READ_ROLES = ["Administrator", "Marketing Manager", "Campaign Creator", "Read-Only Analyst"] as const;
const WRITE_ROLES = ["Administrator", "Marketing Manager", "Campaign Creator"] as const;

router.use(authenticate);

router.get("/", authorize(...READ_ROLES), validate({ query: templateListQuerySchema }), asyncHandler(controller.list));

router.post("/", authorize(...WRITE_ROLES), validate({ body: templateFormSchema }), asyncHandler(controller.create));

router.get("/:id", authorize(...READ_ROLES), validate({ params: objectIdParamSchema }), asyncHandler(controller.getOne));

router.patch(
  "/:id",
  authorize(...WRITE_ROLES),
  validate({ params: objectIdParamSchema, body: templateUpdateSchema }),
  asyncHandler(controller.update),
);

router.delete(
  "/:id",
  authorize("Administrator", "Marketing Manager"),
  validate({ params: objectIdParamSchema }),
  asyncHandler(controller.remove),
);

router.post(
  "/:id/submit-for-approval",
  authorize(...WRITE_ROLES),
  validate({ params: objectIdParamSchema }),
  asyncHandler(controller.submitForApproval),
);

router.post(
  "/:id/refresh-status",
  authorize("Administrator", "Marketing Manager"),
  validate({ params: objectIdParamSchema }),
  asyncHandler(controller.refreshStatus),
);

export const templateRoutes = router;
