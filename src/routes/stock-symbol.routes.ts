import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { searchUsSymbols } from '../controllers/stock-symbol.controller';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// GET /api/stock-symbols/us?search=AAPL
router.get('/us', searchUsSymbols);

export default router;
