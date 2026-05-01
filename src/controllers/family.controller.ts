import { Response } from 'express';
import { randomBytes } from 'crypto';
import { supabaseAdmin } from '../config/supabase';
import {
  AuthenticatedRequest,
  ApiResponse,
  Family,
  FamilyMember,
  FamilyInvitation,
  FamilyWithMembers,
  CreateFamilyRequest,
  InviteMemberRequest,
  AcceptInvitationRequest,
} from '../types';
import { AppError } from '../middleware/error';
import { clearFamilyCache, getUserFamilyId } from '../utils/family-context';
import { sendFamilyInvitation } from '../services/email.service';

/**
 * Ensure user has a personal family. Idempotent.
 * POST /fire/families/ensure-personal
 */
export const ensurePersonalFamily = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<FamilyWithMembers>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ success: false, error: 'Unauthorized' }); return; }

    // Check if user already has any family membership
    const { data: existing } = await supabaseAdmin
      .from('family_members')
      .select('family_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();

    if (existing) {
      // Already has a family — fetch and return it
      const { data: family } = await supabaseAdmin
        .from('families')
        .select('*')
        .eq('id', existing.family_id)
        .single();

      const { data: members } = await supabaseAdmin
        .from('family_members')
        .select('id, family_id, user_id, role, joined_at')
        .eq('family_id', existing.family_id);

      const userIds = (members || []).map((m: any) => m.user_id);
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, email, avatar_url')
        .in('id', userIds);

      const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
      const transformedMembers = (members || []).map((m: any) => ({
        ...m,
        profile: profileMap.get(m.user_id),
      }));

      res.json({ success: true, data: { ...family, members: transformedMembers } });
      return;
    }

    // Create personal family
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('full_name, email')
      .eq('id', userId)
      .single();

    const displayName = profile?.full_name || profile?.email?.split('@')[0] || 'My';
    const familyName = `${displayName}'s Space`;

    const { data: newFamily, error: familyError } = await supabaseAdmin
      .from('families')
      .insert({ name: familyName, owner_id: userId })
      .select()
      .single();

    if (familyError || !newFamily) throw new AppError('Failed to create family', 500);

    await supabaseAdmin
      .from('family_members')
      .insert({ family_id: newFamily.id, user_id: userId, role: 'owner' });

    clearFamilyCache(userId);

    res.status(201).json({
      success: true,
      data: {
        ...newFamily,
        members: [{
          id: '',
          family_id: newFamily.id,
          user_id: userId,
          role: 'owner' as const,
          joined_at: new Date().toISOString(),
        }],
      },
    });
  } catch (err) {
    if (err instanceof AppError) { res.status(err.statusCode).json({ success: false, error: err.message }); return; }
    res.status(500).json({ success: false, error: 'Failed to ensure personal family' });
  }
};

/**
 * Get all families the current user belongs to
 * GET /fire/families/me
 */
export const getMyFamilies = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<FamilyWithMembers[]>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ success: false, error: 'Unauthorized' }); return; }

    const { data: memberships, error: memberError } = await supabaseAdmin
      .from('family_members')
      .select('family_id')
      .eq('user_id', userId);

    if (memberError) throw new AppError('Failed to fetch family memberships', 500);
    if (!memberships || memberships.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const familyIds = memberships.map((m: any) => m.family_id);

    const { data: families, error: familiesError } = await supabaseAdmin
      .from('families')
      .select('*')
      .in('id', familyIds);

    if (familiesError) throw new AppError('Failed to fetch families', 500);

    const { data: allMembers, error: membersError } = await supabaseAdmin
      .from('family_members')
      .select('id, family_id, user_id, role, joined_at')
      .in('family_id', familyIds);

    if (membersError) throw new AppError('Failed to fetch family members', 500);

    const userIds = [...new Set((allMembers || []).map((m: any) => m.user_id))];
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email, avatar_url')
      .in('id', userIds);

    const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));

    const result: FamilyWithMembers[] = (families || []).map((family: any) => {
      const members = (allMembers || [])
        .filter((m: any) => m.family_id === family.id)
        .map((m: any) => ({ ...m, profile: profileMap.get(m.user_id) }));
      return { ...family, members };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof AppError) { res.status(err.statusCode).json({ success: false, error: err.message }); return; }
    res.status(500).json({ success: false, error: 'Failed to fetch families' });
  }
};

