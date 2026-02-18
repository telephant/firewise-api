import { Router } from 'express';
import { getMonthlySummary } from '../controllers/monthly-summary.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

/**
 * GET /api/fire/monthly-summary
 * Get monthly summary (income, expenses, debt payments, net)
 * Query params: year (optional), month (optional)
 */
router.get('/', getMonthlySummary);

export default router;
