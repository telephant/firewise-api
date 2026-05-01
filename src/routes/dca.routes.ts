import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  listPlans,
  createPlan,
  updatePlan,
  deletePlan,
  listPending,
  confirmPending,
  skipPending,
  processDca,
} from '../controllers/dca.controller';

const router = Router();

router.get('/plans', authMiddleware, listPlans);
router.post('/plans', authMiddleware, createPlan);
router.put('/plans/:id', authMiddleware, updatePlan);
router.delete('/plans/:id', authMiddleware, deletePlan);

router.get('/pending', authMiddleware, listPending);
router.post('/pending/:id/confirm', authMiddleware, confirmPending);
router.post('/pending/:id/skip', authMiddleware, skipPending);

router.post('/process', authMiddleware, processDca);

export default router;
