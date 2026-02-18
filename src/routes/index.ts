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
import transactionLogRoutes from './transaction-log.routes';
import expenseCategoryRoutes from './expense-category.routes';
import fireLinkedLedgerRoutes from './fire-linked-ledger.routes';
import fireExpenseStatsRoutes from './fire-expense-stats.routes';
import symbolRoutes from './stock-symbol.routes';
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
import chatRoutes from './chat.routes';
import incomeRoutes from './income.routes';
import fireExpenseRoutes from './fire-expense.routes';
import dividendCalendarRoutes from './dividend-calendar.routes';
import passiveIncomeRoutes from './passive-income.routes';
import monthlySummaryRoutes from './monthly-summary.routes';
import monthlySnapshotRoutes from './monthly-snapshot.routes';

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
router.use('/fire/transactions', transactionLogRoutes);
router.use('/fire/expense-categories', expenseCategoryRoutes);
router.use('/fire/linked-ledgers', fireLinkedLedgerRoutes);
router.use('/fire/expense-stats', fireExpenseStatsRoutes);
router.use('/fire/symbols', symbolRoutes);
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
router.use('/fire/chat', chatRoutes);

// Domain-specific transaction APIs
router.use('/fire/income', incomeRoutes);
router.use('/fire/expense', fireExpenseRoutes);
router.use('/fire/dividend-calendar', dividendCalendarRoutes);
router.use('/fire/passive-income', passiveIncomeRoutes);
router.use('/fire/monthly-summary', monthlySummaryRoutes);
router.use('/fire/snapshots', monthlySnapshotRoutes);

export default router;
