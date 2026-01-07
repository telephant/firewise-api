import { Router } from 'express';
import authRoutes from './auth.routes';
import ledgerRoutes from './ledger.routes';
import expenseRoutes from './expense.routes';
import categoryRoutes from './category.routes';
import currencyRoutes from './currency.routes';
import currencyExchangeRoutes from './currency-exchange.routes';
import paymentMethodRoutes from './payment-method.routes';
import statsRoutes from './stats.routes';
import assetRoutes from './asset.routes';
import flowRoutes from './flow.routes';
import flowExpenseCategoryRoutes from './flow-expense-category.routes';
import fireLinkedLedgerRoutes from './fire-linked-ledger.routes';
import fireExpenseStatsRoutes from './fire-expense-stats.routes';
import stockSymbolRoutes from './stock-symbol.routes';
import stockPriceRoutes from './stock-price.routes';
import feedbackRoutes from './feedback.routes';

const router = Router();

// Auth routes
router.use('/auth', authRoutes);

// Global currency exchange search (not ledger-scoped)
router.use('/currency-exchange', currencyExchangeRoutes);

// Ledger-scoped routes (expense tracker)
router.use('/ledgers', ledgerRoutes);
router.use('/ledgers/:ledgerId/expenses', expenseRoutes);
router.use('/ledgers/:ledgerId/categories', categoryRoutes);
router.use('/ledgers/:ledgerId/currencies', currencyRoutes);
router.use('/ledgers/:ledgerId/payment-methods', paymentMethodRoutes);
router.use('/ledgers/:ledgerId/stats', statsRoutes);

// User-scoped routes (FIRE management) - all under /fire prefix
router.use('/fire/assets', assetRoutes);
router.use('/fire/flows', flowRoutes);
router.use('/fire/flow-expense-categories', flowExpenseCategoryRoutes);
router.use('/fire/linked-ledgers', fireLinkedLedgerRoutes);
router.use('/fire/expense-stats', fireExpenseStatsRoutes);
router.use('/fire/stock-symbols', stockSymbolRoutes);
router.use('/fire/stock-prices', stockPriceRoutes);
router.use('/fire/feedback', feedbackRoutes);

export default router;