/**
 * Create a new family
 * POST /fire/families
 */
export const createFamily = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Family>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { name, migrate_data } = req.body as CreateFamilyRequest;

    if (!name || name.trim().length === 0) {
      res.status(400).json({ success: false, error: 'Family name is required' });
      return;
    }

    // Check if user is already in a family
    const existingFamilyId = await getUserFamilyId(userId);
    if (existingFamilyId) {
      res.status(400).json({ success: false, error: 'You are already in a family. Leave it first.' });
      return;
    }

    // Create family
    const { data: family, error: familyError } = await supabaseAdmin
      .from('families')
      .insert({
        name: name.trim(),
        owner_id: userId,
      })
      .select()
      .single();

    if (familyError) throw new AppError('Failed to create family', 500);

    // Add creator as member
    const { error: memberError } = await supabaseAdmin
      .from('family_members')
      .insert({
        family_id: family.id,
        user_id: userId,
        role: 'owner',
      });

    if (memberError) {
      // Rollback family creation
      await supabaseAdmin.from('families').delete().eq('id', family.id);
      throw new AppError('Failed to add member to family', 500);
    }

    // Clear cache
    clearFamilyCache(userId);

    // Migrate data if requested
    let cashBalancesByCurrency: Record<string, number> | undefined;
    if (migrate_data) {
      const migrationResult = await migrateUserDataToFamily(userId, family.id);
      cashBalancesByCurrency = migrationResult.cashBalancesByCurrency;
    }

    // Create family cash account(s) with migrated balances
    await ensureFamilyCashAccount(family.id, userId, cashBalancesByCurrency);

    res.status(201).json({ success: true, data: family });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in createFamily:', err);
    res.status(500).json({ success: false, error: 'Failed to create family' });
  }
};

/**
 * Update family name
 * PUT /fire/families/:id
 */
export const updateFamily = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Family>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { name } = req.body;

    if (!name || name.trim().length === 0) {
      res.status(400).json({ success: false, error: 'Family name is required' });
      return;
    }

    // Verify user is family creator
    const { data: family, error: checkError } = await supabaseAdmin
      .from('families')
      .select('*')
      .eq('id', id)
      .eq('owner_id', userId)
      .single();

    if (checkError || !family) {
      res.status(403).json({ success: false, error: 'Only the family owner can update it' });
      return;
    }

    // Update family
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('families')
      .update({ name: name.trim(), updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw new AppError('Failed to update family', 500);

    res.json({ success: true, data: updated });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in updateFamily:', err);
    res.status(500).json({ success: false, error: 'Failed to update family' });
  }
};

/**
 * Delete family (creator only)
 * DELETE /fire/families/:id
 */
export const deleteFamily = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<void>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    // Verify user is family creator
    const { data: family, error: checkError } = await supabaseAdmin
      .from('families')
      .select('*')
      .eq('id', id)
      .eq('owner_id', userId)
      .single();

    if (checkError || !family) {
      res.status(403).json({ success: false, error: 'Only the family owner can delete it' });
      return;
    }

    // Get all members to clear their cache
    const { data: members } = await supabaseAdmin
      .from('family_members')
      .select('user_id')
      .eq('family_id', id);

    // Delete family (CASCADE will handle members and invitations)
    const { error: deleteError } = await supabaseAdmin
      .from('families')
      .delete()
      .eq('id', id);

    if (deleteError) throw new AppError('Failed to delete family', 500);

    // Clear cache for all members
    (members || []).forEach(m => clearFamilyCache(m.user_id));

    res.json({ success: true, message: 'Family deleted' });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in deleteFamily:', err);
    res.status(500).json({ success: false, error: 'Failed to delete family' });
  }
};

/**
 * Get family members
 * GET /fire/families/:id/members
 */
