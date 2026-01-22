import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getFlowFreedom } from '../controllers/flow-freedom.controller';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// GET /api/fire/flow-freedom - Get Flow Freedom statistics
router.get('/', getFlowFreedom);

export default router;
