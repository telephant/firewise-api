"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const flow_controller_1 = require("../controllers/flow.controller");
const router = (0, express_1.Router)();
// All routes require authentication
router.use(auth_1.authMiddleware);
/**
 * Flow Routes - Read-Only Audit Log
 *
 * Flows are now an audit log, not the source of truth.
 * POST and PUT have been removed.
 *
 * Use domain-specific APIs for write operations:
 * - POST /fire/assets/transaction (invest, sell, transfer, add)
 * - POST /fire/debts/transaction (create, pay)
 * - POST /fire/income
 * - POST /fire/expense
 */
// Read operations
router.get('/stats', flow_controller_1.getFlowStats); // Must be before /:id to avoid conflict
router.get('/review-count', flow_controller_1.getFlowsNeedingReviewCount); // Must be before /:id to avoid conflict
router.get('/', flow_controller_1.getFlows);
router.get('/:id', flow_controller_1.getFlow);
// Limited write operations (for review flag and manual cleanup)
router.patch('/:id/review', flow_controller_1.markFlowReviewed);
router.delete('/:id', flow_controller_1.deleteFlow);
exports.default = router;
//# sourceMappingURL=flow.routes.js.map