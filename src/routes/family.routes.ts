import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  getMyFamily,
  createFamily,
  updateFamily,
  deleteFamily,
  getFamilyMembers,
  removeFamilyMember,
  leaveFamily,
  inviteMember,
  getPendingInvitations,
  resendInvitation,
  cancelInvitation,
  getInvitation,
  acceptInvitation,
  migrateDataToFamily,
} from '../controllers/family.controller';

const router = Router();

// Family management (all require auth)
router.get('/me', authMiddleware, getMyFamily);
router.post('/', authMiddleware, createFamily);
router.put('/:id', authMiddleware, updateFamily);
router.delete('/:id', authMiddleware, deleteFamily);

// Family members
router.get('/:id/members', authMiddleware, getFamilyMembers);
router.delete('/:id/members/:userId', authMiddleware, removeFamilyMember);
router.post('/:id/leave', authMiddleware, leaveFamily);

// Invitations
router.post('/:id/invite', authMiddleware, inviteMember);
router.get('/:id/invitations', authMiddleware, getPendingInvitations);
router.post('/:id/invitations/:invitationId/resend', authMiddleware, resendInvitation);
router.delete('/:id/invitations/:invitationId', authMiddleware, cancelInvitation);

// Data migration
router.post('/:id/migrate-data', authMiddleware, migrateDataToFamily);

export default router;

// Separate router for invitation acceptance (different path)
export const invitationRouter = Router();

// Get invitation details (can be viewed before login)
invitationRouter.get('/:token', getInvitation);

// Accept invitation (requires auth)
invitationRouter.post('/:token/accept', authMiddleware, acceptInvitation);
