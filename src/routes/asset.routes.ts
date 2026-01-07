import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  getAssets,
  getAsset,
  createAsset,
  updateAsset,
  deleteAsset,
} from '../controllers/asset.controller';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Asset routes (user-scoped, not ledger-scoped)
router.get('/', getAssets);
router.post('/', createAsset);
router.get('/:id', getAsset);
router.put('/:id', updateAsset);
router.delete('/:id', deleteAsset);

export default router;
