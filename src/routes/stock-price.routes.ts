import { Router } from 'express';
import { getStockPrices } from '../controllers/stock-price.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// GET /api/fire/stock-prices?symbols=AAPL,GOOGL
router.get('/', getStockPrices);

export default router;
