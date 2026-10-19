/**
 * API router — mounts every feature module under the versioned prefix
 * (docs/starter-project.md §5).
 */

import { Router } from "express";
import { authRoutes } from "../modules/auth/auth.routes";
import { userRoutes } from "../modules/users/user.routes";
import { outletRoutes } from "../modules/outlets/outlet.routes";
import { segmentRoutes } from "../modules/segments/segment.routes";
import { campaignRoutes } from "../modules/campaigns/campaign.routes";
import { templateRoutes } from "../modules/templates/template.routes";
import { reportRoutes } from "../modules/reports/report.routes";
import { settingRoutes } from "../modules/settings/setting.routes";
import { auditLogRoutes } from "../modules/audit-logs/auditLog.routes";
import { whatsappRoutes } from "../modules/whatsapp/whatsapp.routes";
import { health } from "./health.controller";

export const apiRouter = Router();

apiRouter.get("/health", health);

apiRouter.use("/auth", authRoutes);
apiRouter.use("/users", userRoutes);
apiRouter.use("/outlets", outletRoutes);
apiRouter.use("/segments", segmentRoutes);
apiRouter.use("/campaigns", campaignRoutes);
apiRouter.use("/templates", templateRoutes);
apiRouter.use("/reports", reportRoutes);
apiRouter.use("/settings", settingRoutes);
apiRouter.use("/audit-logs", auditLogRoutes);
apiRouter.use("/whatsapp", whatsappRoutes);
