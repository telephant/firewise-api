import { Router } from 'express';
import { getDividendCalendar } from '../controllers/dividend-calendar.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

/**
 * GET /api/fire/dividend-calendar
 * Get dividend calendar data with actual and forecasted dividends
 * Query params: year (optional, defaults to current year)
 */
router.get('/', getDividendCalendar);

export default router;
