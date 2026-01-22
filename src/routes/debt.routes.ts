import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  getDebts,
  getDebt,
  createDebt,
  updateDebt,
  deleteDebt,
  getDebtPayments,
  getDebtAmortization,
} from '../controllers/debt.controller';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Debt routes (user-scoped)
router.get('/', getDebts);
router.post('/', createDebt);
router.get('/:id', getDebt);
router.put('/:id', updateDebt);
router.delete('/:id', deleteDebt);

// Debt-specific endpoints
router.get('/:id/payments', getDebtPayments);
router.get('/:id/amortization', getDebtAmortization);

export default router;
