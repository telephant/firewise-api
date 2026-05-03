import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { listCommodities } from '../controllers/commodity.controller';

const router = Router();

router.use(authMiddleware);

router.get('/', listCommodities);

export default router;
