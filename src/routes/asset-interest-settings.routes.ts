import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  getAssetInterestSettings,
  getAllAssetInterestSettings,
  upsertAssetInterestSettings,
  deleteAssetInterestSettings,
} from '../controllers/asset-interest-settings.controller';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Get all interest settings for user's deposit assets
router.get('/', getAllAssetInterestSettings);

// Get interest settings for a specific asset
router.get('/:assetId', getAssetInterestSettings);

// Create or update interest settings for an asset
router.put('/:assetId', upsertAssetInterestSettings);

// Delete interest settings for an asset
router.delete('/:assetId', deleteAssetInterestSettings);

export default router;
