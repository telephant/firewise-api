import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  listTrades,
  createTrade,
  updateTrade,
  deleteTrade,
} from '../controllers/trade.controller';

const router = Router();

router.use(authMiddleware);

router.get('/:id/trades', listTrades);
router.post('/:id/trades', createTrade);
router.put('/:id/trades/:tradeId', updateTrade);
router.delete('/:id/trades/:tradeId', deleteTrade);

export default router;
