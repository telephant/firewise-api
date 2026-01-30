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
import userTaxSettingsRoutes from './user-tax-settings.routes';
import assetInterestSettingsRoutes from './asset-interest-settings.routes';
import userPreferencesRoutes from './user-preferences.routes';
import debtRoutes from './debt.routes';
import recurringScheduleRoutes from './recurring-schedule.routes';
import flowFreedomRoutes from './flow-freedom.routes';
import runwayRoutes from './runway.routes';
import assetImportRoutes from './asset-import.routes';
import financialStatsRoutes from './financial-stats.routes';
import familyRoutes, { invitationRouter } from './family.routes';

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
router.use('/fire/tax-settings', userTaxSettingsRoutes);
router.use('/fire/asset-interest-settings', assetInterestSettingsRoutes);
router.use('/fire/user-preferences', userPreferencesRoutes);
router.use('/fire/debts', debtRoutes);
router.use('/fire/recurring-schedules', recurringScheduleRoutes);
router.use('/fire/flow-freedom', flowFreedomRoutes);
router.use('/fire/runway', runwayRoutes);
router.use('/fire/assets/import', assetImportRoutes);
router.use('/fire/financial-stats', financialStatsRoutes);
router.use('/fire/families', familyRoutes);
router.use('/fire/invitations', invitationRouter);

export default router;
