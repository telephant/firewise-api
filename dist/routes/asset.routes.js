"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const asset_controller_1 = require("../controllers/asset.controller");
const router = (0, express_1.Router)();
// All routes require authentication
router.use(auth_1.authMiddleware);
// Asset routes (user-scoped, not ledger-scoped)
router.get('/', asset_controller_1.getAssets);
router.post('/', asset_controller_1.createAsset);
router.get('/:id', asset_controller_1.getAsset);
router.put('/:id', asset_controller_1.updateAsset);
router.delete('/:id', asset_controller_1.deleteAsset);
exports.default = router;
//# sourceMappingURL=asset.routes.js.map