export const getFamilyMembers = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<FamilyMember[]>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    // Verify user is a member of this family
    const userFamilyId = await getUserFamilyId(userId);
    if (userFamilyId !== id) {
      res.status(403).json({ success: false, error: 'You are not a member of this family' });
      return;
    }

    // Get all members
    const { data: members, error } = await supabaseAdmin
      .from('family_members')
      .select('id, family_id, user_id, joined_at')
      .eq('family_id', id);

    if (error) throw new AppError('Failed to fetch family members', 500);

    // Get profiles for all members
    const userIds = (members || []).map((m: any) => m.user_id);
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email, avatar_url')
      .in('id', userIds);

    if (profilesError) {
      console.error('Error fetching profiles:', profilesError);
    }

    // Create a map of user_id to profile
    const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));

    // Transform members data
    const transformedMembers: FamilyMember[] = (members || []).map((m: any) => {
      const profile = profileMap.get(m.user_id);
      return {
        id: m.id,
        family_id: m.family_id,
        user_id: m.user_id,
        role: m.role,
        joined_at: m.joined_at,
        profile: profile ? {
          full_name: profile.full_name,
          email: profile.email,
          avatar_url: profile.avatar_url,
        } : undefined,
      };
    });

    res.json({ success: true, data: transformedMembers });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in getFamilyMembers:', err);
    res.status(500).json({ success: false, error: 'Failed to get family members' });
  }
};

/**
 * Remove a member from family (creator only, can't remove self)
 * DELETE /fire/families/:id/members/:userId
 */
export const removeFamilyMember = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<void>>
): Promise<void> => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { id, userId: targetUserId } = req.params;

    // Verify current user is family creator
    const { data: family, error: checkError } = await supabaseAdmin
      .from('families')
      .select('*')
      .eq('id', id)
      .eq('owner_id', currentUserId)
      .single();

    if (checkError || !family) {
      res.status(403).json({ success: false, error: 'Only the family owner can remove members' });
      return;
    }

    // Can't remove self (use leave endpoint instead)
    if (targetUserId === currentUserId) {
      res.status(400).json({ success: false, error: 'Use the leave endpoint to leave the family' });
      return;
    }

    // Remove member
    const { error: deleteError } = await supabaseAdmin
      .from('family_members')
      .delete()
      .eq('family_id', id)
      .eq('user_id', targetUserId);

    if (deleteError) throw new AppError('Failed to remove member', 500);

    // Clear cache for removed user
    clearFamilyCache(targetUserId);

    res.json({ success: true, message: 'Member removed' });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in removeFamilyMember:', err);
    res.status(500).json({ success: false, error: 'Failed to remove member' });
  }
};

/**
 * Leave family
 * POST /fire/families/:id/leave
 */
export const leaveFamily = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<void>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    // Verify user is a member
    const { data: membership, error: checkError } = await supabaseAdmin
      .from('family_members')
      .select('*')
      .eq('family_id', id)
      .eq('user_id', userId)
      .single();

    if (checkError || !membership) {
      res.status(403).json({ success: false, error: 'You are not a member of this family' });
      return;
    }

    // Check if user is the owner
    const { data: family } = await supabaseAdmin
      .from('families')
      .select('owner_id')
      .eq('id', id)
      .single();

    if (family?.owner_id === userId) {
      // If creator is leaving, check if there are other members
      const { count } = await supabaseAdmin
        .from('family_members')
        .select('*', { count: 'exact', head: true })
        .eq('family_id', id);

      if (count && count > 1) {
        res.status(400).json({
          success: false,
          error: 'As the creator, you must transfer ownership or remove all members before leaving',
        });
        return;
      }
      // If creator is the only member, delete the family
      const { error: deleteError } = await supabaseAdmin
        .from('families')
        .delete()
        .eq('id', id);

      if (deleteError) throw new AppError('Failed to delete family', 500);
    } else {
      // Remove membership
      const { error: deleteError } = await supabaseAdmin
        .from('family_members')
        .delete()
        .eq('family_id', id)
        .eq('user_id', userId);

      if (deleteError) throw new AppError('Failed to leave family', 500);
    }

    // Clear cache
    clearFamilyCache(userId);

    res.json({ success: true, message: 'Left family' });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in leaveFamily:', err);
    res.status(500).json({ success: false, error: 'Failed to leave family' });
  }
};

/**
 * Send email invitation
 * POST /fire/families/:id/invite
 */
