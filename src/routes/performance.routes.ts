import { Router } from 'express';
import { getPerformance } from '../controllers/performance.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

/**
 * GET /api/fire/performance
 * Get portfolio performance (realized + unrealized P/L)
 */
router.get('/', getPerformance);

export default router;
