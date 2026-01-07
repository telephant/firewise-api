import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  getFireLinkedLedgers,
  setFireLinkedLedgers,
} from '../controllers/fire-linked-ledger.controller';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Fire linked ledger routes (user-scoped)
router.get('/', getFireLinkedLedgers);
router.post('/', setFireLinkedLedgers);

export default router;