export const inviteMember = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<FamilyInvitation>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { email } = req.body as InviteMemberRequest;

    if (!email || !email.includes('@')) {
      res.status(400).json({ success: false, error: 'Valid email is required' });
      return;
    }

    // Verify user is a member of this family
    const userFamilyId = await getUserFamilyId(userId);
    if (userFamilyId !== id) {
      res.status(403).json({ success: false, error: 'You are not a member of this family' });
      return;
    }

    // Get family and inviter info
    const [familyResult, profileResult] = await Promise.all([
      supabaseAdmin.from('families').select('name').eq('id', id).single(),
      supabaseAdmin.from('profiles').select('full_name, email').eq('id', userId).single(),
    ]);

    if (familyResult.error || !familyResult.data) {
      throw new AppError('Failed to fetch family', 500);
    }

    // Check if already a member (by email)
    const { data: existingUser } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (existingUser) {
      const { data: existingMember } = await supabaseAdmin
        .from('family_members')
        .select('id')
        .eq('family_id', id)
        .eq('user_id', existingUser.id)
        .maybeSingle();

      if (existingMember) {
        res.status(400).json({ success: false, error: 'User is already a member of this family' });
        return;
      }
    }

    // Check for existing pending invitation
    const { data: existingInvite } = await supabaseAdmin
      .from('family_invitations')
      .select('*')
      .eq('family_id', id)
      .eq('email', email.toLowerCase())
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (existingInvite) {
      res.status(400).json({ success: false, error: 'An invitation for this email is already pending' });
      return;
    }

    // Generate token and create invitation
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

    const { data: invitation, error: insertError } = await supabaseAdmin
      .from('family_invitations')
      .insert({
        family_id: id,
        email: email.toLowerCase(),
        token,
        invited_by: userId,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (insertError) throw new AppError('Failed to create invitation', 500);

    // Send email
    const inviterName = profileResult.data?.full_name || profileResult.data?.email || 'A family member';
    await sendFamilyInvitation(email, inviterName, familyResult.data.name, token);

    res.status(201).json({ success: true, data: invitation });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in inviteMember:', err);
    res.status(500).json({ success: false, error: 'Failed to send invitation' });
  }
};

/**
 * Get pending invitations for a family
 * GET /fire/families/:id/invitations
 */
export const getPendingInvitations = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<FamilyInvitation[]>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    // Verify user is a member of this family
    const userFamilyId = await getUserFamilyId(userId);
    if (userFamilyId !== id) {
      res.status(403).json({ success: false, error: 'You are not a member of this family' });
      return;
    }

    // Get pending invitations (not accepted, not expired)
    const { data: invitations, error } = await supabaseAdmin
      .from('family_invitations')
      .select('*')
      .eq('family_id', id)
      .is('accepted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      throw new AppError('Failed to fetch invitations', 500);
    }

    res.json({ success: true, data: invitations || [] });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in getPendingInvitations:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch invitations' });
  }
};

/**
 * Resend invitation email
 * POST /fire/families/:id/invitations/:invitationId/resend
 */
export const resendInvitation = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<FamilyInvitation>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { id, invitationId } = req.params;

    // Verify user is a member of this family
    const userFamilyId = await getUserFamilyId(userId);
    if (userFamilyId !== id) {
      res.status(403).json({ success: false, error: 'You are not a member of this family' });
      return;
    }

    // Get the invitation
    const { data: invitation, error: fetchError } = await supabaseAdmin
      .from('family_invitations')
      .select('*')
      .eq('id', invitationId)
      .eq('family_id', id)
      .is('accepted_at', null)
      .single();

    if (fetchError || !invitation) {
      res.status(404).json({ success: false, error: 'Invitation not found' });
      return;
    }

    // Generate new token and extend expiry
    const newToken = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

    // Update invitation with new token and expiry
    const { data: updatedInvitation, error: updateError } = await supabaseAdmin
      .from('family_invitations')
      .update({
        token: newToken,
        expires_at: expiresAt.toISOString(),
        invited_by: userId, // Update to current resender
      })
      .eq('id', invitationId)
      .select()
      .single();

    if (updateError) {
      throw new AppError('Failed to update invitation', 500);
    }

    // Get family and inviter info for email
    const [familyResult, profileResult] = await Promise.all([
      supabaseAdmin.from('families').select('name').eq('id', id).single(),
      supabaseAdmin.from('profiles').select('full_name, email').eq('id', userId).single(),
    ]);

    // Send email
    const inviterName = profileResult.data?.full_name || profileResult.data?.email || 'A family member';
    await sendFamilyInvitation(
      invitation.email,
      inviterName,
      familyResult.data?.name || 'Family',
      newToken
    );

    res.json({ success: true, data: updatedInvitation });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in resendInvitation:', err);
    res.status(500).json({ success: false, error: 'Failed to resend invitation' });
  }
};

