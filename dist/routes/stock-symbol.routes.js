"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const stock_symbol_controller_1 = require("../controllers/stock-symbol.controller");
const router = (0, express_1.Router)();
// All routes require authentication
router.use(auth_1.authMiddleware);
// GET /api/symbols/ticker-search?q=AAPL&region=US&type=stock&limit=10
router.get('/ticker-search', stock_symbol_controller_1.searchSymbols);
exports.default = router;
//# sourceMappingURL=stock-symbol.routes.js.map