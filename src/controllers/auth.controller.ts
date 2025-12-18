import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse, Profile } from '../types';

export const getCurrentUser = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Profile>>
): Promise<void> => {
  try {
    const userId = req.user!.id;

    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      res.status(404).json({
        success: false,
        error: 'Profile not found',
      });
      return;
    }

    res.json({
      success: true,
      data: profile,
    });
  } catch {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user profile',
    });
  }
};
