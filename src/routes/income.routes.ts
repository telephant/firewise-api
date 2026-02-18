import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { createIncome, getIncomeHistory, getIncomeStats } from '../controllers/income.controller';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Income routes
// POST /api/fire/income - Record income
router.post('/', createIncome);

// GET /api/fire/income - Get income history
router.get('/', getIncomeHistory);

// GET /api/fire/income/stats - Get income statistics
router.get('/stats', getIncomeStats);

export default router;
