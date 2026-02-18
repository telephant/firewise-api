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
  createDebtTransaction,
} from '../controllers/debt.controller';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Debt routes (user-scoped)
router.get('/', getDebts);
router.post('/', createDebt);

// Unified debt transaction endpoint (create debt or make payment)
router.post('/transaction', createDebtTransaction);

router.get('/:id', getDebt);
router.put('/:id', updateDebt);
router.delete('/:id', deleteDebt);

// Debt-specific endpoints
router.get('/:id/payments', getDebtPayments);
router.get('/:id/amortization', getDebtAmortization);

export default router;
