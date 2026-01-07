"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const stock_price_controller_1 = require("../controllers/stock-price.controller");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// All routes require authentication
router.use(auth_1.authMiddleware);
// GET /api/fire/stock-prices?symbols=AAPL,GOOGL
router.get('/', stock_price_controller_1.getStockPrices);
exports.default = router;
//# sourceMappingURL=stock-price.routes.js.map