import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getNextDividend } from '../controllers/next-dividend.controller';

const router = Router();

router.use(authMiddleware);
router.get('/', getNextDividend);

export default router;
