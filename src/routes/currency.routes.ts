import { Router } from 'express';
import { getCurrencies, createCurrency } from '../controllers/currency.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.get('/', getCurrencies);
router.post('/', createCurrency);

export default router;
