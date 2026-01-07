"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const fire_linked_ledger_controller_1 = require("../controllers/fire-linked-ledger.controller");
const router = (0, express_1.Router)();
// All routes require authentication
router.use(auth_1.authMiddleware);
// Fire linked ledger routes (user-scoped)
router.get('/', fire_linked_ledger_controller_1.getFireLinkedLedgers);
router.post('/', fire_linked_ledger_controller_1.setFireLinkedLedgers);
exports.default = router;
//# sourceMappingURL=fire-linked-ledger.routes.js.map