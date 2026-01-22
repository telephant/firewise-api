import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  getUserTaxSettings,
  updateUserTaxSettings,
} from '../controllers/user-tax-settings.controller';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// User tax settings routes (user-scoped)
router.get('/', getUserTaxSettings);
router.put('/', updateUserTaxSettings);

export default router;
