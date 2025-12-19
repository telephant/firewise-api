import { Router } from 'express';
import { getCurrencies, createCurrency, updateCurrency, getCurrencyUsage, deleteCurrency } from '../controllers/currency.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router({ mergeParams: true });

router.use(authMiddleware);

router.get('/', getCurrencies);
router.post('/', createCurrency);
router.put('/:id', updateCurrency);
router.get('/:id/usage', getCurrencyUsage);
router.delete('/:id', deleteCurrency);

export default router;
