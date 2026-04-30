import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  listDividends,
  createDividend,
  updateDividend,
  deleteDividend,
} from '../controllers/dividend.controller';

const router = Router();

router.use(authMiddleware);

router.get('/:id/dividends', listDividends);
router.post('/:id/dividends', createDividend);
router.put('/:id/dividends/:dividendId', updateDividend);
router.delete('/:id/dividends/:dividendId', deleteDividend);

export default router;
