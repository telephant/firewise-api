import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { createTransaction } from '../controllers/transaction.controller';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Unified asset transaction endpoint
// POST /api/fire/assets/transaction
// Types: invest, sell, transfer, add
router.post('/', createTransaction);

export default router;
