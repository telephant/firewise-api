import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  listPortfolios,
  createPortfolio,
  getPortfolio,
  updatePortfolio,
  deletePortfolio,
} from '../controllers/portfolio.controller';
import { getAnalytics } from '../controllers/analytics.controller';

const router = Router();

router.use(authMiddleware);

router.get('/', listPortfolios);
router.post('/', createPortfolio);
router.get('/:id/analytics', getAnalytics);
router.get('/:id', getPortfolio);
router.put('/:id', updatePortfolio);
router.delete('/:id', deletePortfolio);

export default router;
