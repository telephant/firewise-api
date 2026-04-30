import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getHoldings } from '../controllers/holding.controller';

const router = Router();

router.use(authMiddleware);

router.get('/:id/holdings', getHoldings);

export default router;
