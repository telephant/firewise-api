import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { AppError } from '../middleware/error';

export interface UserPreferences {
  id: string;
  user_id: string;
  preferred_currency: string;
  convert_all_to_preferred: boolean;
  created_at: string;
  updated_at: string;
}

// Get user preferences (creates default if not exists)
export const getUserPreferences = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<UserPreferences>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    // Try to get existing preferences
    const { data: existingPrefs, error: fetchError } = await supabaseAdmin
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      // PGRST116 = no rows found, which is OK
      console.error('Error fetching user preferences:', fetchError);
      throw new AppError('Failed to fetch preferences', 500);
    }

    // If preferences exist, return them
    if (existingPrefs) {
      res.json({ success: true, data: existingPrefs });
      return;
    }

    // Create default preferences
    const { data: newPrefs, error: insertError } = await supabaseAdmin
      .from('user_preferences')
      .insert({
        user_id: userId,
        preferred_currency: 'USD',
        convert_all_to_preferred: false,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating default preferences:', insertError);
      throw new AppError('Failed to create preferences', 500);
    }

    res.json({ success: true, data: newPrefs });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in getUserPreferences:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch preferences' });
  }
};

// Update user preferences
export const updateUserPreferences = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<UserPreferences>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { preferred_currency, convert_all_to_preferred } = req.body;

    // Validate preferred_currency is a valid 3-letter code
    if (preferred_currency !== undefined) {
      if (typeof preferred_currency !== 'string' || preferred_currency.length !== 3) {
        res.status(400).json({
          success: false,
          error: 'preferred_currency must be a 3-letter currency code',
        });
        return;
      }
    }

    // Validate convert_all_to_preferred is boolean
    if (convert_all_to_preferred !== undefined) {
      if (typeof convert_all_to_preferred !== 'boolean') {
        res.status(400).json({
          success: false,
          error: 'convert_all_to_preferred must be a boolean',
        });
        return;
      }
    }

    // Build update object with only provided fields
    const updateData: Record<string, string | boolean> = {
      updated_at: new Date().toISOString(),
    };
    if (preferred_currency !== undefined) {
      updateData.preferred_currency = preferred_currency.toUpperCase();
    }
    if (convert_all_to_preferred !== undefined) {
      updateData.convert_all_to_preferred = convert_all_to_preferred;
    }

    // Try to update existing preferences
    const { data: updatedPrefs, error: updateError } = await supabaseAdmin
      .from('user_preferences')
      .update(updateData)
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError && updateError.code === 'PGRST116') {
      // No existing preferences, create with provided values
      const { data: newPrefs, error: insertError } = await supabaseAdmin
        .from('user_preferences')
        .insert({
          user_id: userId,
          preferred_currency: preferred_currency?.toUpperCase() || 'USD',
          convert_all_to_preferred: convert_all_to_preferred ?? false,
        })
        .select()
        .single();

      if (insertError) {
        console.error('Error creating preferences:', insertError);
        throw new AppError('Failed to update preferences', 500);
      }

      res.json({ success: true, data: newPrefs });
      return;
    }

    if (updateError) {
      console.error('Error updating preferences:', updateError);
      throw new AppError('Failed to update preferences', 500);
    }

    res.json({ success: true, data: updatedPrefs });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in updateUserPreferences:', err);
    res.status(500).json({ success: false, error: 'Failed to update preferences' });
  }
};
