import { Router } from 'express';
import { getCurrencies, createCurrency, deleteCurrency } from '../controllers/currency.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router({ mergeParams: true });

router.use(authMiddleware);

router.get('/', getCurrencies);
router.post('/', createCurrency);
router.delete('/:id', deleteCurrency);

export default router;
