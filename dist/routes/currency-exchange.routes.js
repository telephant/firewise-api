"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const currency_exchange_controller_1 = require("../controllers/currency-exchange.controller");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// All routes require authentication
router.use(auth_1.authMiddleware);
// GET /currency-exchange/search?q=usd - Search currencies
router.get('/search', currency_exchange_controller_1.searchCurrencies);
// GET /currency-exchange/:code - Get single currency by code
router.get('/:code', currency_exchange_controller_1.getCurrency);
exports.default = router;
//# sourceMappingURL=currency-exchange.routes.js.map