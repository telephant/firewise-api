import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  getTransactions,
  getTransaction,
  deleteTransaction,
  getTransactionStats,
  markTransactionReviewed,
  getTransactionsNeedingReviewCount,
} from '../controllers/transaction-log.controller';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

/**
 * Transaction Log Routes - Read-Only Audit Log
 *
 * Transactions are the single source of truth for all financial movements.
 * This provides read access to transaction history.
 *
 * Use domain-specific APIs for write operations:
 * - POST /fire/assets/transaction (invest, sell, transfer, add)
 * - POST /fire/debts/transaction (create, pay)
 * - POST /fire/income
 * - POST /fire/expense
 */

// Read operations
router.get('/stats', getTransactionStats); // Must be before /:id to avoid conflict
router.get('/review-count', getTransactionsNeedingReviewCount); // Must be before /:id to avoid conflict
router.get('/', getTransactions);
router.get('/:id', getTransaction);

// Limited write operations (for review flag and manual cleanup)
router.patch('/:id/review', markTransactionReviewed);
router.delete('/:id', deleteTransaction);

export default router;