/**
 * Cancel/delete a pending invitation
 * DELETE /fire/families/:id/invitations/:invitationId
 */
export const cancelInvitation = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<void>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { id, invitationId } = req.params;

    // Verify user is a member of this family
    const userFamilyId = await getUserFamilyId(userId);
    if (userFamilyId !== id) {
      res.status(403).json({ success: false, error: 'You are not a member of this family' });
      return;
    }

    // Delete the invitation
    const { error } = await supabaseAdmin
      .from('family_invitations')
      .delete()
      .eq('id', invitationId)
      .eq('family_id', id)
      .is('accepted_at', null);

    if (error) {
      throw new AppError('Failed to cancel invitation', 500);
    }

    res.json({ success: true });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in cancelInvitation:', err);
    res.status(500).json({ success: false, error: 'Failed to cancel invitation' });
  }
};

/**
 * Get invitation details (public endpoint for viewing invite)
 * GET /fire/invitations/:token
 */
export const getInvitation = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ invitation: FamilyInvitation; family: Family }>>
): Promise<void> => {
  try {
    const { token } = req.params;

    // Get invitation with family
    const { data: invitation, error } = await supabaseAdmin
      .from('family_invitations')
      .select(`
        *,
        families (*)
      `)
      .eq('token', token)
      .maybeSingle();

    if (error || !invitation) {
      res.status(404).json({ success: false, error: 'Invitation not found' });
      return;
    }

    // Check if expired
    if (new Date(invitation.expires_at) < new Date()) {
      res.status(400).json({ success: false, error: 'Invitation has expired' });
      return;
    }

    // Check if already accepted
    if (invitation.accepted_at) {
      res.status(400).json({ success: false, error: 'Invitation has already been accepted' });
      return;
    }

    res.json({
      success: true,
      data: {
        invitation: {
          id: invitation.id,
          family_id: invitation.family_id,
          email: invitation.email,
          token: invitation.token,
          invited_by: invitation.invited_by,
          created_at: invitation.created_at,
          expires_at: invitation.expires_at,
          accepted_at: invitation.accepted_at,
        },
        family: invitation.families,
      },
    });
  } catch (err) {
    console.error('Error in getInvitation:', err);
    res.status(500).json({ success: false, error: 'Failed to get invitation' });
  }
};

/**
 * Accept invitation
 * POST /fire/invitations/:token/accept
 */
export const acceptInvitation = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Family>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { token } = req.params;
    const { migrate_data } = req.body as AcceptInvitationRequest;

    // Check if user is already in a family
    const existingFamilyId = await getUserFamilyId(userId);
    if (existingFamilyId) {
      res.status(400).json({ success: false, error: 'You are already in a family. Leave it first.' });
      return;
    }

    // Get invitation
    const { data: invitation, error: inviteError } = await supabaseAdmin
      .from('family_invitations')
      .select('*')
      .eq('token', token)
      .maybeSingle();

    if (inviteError || !invitation) {
      res.status(404).json({ success: false, error: 'Invitation not found' });
      return;
    }

    // Check if expired
    if (new Date(invitation.expires_at) < new Date()) {
      res.status(400).json({ success: false, error: 'Invitation has expired' });
      return;
    }

    // Check if already accepted
    if (invitation.accepted_at) {
      res.status(400).json({ success: false, error: 'Invitation has already been accepted' });
      return;
    }

    // Add user as member
    const { error: memberError } = await supabaseAdmin
      .from('family_members')
      .insert({
        family_id: invitation.family_id,
        user_id: userId,
        role: 'member',
      });

    if (memberError) {
      if (memberError.code === '23505') { // Unique violation
        res.status(400).json({ success: false, error: 'You are already in a family' });
        return;
      }
      throw new AppError('Failed to join family', 500);
    }

    // Mark invitation as accepted
    await supabaseAdmin
      .from('family_invitations')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', invitation.id);

    // Clear cache
    clearFamilyCache(userId);

    // Migrate data if requested
    if (migrate_data) {
      const migrationResult = await migrateUserDataToFamily(userId, invitation.family_id);
      // Create/update family cash account(s) with migrated balances
      await ensureFamilyCashAccount(invitation.family_id, userId, migrationResult.cashBalancesByCurrency);
    }

    // Get family for response
    const { data: family } = await supabaseAdmin
      .from('families')
      .select('*')
      .eq('id', invitation.family_id)
      .single();

    res.json({ success: true, data: family });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in acceptInvitation:', err);
    res.status(500).json({ success: false, error: 'Failed to accept invitation' });
  }
};

