"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const flow_controller_1 = require("../controllers/flow.controller");
const router = (0, express_1.Router)();
// All routes require authentication
router.use(auth_1.authMiddleware);
// Flow routes (user-scoped, not ledger-scoped)
router.get('/stats', flow_controller_1.getFlowStats); // Must be before /:id to avoid conflict
router.get('/', flow_controller_1.getFlows);
router.post('/', flow_controller_1.createFlow);
router.get('/:id', flow_controller_1.getFlow);
router.put('/:id', flow_controller_1.updateFlow);
router.delete('/:id', flow_controller_1.deleteFlow);
exports.default = router;
//# sourceMappingURL=flow.routes.js.map