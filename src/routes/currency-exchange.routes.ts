import { Router } from 'express';
import { searchCurrencies, getCurrency } from '../controllers/currency-exchange.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// GET /currency-exchange/search?q=usd - Search currencies
router.get('/search', searchCurrencies);

// GET /currency-exchange/:code - Get single currency by code
router.get('/:code', getCurrency);

export default router;
