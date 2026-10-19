import { Router } from "express";
import { validate } from "../../common/middleware/validate";
import { asyncHandler } from "../../common/middleware/asyncHandler";
import { authenticate, authorize } from "../auth/auth.middleware";
import { auditLogQuerySchema } from "./auditLog.schema";
import * as controller from "./auditLog.controller";

const router = Router();

// Audit access is restricted to administrators and marketing managers.
router.use(authenticate, authorize("Administrator", "Marketing Manager"));

router.get("/", validate({ query: auditLogQuerySchema }), asyncHandler(controller.list));

export const auditLogRoutes = router;
