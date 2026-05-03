import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { listCommodities } from '../controllers/commodity.controller';

const router = Router();

router.get('/', authMiddleware, listCommodities);

export default router;
