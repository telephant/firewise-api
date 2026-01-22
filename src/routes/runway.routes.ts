import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getRunway } from '../controllers/runway.controller';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// GET /api/fire/runway - Get runway projection
router.get('/', getRunway);

export default router;
