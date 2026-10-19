import { Router } from "express";
import { validate } from "../../common/middleware/validate";
import { asyncHandler } from "../../common/middleware/asyncHandler";
import { authenticate, authorize } from "../auth/auth.middleware";
import {
  reportExportQuerySchema,
  reportFailureQuerySchema,
  reportFiltersSchema,
} from "./report.schema";
import * as controller from "./report.controller";

const router = Router();
const READ_ROLES = ["Administrator", "Marketing Manager", "Campaign Creator", "Read-Only Analyst"] as const;

router.use(authenticate, authorize(...READ_ROLES));

router.get("/overview", validate({ query: reportFiltersSchema }), asyncHandler(controller.overview));
router.get(
  "/campaign-performance",
  validate({ query: reportFiltersSchema }),
  asyncHandler(controller.campaignPerformance),
);
router.get(
  "/province-performance",
  validate({ query: reportFiltersSchema }),
  asyncHandler(controller.provincePerformance),
);
router.get(
  "/category-performance",
  validate({ query: reportFiltersSchema }),
  asyncHandler(controller.categoryPerformance),
);
router.get(
  "/message-failures",
  validate({ query: reportFailureQuerySchema }),
  asyncHandler(controller.messageFailures),
);
router.get("/export", validate({ query: reportExportQuerySchema }), asyncHandler(controller.exportReport));

export const reportRoutes = router;
