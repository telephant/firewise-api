import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  getInterestTrend,
  listInterest,
  addInterest,
  deleteInterest,
} from '../controllers/savings.controller';

const router = Router();
router.use(authMiddleware);

router.get('/', listAccounts);
router.post('/', createAccount);
router.put('/:id', updateAccount);
router.delete('/:id', deleteAccount);

router.get('/interest-trend', getInterestTrend);

router.get('/:id/interest', listInterest);
router.post('/:id/interest', addInterest);
router.delete('/:id/interest/:recordId', deleteInterest);

export default router;
