import { Router } from "express";
import { validate } from "../../common/middleware/validate";
import { asyncHandler } from "../../common/middleware/asyncHandler";
import { authenticate, authorize } from "../auth/auth.middleware";
import { updateSettingSchema } from "./setting.schema";
import * as controller from "./setting.controller";

const router = Router();

// Settings changes are administrative (docs/starter-project.md §5.7).
router.use(authenticate, authorize("Administrator"));

router.get("/", asyncHandler(controller.list));
router.patch("/", validate({ body: updateSettingSchema }), asyncHandler(controller.update));

export const settingRoutes = router;
