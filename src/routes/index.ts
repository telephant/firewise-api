import { Router } from 'express';
import authRoutes from './auth.routes';
import ledgerRoutes from './ledger.routes';
import expenseRoutes from './expense.routes';
import categoryRoutes from './category.routes';
import currencyRoutes from './currency.routes';
import paymentMethodRoutes from './payment-method.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/ledgers', ledgerRoutes);
router.use('/ledgers/:ledgerId/expenses', expenseRoutes);
router.use('/ledgers/:ledgerId/categories', categoryRoutes);
router.use('/ledgers/:ledgerId/currencies', currencyRoutes);
router.use('/ledgers/:ledgerId/payment-methods', paymentMethodRoutes);

export default router;
