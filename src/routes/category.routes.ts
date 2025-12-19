import { Router } from 'express';
import { getCategories, createCategory, updateCategory, getCategoryUsage, deleteCategory } from '../controllers/category.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router({ mergeParams: true });

router.use(authMiddleware);

router.get('/', getCategories);
router.post('/', createCategory);
router.put('/:id', updateCategory);
router.get('/:id/usage', getCategoryUsage);
router.delete('/:id', deleteCategory);

export default router;
