import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  getFlowExpenseCategories,
  createFlowExpenseCategory,
  updateFlowExpenseCategory,
  deleteFlowExpenseCategory,
} from '../controllers/flow-expense-category.controller';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Flow expense category routes (user-scoped)
router.get('/', getFlowExpenseCategories);
router.post('/', createFlowExpenseCategory);
router.put('/:id', updateFlowExpenseCategory);
router.delete('/:id', deleteFlowExpenseCategory);

export default router;
