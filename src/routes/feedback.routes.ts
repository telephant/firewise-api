import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { createFeedback, getUserFeedback } from '../controllers/feedback.controller';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// POST /api/feedback - Create feedback
router.post('/', createFeedback);

// GET /api/feedback - Get user's feedback
router.get('/', getUserFeedback);

export default router;
