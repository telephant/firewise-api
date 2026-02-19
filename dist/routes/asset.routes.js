"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const asset_controller_1 = require("../controllers/asset.controller");
const transaction_controller_1 = require("../controllers/transaction.controller");
const router = (0, express_1.Router)();
// All routes require authentication
router.use(auth_1.authMiddleware);
// Asset routes (user-scoped, not ledger-scoped)
router.get('/', asset_controller_1.getAssets);
router.post('/', asset_controller_1.createAsset);
router.get('/stats/net-worth', asset_controller_1.getNetWorthStats); // Must be before /:id
router.get('/stats/by-type', asset_controller_1.getAssetTypeStats); // Must be before /:id
router.get('/default-cash', asset_controller_1.getDefaultCashAccount); // Must be before /:id
// Unified asset transaction endpoint (invest, sell, transfer, add)
router.post('/transaction', transaction_controller_1.createTransaction);
router.get('/:id', asset_controller_1.getAsset);
router.put('/:id', asset_controller_1.updateAsset);
router.delete('/:id', asset_controller_1.deleteAsset);
exports.default = router;
//# sourceMappingURL=asset.routes.js.map