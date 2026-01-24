import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getStats, clearCache } from '../controllers/financial-stats.controller';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// GET /api/fire/financial-stats - Get cached financial stats
router.get('/', getStats);

// POST /api/fire/financial-stats/clear-cache - Clear cache
router.post('/clear-cache', clearCache);

export default router;
