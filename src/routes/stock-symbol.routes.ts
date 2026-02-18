import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { searchSymbols } from '../controllers/stock-symbol.controller';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// GET /api/symbols/ticker-search?q=AAPL&region=US&type=stock&limit=10
router.get('/ticker-search', searchSymbols);

export default router;
