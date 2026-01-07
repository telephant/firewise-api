"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const feedback_controller_1 = require("../controllers/feedback.controller");
const router = (0, express_1.Router)();
// All routes require authentication
router.use(auth_1.authMiddleware);
// POST /api/feedback - Create feedback
router.post('/', feedback_controller_1.createFeedback);
// GET /api/feedback - Get user's feedback
router.get('/', feedback_controller_1.getUserFeedback);
exports.default = router;
//# sourceMappingURL=feedback.routes.js.map