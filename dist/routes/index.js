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
const currency_exchange_routes_1 = __importDefault(require("./currency-exchange.routes"));
const payment_method_routes_1 = __importDefault(require("./payment-method.routes"));
const stats_routes_1 = __importDefault(require("./stats.routes"));
const asset_routes_1 = __importDefault(require("./asset.routes"));
const flow_routes_1 = __importDefault(require("./flow.routes"));
const flow_expense_category_routes_1 = __importDefault(require("./flow-expense-category.routes"));
const fire_linked_ledger_routes_1 = __importDefault(require("./fire-linked-ledger.routes"));
const fire_expense_stats_routes_1 = __importDefault(require("./fire-expense-stats.routes"));
const stock_symbol_routes_1 = __importDefault(require("./stock-symbol.routes"));
const stock_price_routes_1 = __importDefault(require("./stock-price.routes"));
const feedback_routes_1 = __importDefault(require("./feedback.routes"));
const user_tax_settings_routes_1 = __importDefault(require("./user-tax-settings.routes"));
const asset_interest_settings_routes_1 = __importDefault(require("./asset-interest-settings.routes"));
const user_preferences_routes_1 = __importDefault(require("./user-preferences.routes"));
const debt_routes_1 = __importDefault(require("./debt.routes"));
const recurring_schedule_routes_1 = __importDefault(require("./recurring-schedule.routes"));
const flow_freedom_routes_1 = __importDefault(require("./flow-freedom.routes"));
const runway_routes_1 = __importDefault(require("./runway.routes"));
const asset_import_routes_1 = __importDefault(require("./asset-import.routes"));
const financial_stats_routes_1 = __importDefault(require("./financial-stats.routes"));
const router = (0, express_1.Router)();
// Auth routes
router.use('/auth', auth_routes_1.default);
// Global currency exchange search (not ledger-scoped)
router.use('/currency-exchange', currency_exchange_routes_1.default);
// Ledger-scoped routes (expense tracker)
router.use('/ledgers', ledger_routes_1.default);
router.use('/ledgers/:ledgerId/expenses', expense_routes_1.default);
router.use('/ledgers/:ledgerId/categories', category_routes_1.default);
router.use('/ledgers/:ledgerId/currencies', currency_routes_1.default);
router.use('/ledgers/:ledgerId/payment-methods', payment_method_routes_1.default);
router.use('/ledgers/:ledgerId/stats', stats_routes_1.default);
// User-scoped routes (FIRE management) - all under /fire prefix
router.use('/fire/assets', asset_routes_1.default);
router.use('/fire/flows', flow_routes_1.default);
router.use('/fire/flow-expense-categories', flow_expense_category_routes_1.default);
router.use('/fire/linked-ledgers', fire_linked_ledger_routes_1.default);
router.use('/fire/expense-stats', fire_expense_stats_routes_1.default);
router.use('/fire/stock-symbols', stock_symbol_routes_1.default);
router.use('/fire/stock-prices', stock_price_routes_1.default);
router.use('/fire/feedback', feedback_routes_1.default);
router.use('/fire/tax-settings', user_tax_settings_routes_1.default);
router.use('/fire/asset-interest-settings', asset_interest_settings_routes_1.default);
router.use('/fire/user-preferences', user_preferences_routes_1.default);
router.use('/fire/debts', debt_routes_1.default);
router.use('/fire/recurring-schedules', recurring_schedule_routes_1.default);
router.use('/fire/flow-freedom', flow_freedom_routes_1.default);
router.use('/fire/runway', runway_routes_1.default);
router.use('/fire/assets/import', asset_import_routes_1.default);
router.use('/fire/financial-stats', financial_stats_routes_1.default);
exports.default = router;
//# sourceMappingURL=index.js.map