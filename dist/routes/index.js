"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_routes_1 = __importDefault(require("./auth.routes"));
const ledger_routes_1 = __importDefault(require("./ledger.routes"));
const expense_routes_1 = __importDefault(require("./expense.routes"));
const category_routes_1 = __importDefault(require("./category.routes"));
const currency_routes_1 = __importDefault(require("./currency.routes"));
const payment_method_routes_1 = __importDefault(require("./payment-method.routes"));
const router = (0, express_1.Router)();
router.use('/auth', auth_routes_1.default);
router.use('/ledgers', ledger_routes_1.default);
router.use('/ledgers/:ledgerId/expenses', expense_routes_1.default);
router.use('/categories', category_routes_1.default);
router.use('/currencies', currency_routes_1.default);
router.use('/payment-methods', payment_method_routes_1.default);
exports.default = router;
//# sourceMappingURL=index.js.map