import { Router } from "express";
import { asyncHandler } from "../../common/middleware/asyncHandler";
import { authenticate } from "../auth/auth.middleware";
import { health, receiveWebhook, verifyWebhook } from "./whatsapp.controller";

const router = Router();

/*
 * Webhook routes are public by design (the provider cannot authenticate with a
 * JWT); authenticity is enforced by signature/verify-token validation instead.
 */
router.get("/webhook", verifyWebhook);
router.post("/webhook", asyncHandler(receiveWebhook));

router.get("/health", authenticate, asyncHandler(health));

export const whatsappRoutes = router;
