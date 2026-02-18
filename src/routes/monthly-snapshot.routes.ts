import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  getSnapshots,
  getSnapshot,
  compareSnapshots,
  getNetWorthTrend,
} from '../controllers/monthly-snapshot.controller';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// GET /api/fire/snapshots - Get monthly snapshots list
router.get('/', getSnapshots);

// GET /api/fire/snapshots/compare - Compare two months
router.get('/compare', compareSnapshots);

// GET /api/fire/snapshots/trend - Get net worth trend
router.get('/trend', getNetWorthTrend);

// GET /api/fire/snapshots/:year/:month - Get specific month's snapshot
router.get('/:year/:month', getSnapshot);

export default router;
