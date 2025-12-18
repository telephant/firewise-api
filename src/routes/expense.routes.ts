import { Router } from 'express';
import {
  getExpenses,
  getExpense,
  createExpense,
  updateExpense,
  deleteExpense,
} from '../controllers/expense.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router({ mergeParams: true });

router.use(authMiddleware);

router.get('/', getExpenses);
router.post('/', createExpense);
router.get('/:id', getExpense);
router.put('/:id', updateExpense);
router.delete('/:id', deleteExpense);

export default router;
