"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const category_controller_1 = require("../controllers/category.controller");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.authMiddleware);
router.get('/', category_controller_1.getCategories);
router.post('/', category_controller_1.createCategory);
router.delete('/:id', category_controller_1.deleteCategory);
exports.default = router;
//# sourceMappingURL=category.routes.js.map