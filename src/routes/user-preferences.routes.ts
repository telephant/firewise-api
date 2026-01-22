import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  getUserPreferences,
  updateUserPreferences,
} from '../controllers/user-preferences.controller';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// User preferences routes (user-scoped)
router.get('/', getUserPreferences);
router.put('/', updateUserPreferences);

export default router;
