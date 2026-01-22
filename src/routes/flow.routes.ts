import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  getFlows,
  getFlow,
  createFlow,
  updateFlow,
  deleteFlow,
  getFlowStats,
  markFlowReviewed,
  getFlowsNeedingReviewCount,
} from '../controllers/flow.controller';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Flow routes (user-scoped, not ledger-scoped)
router.get('/stats', getFlowStats); // Must be before /:id to avoid conflict
router.get('/review-count', getFlowsNeedingReviewCount); // Must be before /:id to avoid conflict
router.get('/', getFlows);
router.post('/', createFlow);
router.get('/:id', getFlow);
router.put('/:id', updateFlow);
router.patch('/:id/review', markFlowReviewed);
router.delete('/:id', deleteFlow);

export default router;