/**
 * Migrate user data to family endpoint
 * POST /fire/families/:id/migrate-data
 */
export const migrateDataToFamily = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ migrated: MigrationResult }>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    // Verify user is a member of this family
    const userFamilyId = await getUserFamilyId(userId);
    if (userFamilyId !== id) {
      res.status(403).json({ success: false, error: 'You are not a member of this family' });
      return;
    }

    const migrated = await migrateUserDataToFamily(userId, id);

    // Create/update family cash account(s) with migrated balances
    await ensureFamilyCashAccount(id, userId, migrated.cashBalancesByCurrency);

    res.json({ success: true, data: { migrated } });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in migrateDataToFamily:', err);
    res.status(500).json({ success: false, error: 'Failed to migrate data' });
  }
};

/**
 * Helper: Migrate all user's personal data to family
 * Uses belong_id model: personal data has belong_id = user_id
 * Migrating to family changes belong_id from user_id to family_id
 * user_id (creator) remains unchanged
 */
interface MigrationResult {
  assets: number;
  flows: number;
  debts: number;
  categories: number;
  linkedLedgers: number;
  cashBalancesByCurrency: Record<string, number>;
}

async function migrateUserDataToFamily(
  userId: string,
  familyId: string
): Promise<MigrationResult> {
  const results: MigrationResult = {
    assets: 0,
    flows: 0,
    debts: 0,
    categories: 0,
    linkedLedgers: 0,
    cashBalancesByCurrency: {},
  };

  // Migrate personal data to family by updating belong_id
  // Personal data: belong_id = user_id
  // Family data: belong_id = family_id (user_id stays as creator)

  // Special handling for cash accounts:
  // 1. Keep them as personal (don't migrate belong_id)
  // 2. Set their balance to 0
  // 3. Transfer the total balance to family cash account

  // First, get all personal cash accounts and their balances
  const { data: cashAccounts, error: cashError } = await supabaseAdmin
    .from('assets')
    .select('id, balance, currency')
    .eq('belong_id', userId)
    .eq('type', 'cash');

  if (cashError) {
    console.error('[Family] Error fetching cash accounts:', cashError);
  }

  // Calculate total balance from cash accounts (group by currency)
  const cashBalancesByCurrency: Record<string, number> = {};
  if (cashAccounts && cashAccounts.length > 0) {
    for (const account of cashAccounts) {
      const currency = account.currency || 'USD';
      cashBalancesByCurrency[currency] = (cashBalancesByCurrency[currency] || 0) + (account.balance || 0);
    }

    // Zero out personal cash account balances (keep them personal)
    const { error: zeroError } = await supabaseAdmin
      .from('assets')
      .update({ balance: 0 })
      .eq('belong_id', userId)
      .eq('type', 'cash');

    if (zeroError) {
      console.error('[Family] Error zeroing cash accounts:', zeroError);
    } else {
      console.log(`[Family] Zeroed ${cashAccounts.length} personal cash accounts`);
    }
  }

  // Store cash balances for later use in ensureFamilyCashAccount
  results.cashBalancesByCurrency = cashBalancesByCurrency;

  // Migrate NON-cash assets to family
  const { data: assetsData, error: assetsError } = await supabaseAdmin
    .from('assets')
    .update({ belong_id: familyId })
    .eq('belong_id', userId)
    .neq('type', 'cash')  // Exclude cash accounts
    .select('id');
  if (assetsError) console.error('[Family] Assets migration error:', assetsError);
  results.assets = assetsData?.length || 0;

  // Migrate transactions
  const { data: transactionsData, error: transactionsError } = await supabaseAdmin
    .from('transactions')
    .update({ belong_id: familyId })
    .eq('belong_id', userId)
    .select('id');
  if (transactionsError) console.error('[Family] Transactions migration error:', transactionsError);
  results.flows = transactionsData?.length || 0;

  // Migrate debts
  const { data: debtsData, error: debtsError } = await supabaseAdmin
    .from('debts')
    .update({ belong_id: familyId })
    .eq('belong_id', userId)
    .select('id');
  if (debtsError) console.error('[Family] Debts migration error:', debtsError);
  results.debts = debtsData?.length || 0;

  // Migrate flow expense categories
  const { data: categoriesData, error: categoriesError } = await supabaseAdmin
    .from('flow_expense_categories')
    .update({ belong_id: familyId })
    .eq('belong_id', userId)
    .select('id');
  if (categoriesError) console.error('[Family] Categories migration error:', categoriesError);
  results.categories = categoriesData?.length || 0;

  // Migrate fire linked ledgers
  const { data: linkedLedgersData, error: linkedLedgersError } = await supabaseAdmin
    .from('fire_linked_ledgers')
    .update({ belong_id: familyId })
    .eq('belong_id', userId)
    .select('id');
  if (linkedLedgersError) console.error('[Family] Linked ledgers migration error:', linkedLedgersError);
  results.linkedLedgers = linkedLedgersData?.length || 0;

  console.log(`[Family] Migrated data for user ${userId} to family ${familyId}:`, results);
  return results;
}

