"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const flow_expense_category_controller_1 = require("../controllers/flow-expense-category.controller");
const router = (0, express_1.Router)();
// All routes require authentication
router.use(auth_1.authMiddleware);
// Flow expense category routes (user-scoped)
router.get('/', flow_expense_category_controller_1.getFlowExpenseCategories);
router.post('/', flow_expense_category_controller_1.createFlowExpenseCategory);
router.put('/:id', flow_expense_category_controller_1.updateFlowExpenseCategory);
router.delete('/:id', flow_expense_category_controller_1.deleteFlowExpenseCategory);
exports.default = router;
//# sourceMappingURL=flow-expense-category.routes.js.map