import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getExchangeRates } from '../controllers/exchange-rate.controller';

const router = Router();

router.use(authMiddleware);

router.get('/', getExchangeRates);

export default router;
