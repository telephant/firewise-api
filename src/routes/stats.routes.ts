import { Router } from 'express';
import { getExpenseStats, getMonthlyStats, getFrequentExpenses } from '../controllers/stats.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router({ mergeParams: true });

router.use(authMiddleware);

router.get('/', getExpenseStats);
router.get('/monthly', getMonthlyStats);
router.get('/frequent', getFrequentExpenses);

export default router;
