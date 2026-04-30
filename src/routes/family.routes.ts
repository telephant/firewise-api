import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  ensurePersonalFamily,
  getMyFamilies,
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
} from '../controllers/family.controller';

const router = Router();

// Ensure personal family exists (idempotent, call on login)
router.post('/ensure-personal', authMiddleware, ensurePersonalFamily);

// Get all families the user belongs to
router.get('/me', authMiddleware, getMyFamilies);

// Family management
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

export default router;

export const invitationRouter = Router();
invitationRouter.get('/:token', getInvitation);
invitationRouter.post('/:token/accept', authMiddleware, acceptInvitation);
