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
 * Get current user's family
 * GET /fire/families/me
 */
export const getMyFamily = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<FamilyWithMembers | null>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    // Get user's family membership
    const { data: membership, error: memberError } = await supabaseAdmin
      .from('family_members')
      .select('family_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (memberError) throw new AppError('Failed to fetch family membership', 500);

    if (!membership) {
      res.json({ success: true, data: null });
      return;
    }

    // Get family with members
    const { data: family, error: familyError } = await supabaseAdmin
      .from('families')
      .select('*')
      .eq('id', membership.family_id)
      .single();

    if (familyError) throw new AppError('Failed to fetch family', 500);

    // Get all members
    const { data: members, error: membersError } = await supabaseAdmin
      .from('family_members')
      .select('id, family_id, user_id, joined_at')
      .eq('family_id', membership.family_id);

    if (membersError) throw new AppError('Failed to fetch family members', 500);

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
        joined_at: m.joined_at,
        profile: profile ? {
          full_name: profile.full_name,
          email: profile.email,
          avatar_url: profile.avatar_url,
        } : undefined,
      };
    });

    res.json({
      success: true,
      data: {
        ...family,
        members: transformedMembers,
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in getMyFamily:', err);
    res.status(500).json({ success: false, error: 'Failed to get family' });
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
        created_by: userId,
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
      });

    if (memberError) {
      // Rollback family creation
      await supabaseAdmin.from('families').delete().eq('id', family.id);
      throw new AppError('Failed to add member to family', 500);
    }

    // Clear cache
    clearFamilyCache(userId);

    // Migrate data if requested
    if (migrate_data) {
      await migrateUserDataToFamily(userId, family.id);
    }

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
      .eq('created_by', userId)
      .single();

    if (checkError || !family) {
      res.status(403).json({ success: false, error: 'Only the family creator can update it' });
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
      .eq('created_by', userId)
      .single();

    if (checkError || !family) {
      res.status(403).json({ success: false, error: 'Only the family creator can delete it' });
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
      .eq('created_by', currentUserId)
      .single();

    if (checkError || !family) {
      res.status(403).json({ success: false, error: 'Only the family creator can remove members' });
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

    // Check if user is the creator
    const { data: family } = await supabaseAdmin
      .from('families')
      .select('created_by')
      .eq('id', id)
      .single();

    if (family?.created_by === userId) {
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
      await migrateUserDataToFamily(userId, invitation.family_id);
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
  res: Response<ApiResponse<{ migrated: { assets: number; flows: number; debts: number; schedules: number; categories: number } }>>
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
async function migrateUserDataToFamily(
  userId: string,
  familyId: string
): Promise<{ assets: number; flows: number; debts: number; schedules: number; categories: number; linkedLedgers: number }> {
  const results = { assets: 0, flows: 0, debts: 0, schedules: 0, categories: 0, linkedLedgers: 0 };

  // Migrate personal data to family by updating belong_id
  // Personal data: belong_id = user_id
  // Family data: belong_id = family_id (user_id stays as creator)

  // Migrate assets - change belong_id from user_id to family_id
  const { data: assetsData, error: assetsError } = await supabaseAdmin
    .from('assets')
    .update({ belong_id: familyId })
    .eq('belong_id', userId)
    .select('id');
  if (assetsError) console.error('[Family] Assets migration error:', assetsError);
  results.assets = assetsData?.length || 0;

  // Migrate flows
  const { data: flowsData, error: flowsError } = await supabaseAdmin
    .from('flows')
    .update({ belong_id: familyId })
    .eq('belong_id', userId)
    .select('id');
  if (flowsError) console.error('[Family] Flows migration error:', flowsError);
  results.flows = flowsData?.length || 0;

  // Migrate debts
  const { data: debtsData, error: debtsError } = await supabaseAdmin
    .from('debts')
    .update({ belong_id: familyId })
    .eq('belong_id', userId)
    .select('id');
  if (debtsError) console.error('[Family] Debts migration error:', debtsError);
  results.debts = debtsData?.length || 0;

  // Migrate recurring schedules
  const { data: schedulesData, error: schedulesError } = await supabaseAdmin
    .from('recurring_schedules')
    .update({ belong_id: familyId })
    .eq('belong_id', userId)
    .select('id');
  if (schedulesError) console.error('[Family] Schedules migration error:', schedulesError);
  results.schedules = schedulesData?.length || 0;

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
