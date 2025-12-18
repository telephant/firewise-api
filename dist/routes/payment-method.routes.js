"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const payment_method_controller_1 = require("../controllers/payment-method.controller");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.authMiddleware);
router.get('/', payment_method_controller_1.getPaymentMethods);
router.post('/', payment_method_controller_1.createPaymentMethod);
router.delete('/:id', payment_method_controller_1.deletePaymentMethod);
exports.default = router;
//# sourceMappingURL=payment-method.routes.js.map