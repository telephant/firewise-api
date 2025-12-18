import { Router } from 'express';
import {
  getPaymentMethods,
  createPaymentMethod,
  deletePaymentMethod,
} from '../controllers/payment-method.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.get('/', getPaymentMethods);
router.post('/', createPaymentMethod);
router.delete('/:id', deletePaymentMethod);

export default router;
