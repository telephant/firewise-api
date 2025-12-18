import { Router } from 'express';
import { getCategories, createCategory, deleteCategory } from '../controllers/category.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.get('/', getCategories);
router.post('/', createCategory);
router.delete('/:id', deleteCategory);

export default router;
