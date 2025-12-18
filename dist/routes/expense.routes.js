"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const expense_controller_1 = require("../controllers/expense.controller");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)({ mergeParams: true });
router.use(auth_1.authMiddleware);
router.get('/', expense_controller_1.getExpenses);
router.post('/', expense_controller_1.createExpense);
router.get('/:id', expense_controller_1.getExpense);
router.put('/:id', expense_controller_1.updateExpense);
router.delete('/:id', expense_controller_1.deleteExpense);
exports.default = router;
//# sourceMappingURL=expense.routes.js.map