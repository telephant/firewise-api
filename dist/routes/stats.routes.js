"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const stats_controller_1 = require("../controllers/stats.controller");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)({ mergeParams: true });
router.use(auth_1.authMiddleware);
router.get('/', stats_controller_1.getExpenseStats);
router.get('/monthly', stats_controller_1.getMonthlyStats);
exports.default = router;
//# sourceMappingURL=stats.routes.js.map