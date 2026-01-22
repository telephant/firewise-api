import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { analyzeImport, confirmImport } from '../controllers/asset-import.controller';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// POST /api/fire/assets/import/analyze - Analyze file and extract assets
router.post('/analyze', analyzeImport);

// POST /api/fire/assets/import/confirm - Confirm and create assets
router.post('/confirm', confirmImport);

export default router;
