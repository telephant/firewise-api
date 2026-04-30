import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { AppError } from '../middleware/error';
import { clearFamilyCache } from '../utils/family-context';

interface FamilyWithMembers {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
  members: Array<{
    id: string;
    family_id: string;
    user_id: string;
    role: 'owner' | 'member';
    joined_at: string;
    profile?: {
      full_name: string | null;
      email: string | null;
      avatar_url: string | null;
    };
  }>;
}

// GET /api/family — get current user's family (or null)
export const getMyFamily = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<FamilyWithMembers | null>>
): Promise<void> => {
  try {
    const userId = req.user!.id;

    // Find user's family membership
    const { data: membership } = await supabaseAdmin
      .from('family_members')
      .select('family_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (!membership) {
      res.json({ success: true, data: null });
      return;
    }

    const familyId = membership.family_id;

    // Get family info
    const { data: family, error: familyError } = await supabaseAdmin
      .from('families')
      .select('*')
      .eq('id', familyId)
      .single();

    if (familyError || !family) {
      throw new AppError('Family not found', 404);
    }

    // Get all members with profiles
    const { data: members } = await supabaseAdmin
      .from('family_members')
      .select('*, profile:profiles(full_name, email, avatar_url)')
      .eq('family_id', familyId);

    res.json({
      success: true,
      data: {
        ...family,
        members: members || [],
      },
    });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch family' });
  }
};

// POST /api/family — create a family
export const createFamily = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<FamilyWithMembers>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { name } = req.body;

    if (!name) {
      throw new AppError('name is required', 400);
    }

    // Check if user already belongs to a family
    const { data: existingMembership } = await supabaseAdmin
      .from('family_members')
      .select('family_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (existingMembership) {
      throw new AppError('You are already a member of a family', 409);
    }

    // Create family
    const { data: family, error: familyError } = await supabaseAdmin
      .from('families')
      .insert({ owner_id: userId, name })
      .select()
      .single();

    if (familyError || !family) {
      throw new AppError('Failed to create family', 500);
    }

    // Add creator as owner member
    const { error: memberError } = await supabaseAdmin.from('family_members').insert({
      family_id: family.id,
      user_id: userId,
      role: 'owner',
    });

    if (memberError) {
      // Rollback family creation
      await supabaseAdmin.from('families').delete().eq('id', family.id);
      throw new AppError('Failed to create family membership', 500);
    }

    // Clear cache for this user
    clearFamilyCache(userId);

    // Fetch members with profile
    const { data: members } = await supabaseAdmin
      .from('family_members')
      .select('*, profile:profiles(full_name, email, avatar_url)')
      .eq('family_id', family.id);

    res.status(201).json({
      success: true,
      data: {
        ...family,
        members: members || [],
      },
    });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to create family' });
  }
};

// POST /api/family/invite — invite member by email
export const inviteMember = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ message: string }>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { email } = req.body;

    if (!email) {
      throw new AppError('email is required', 400);
    }

    // Get the current user's family (must be owner)
    const { data: membership } = await supabaseAdmin
      .from('family_members')
      .select('family_id, role')
      .eq('user_id', userId)
      .maybeSingle();

    if (!membership) {
      throw new AppError('You are not a member of any family', 403);
    }

    if (membership.role !== 'owner') {
      throw new AppError('Only the family owner can invite members', 403);
    }

    const familyId = membership.family_id;

    // Look up user by email in profiles
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (!profile) {
      res.status(404).json({
        success: false,
        error: 'User not found. They must sign up first.',
      });
      return;
    }

    const inviteeId = profile.id;

    // Check if already a member
    const { data: existingMembership } = await supabaseAdmin
      .from('family_members')
      .select('id')
      .eq('user_id', inviteeId)
      .maybeSingle();

    if (existingMembership) {
      throw new AppError('User is already a member of a family', 409);
    }

    // Add as member
    const { error } = await supabaseAdmin.from('family_members').insert({
      family_id: familyId,
      user_id: inviteeId,
      role: 'member',
    });

    if (error) {
      throw new AppError('Failed to add member', 500);
    }

    // Clear cache for the new member
    clearFamilyCache(inviteeId);

    res.json({ success: true, data: { message: 'Member added successfully' } });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to invite member' });
  }
};

// DELETE /api/family/members/:userId — remove a member
export const removeMember = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<null>>
): Promise<void> => {
  try {
    const requestingUserId = req.user!.id;
    const targetUserId = req.params.userId;

    // Get the requesting user's family membership (must be owner)
    const { data: membership } = await supabaseAdmin
      .from('family_members')
      .select('family_id, role')
      .eq('user_id', requestingUserId)
      .maybeSingle();

    if (!membership) {
      throw new AppError('You are not a member of any family', 403);
    }

    if (membership.role !== 'owner') {
      throw new AppError('Only the family owner can remove members', 403);
    }

    // Cannot remove yourself (owner)
    if (targetUserId === requestingUserId) {
      throw new AppError('Cannot remove yourself from the family', 400);
    }

    const familyId = membership.family_id;

    const { error } = await supabaseAdmin
      .from('family_members')
      .delete()
      .eq('family_id', familyId)
      .eq('user_id', targetUserId);

    if (error) {
      throw new AppError('Failed to remove member', 500);
    }

    // Clear cache for removed user
    clearFamilyCache(targetUserId);

    res.json({ success: true, data: null });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to remove member' });
  }
};
