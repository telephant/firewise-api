"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const stock_symbol_controller_1 = require("../controllers/stock-symbol.controller");
const router = (0, express_1.Router)();
// All routes require authentication
router.use(auth_1.authMiddleware);
// GET /api/stock-symbols/us?search=AAPL
router.get('/us', stock_symbol_controller_1.searchUsSymbols);
exports.default = router;
//# sourceMappingURL=stock-symbol.routes.js.map