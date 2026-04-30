import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  getMyFamily,
  createFamily,
  inviteMember,
  removeMember,
} from '../controllers/portfolio-family.controller';

const router = Router();

router.use(authMiddleware);

router.get('/', getMyFamily);
router.post('/', createFamily);
router.post('/invite', inviteMember);
router.delete('/members/:userId', removeMember);

export default router;
