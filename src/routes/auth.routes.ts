import { Router } from 'express';
import { getCurrentUser } from '../controllers/auth.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.get('/me', authMiddleware, getCurrentUser);

export default router;