/**
 * Helper: Ensure family has at least one cash account
 * Creates cash accounts with migrated balances from personal accounts
 * @param cashBalancesByCurrency - Optional map of currency to balance from migrated personal accounts
 */
async function ensureFamilyCashAccount(
  familyId: string,
  creatorUserId: string,
  cashBalancesByCurrency?: Record<string, number>
): Promise<void> {
  // Check if family already has any cash accounts
  const { data: existingCash, error: checkError } = await supabaseAdmin
    .from('assets')
    .select('id, currency, balance')
    .eq('belong_id', familyId)
    .eq('type', 'cash');

  if (checkError) {
    console.error('[Family] Error checking for cash accounts:', checkError);
    return;
  }

  // If we have balances to migrate
  if (cashBalancesByCurrency && Object.keys(cashBalancesByCurrency).length > 0) {
    for (const [currency, balance] of Object.entries(cashBalancesByCurrency)) {
      if (balance <= 0) continue;

      // Check if family already has a cash account in this currency
      const existingForCurrency = existingCash?.find(a => a.currency === currency);

      if (existingForCurrency) {
        // Add balance to existing account
        const { error: updateError } = await supabaseAdmin
          .from('assets')
          .update({ balance: (existingForCurrency.balance || 0) + balance })
          .eq('id', existingForCurrency.id);

        if (updateError) {
          console.error(`[Family] Error updating ${currency} cash account:`, updateError);
        } else {
          console.log(`[Family] Added ${balance} ${currency} to existing family cash account`);
        }
      } else {
        // Create new cash account for this currency
        const { error: createError } = await supabaseAdmin
          .from('assets')
          .insert({
            user_id: creatorUserId,
            belong_id: familyId,
            name: currency === 'USD' ? 'Primary Account' : `${currency} Account`,
            type: 'cash',
            currency,
            balance,
          });

        if (createError) {
          console.error(`[Family] Error creating ${currency} cash account:`, createError);
        } else {
          console.log(`[Family] Created family ${currency} cash account with balance ${balance}`);
        }
      }
    }
    return;
  }

  // No balances to migrate - just ensure at least one cash account exists
  if (existingCash && existingCash.length > 0) {
    return;
  }

  // Create a default family cash account with 0 balance
  const { error: createError } = await supabaseAdmin
    .from('assets')
    .insert({
      user_id: creatorUserId,
      belong_id: familyId,
      name: 'Primary Account',
      type: 'cash',
      currency: 'USD',
      balance: 0,
    });

  if (createError) {
    console.error('[Family] Error creating default cash account:', createError);
  } else {
    console.log(`[Family] Created default cash account for family ${familyId}`);
  }
}
