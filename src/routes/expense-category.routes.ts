import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  getExpenseCategories,
  createExpenseCategory,
  updateExpenseCategory,
  deleteExpenseCategory,
} from '../controllers/expense-category.controller';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Expense category routes (user-scoped)
router.get('/', getExpenseCategories);
router.post('/', createExpenseCategory);
router.put('/:id', updateExpenseCategory);
router.delete('/:id', deleteExpenseCategory);

export default router;
