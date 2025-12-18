"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const ledger_controller_1 = require("../controllers/ledger.controller");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.authMiddleware);
router.get('/', ledger_controller_1.getLedgers);
router.post('/', ledger_controller_1.createLedger);
router.get('/:id', ledger_controller_1.getLedger);
router.put('/:id', ledger_controller_1.updateLedger);
router.delete('/:id', ledger_controller_1.deleteLedger);
router.get('/:id/members', ledger_controller_1.getLedgerMembers);
router.post('/:id/invite', ledger_controller_1.inviteUser);
router.delete('/:id/members/:memberId', ledger_controller_1.removeMember);
exports.default = router;
//# sourceMappingURL=ledger.routes.js.map