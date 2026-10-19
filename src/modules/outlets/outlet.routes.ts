import { Router } from "express";
import { validate } from "../../common/middleware/validate";
import { asyncHandler } from "../../common/middleware/asyncHandler";
import { authenticate, authorize } from "../auth/auth.middleware";
import { objectIdParamSchema } from "../../common/validators/objectId";
import { bulkOutletSchema, outletFormSchema, outletListQuerySchema, outletUpdateSchema } from "./outlet.schema";
import { importJobListQuerySchema, importCommitSchema, importPreviewSchema } from "../imports/importJob.schema";
import * as controller from "./outlet.controller";

const router = Router();

const READ_ROLES = ["Administrator", "Marketing Manager", "Campaign Creator", "Read-Only Analyst"] as const;
const MANAGE_ROLES = ["Administrator", "Marketing Manager", "Campaign Creator"] as const;
const IMPORT_ROLES = ["Administrator", "Marketing Manager"] as const;

router.use(authenticate);

/* Static routes must be registered before `/:id`. */
router.get("/", authorize(...READ_ROLES), validate({ query: outletListQuerySchema }), asyncHandler(controller.list));
router.get("/stats", authorize(...READ_ROLES), asyncHandler(controller.stats));
router.get(
  "/breakdown",
  authorize(...READ_ROLES),
  validate({ query: outletListQuerySchema }),
  asyncHandler(controller.breakdown),
);
router.get(
  "/export",
  authorize(...READ_ROLES),
  validate({ query: outletListQuerySchema }),
  asyncHandler(controller.exportCsv),
);

router.get("/import/template", authorize(...IMPORT_ROLES), controller.importTemplate);
router.get(
  "/import/jobs",
  authorize(...IMPORT_ROLES),
  validate({ query: importJobListQuerySchema }),
  asyncHandler(controller.importJobs),
);
router.post(
  "/import/preview",
  authorize(...IMPORT_ROLES),
  validate({ body: importPreviewSchema }),
  asyncHandler(controller.importPreview),
);
router.post(
  "/import/commit",
  authorize(...IMPORT_ROLES),
  validate({ body: importCommitSchema }),
  asyncHandler(controller.importCommit),
);

router.post(
  "/bulk",
  authorize(...MANAGE_ROLES),
  validate({ body: bulkOutletSchema }),
  asyncHandler(controller.bulk),
);

router.post("/", authorize(...MANAGE_ROLES), validate({ body: outletFormSchema }), asyncHandler(controller.create));

router.get("/:id", authorize(...READ_ROLES), validate({ params: objectIdParamSchema }), asyncHandler(controller.getOne));

router.patch(
  "/:id",
  authorize(...MANAGE_ROLES),
  validate({ params: objectIdParamSchema, body: outletUpdateSchema }),
  asyncHandler(controller.update),
);

router.delete(
  "/:id",
  authorize("Administrator", "Marketing Manager"),
  validate({ params: objectIdParamSchema }),
  asyncHandler(controller.remove),
);

export const outletRoutes = router;
