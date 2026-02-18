import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { createFireExpense, getFireExpenseHistory, getFireExpenseStats } from '../controllers/fire-expense.controller';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Fire expense routes
// POST /api/fire/expense - Record expense
router.post('/', createFireExpense);

// GET /api/fire/expense - Get expense history
router.get('/', getFireExpenseHistory);

// GET /api/fire/expense/stats - Get expense statistics
router.get('/stats', getFireExpenseStats);

export default router;
