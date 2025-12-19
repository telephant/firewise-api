import { Router } from 'express';
import {
  getPaymentMethods,
  createPaymentMethod,
  updatePaymentMethod,
  getPaymentMethodUsage,
  deletePaymentMethod,
} from '../controllers/payment-method.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router({ mergeParams: true });

router.use(authMiddleware);

router.get('/', getPaymentMethods);
router.post('/', createPaymentMethod);
router.put('/:id', updatePaymentMethod);
router.get('/:id/usage', getPaymentMethodUsage);
router.delete('/:id', deletePaymentMethod);

export default router;
