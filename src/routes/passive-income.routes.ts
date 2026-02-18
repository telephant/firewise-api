import { Router } from 'express';
import { getPassiveIncomeStats } from '../controllers/passive-income.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

/**
 * GET /api/fire/passive-income
 * Get passive income stats (interest, dividend, rental, passive_other)
 * Query params: year (optional), month (optional)
 */
router.get('/', getPassiveIncomeStats);

export default router;
