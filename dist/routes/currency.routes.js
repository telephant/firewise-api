"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const currency_controller_1 = require("../controllers/currency.controller");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)({ mergeParams: true });
router.use(auth_1.authMiddleware);
router.get('/', currency_controller_1.getCurrencies);
router.post('/', currency_controller_1.createCurrency);
router.put('/:id', currency_controller_1.updateCurrency);
router.get('/:id/usage', currency_controller_1.getCurrencyUsage);
router.delete('/:id', currency_controller_1.deleteCurrency);
exports.default = router;
//# sourceMappingURL=currency.routes.js.map