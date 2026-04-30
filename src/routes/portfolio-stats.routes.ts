import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getPortfolioStats, listSnapshots } from '../controllers/portfolio-stats.controller';

const router = Router();

router.use(authMiddleware);

router.get('/:id/stats', getPortfolioStats);
router.get('/:id/snapshots', listSnapshots);

export default router;
