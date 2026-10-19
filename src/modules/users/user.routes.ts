import { Router } from "express";
import { validate } from "../../common/middleware/validate";
import { asyncHandler } from "../../common/middleware/asyncHandler";
import { authenticate, authorize } from "../auth/auth.middleware";
import { objectIdParamSchema } from "../../common/validators/objectId";
import {
  userCreateSchema,
  userListQuerySchema,
  userStatusSchema,
  userUpdateSchema,
} from "./user.schema";
import * as controller from "./user.controller";

const router = Router();

// User administration is restricted to Administrators (docs/starter-project.md §5.7).
router.use(authenticate, authorize("Administrator"));

router.get("/", validate({ query: userListQuerySchema }), asyncHandler(controller.list));

router.get("/:id", validate({ params: objectIdParamSchema }), asyncHandler(controller.getOne));

router.post("/", validate({ body: userCreateSchema }), asyncHandler(controller.create));

router.patch("/:id", validate({ params: objectIdParamSchema, body: userUpdateSchema }), asyncHandler(controller.update));

router.patch(
  "/:id/status",
  validate({ params: objectIdParamSchema, body: userStatusSchema }),
  asyncHandler(controller.updateStatus),
);

export const userRoutes = router;
