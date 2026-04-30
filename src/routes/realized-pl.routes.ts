import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getRealizedPL } from '../controllers/realized-pl.controller';

const router = Router();

router.use(authMiddleware);

router.get('/:id/realized-pl', getRealizedPL);

export default router;
