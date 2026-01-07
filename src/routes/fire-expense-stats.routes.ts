import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getExpenseStats } from '../controllers/fire-expense-stats.controller';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// GET /api/fire/expense-stats - Get expense statistics for dashboard
router.get('/', getExpenseStats);

export default router;
