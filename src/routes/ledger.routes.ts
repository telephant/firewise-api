import { Router } from 'express';
import {
  getLedgers,
  getLedger,
  createLedger,
  updateLedger,
  deleteLedger,
  getLedgerMembers,
  inviteUser,
  removeMember,
} from '../controllers/ledger.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.get('/', getLedgers);
router.post('/', createLedger);
router.get('/:id', getLedger);
router.put('/:id', updateLedger);
router.delete('/:id', deleteLedger);
router.get('/:id/members', getLedgerMembers);
router.post('/:id/invite', inviteUser);
router.delete('/:id/members/:memberId', removeMember);

export default router;
