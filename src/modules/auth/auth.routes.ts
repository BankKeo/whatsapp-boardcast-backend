import { Router } from "express";
import { validate } from "../../common/middleware/validate";
import { asyncHandler } from "../../common/middleware/asyncHandler";
import { authRateLimiter } from "../../common/middleware/rateLimit";
import { authenticate } from "./auth.middleware";
import { changePasswordSchema, loginSchema, logoutSchema, refreshSchema } from "./auth.schema";
import * as authController from "./auth.controller";

const router = Router();

router.post("/login", authRateLimiter, validate({ body: loginSchema }), asyncHandler(authController.login));

router.post("/refresh", authRateLimiter, validate({ body: refreshSchema }), asyncHandler(authController.refresh));

router.post("/logout", validate({ body: logoutSchema }), asyncHandler(authController.logout));

router.get("/me", authenticate, asyncHandler(authController.me));

router.post(
  "/change-password",
  authenticate,
  validate({ body: changePasswordSchema }),
  asyncHandler(authController.changePassword),
);

export const authRoutes = router;
