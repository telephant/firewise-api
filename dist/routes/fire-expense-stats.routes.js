"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const fire_expense_stats_controller_1 = require("../controllers/fire-expense-stats.controller");
const router = (0, express_1.Router)();
// All routes require authentication
router.use(auth_1.authMiddleware);
// GET /api/fire/expense-stats - Get expense statistics for dashboard
router.get('/', fire_expense_stats_controller_1.getExpenseStats);
exports.default = router;
//# sourceMappingURL=fire-expense-stats.routes.js.map