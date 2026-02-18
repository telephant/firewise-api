import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { AppError } from '../middleware/error';

export interface UserTaxSettings {
  id: string;
  user_id: string;
  us_dividend_withholding_rate: number;
  us_capital_gains_rate: number;
  sg_dividend_withholding_rate: number;
  sg_capital_gains_rate: number;
  created_at: string;
  updated_at: string;
}

// Get user tax settings (creates default if not exists)
export const getUserTaxSettings = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<UserTaxSettings>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    // Try to get existing settings
    const { data: existingSettings, error: fetchError } = await supabaseAdmin
      .from('user_tax_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      // PGRST116 = no rows found, which is OK
      console.error('Error fetching user tax settings:', fetchError);
      throw new AppError('Failed to fetch tax settings', 500);
    }

    // If settings exist, return them
    if (existingSettings) {
      res.json({ success: true, data: existingSettings });
      return;
    }

    // Create default settings
    const { data: newSettings, error: insertError } = await supabaseAdmin
      .from('user_tax_settings')
      .insert({
        user_id: userId,
        us_dividend_withholding_rate: 0.30, // 30% default
        us_capital_gains_rate: 0.00, // 0% default
        sg_dividend_withholding_rate: 0.00, // 0% default (Singapore has no dividend withholding tax)
        sg_capital_gains_rate: 0.00, // 0% default (Singapore has no capital gains tax)
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating default tax settings:', insertError);
      throw new AppError('Failed to create tax settings', 500);
    }

    res.json({ success: true, data: newSettings });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in getUserTaxSettings:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch tax settings' });
  }
};

// Update user tax settings
export const updateUserTaxSettings = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<UserTaxSettings>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const {
      us_dividend_withholding_rate,
      us_capital_gains_rate,
      sg_dividend_withholding_rate,
      sg_capital_gains_rate,
    } = req.body;

    // Helper to validate rate
    const validateRate = (rate: unknown, fieldName: string): number | null => {
      if (rate === undefined) return null;
      const numRate = Number(rate);
      if (isNaN(numRate) || numRate < 0 || numRate > 1) {
        res.status(400).json({
          success: false,
          error: `${fieldName} must be between 0 and 1`,
        });
        return null;
      }
      return numRate;
    };

    // Validate all rates
    const rates: Record<string, number | undefined> = {};

    if (us_dividend_withholding_rate !== undefined) {
      const validated = validateRate(us_dividend_withholding_rate, 'us_dividend_withholding_rate');
      if (validated === null) return;
      rates.us_dividend_withholding_rate = validated;
    }

    if (us_capital_gains_rate !== undefined) {
      const validated = validateRate(us_capital_gains_rate, 'us_capital_gains_rate');
      if (validated === null) return;
      rates.us_capital_gains_rate = validated;
    }

    if (sg_dividend_withholding_rate !== undefined) {
      const validated = validateRate(sg_dividend_withholding_rate, 'sg_dividend_withholding_rate');
      if (validated === null) return;
      rates.sg_dividend_withholding_rate = validated;
    }

    if (sg_capital_gains_rate !== undefined) {
      const validated = validateRate(sg_capital_gains_rate, 'sg_capital_gains_rate');
      if (validated === null) return;
      rates.sg_capital_gains_rate = validated;
    }

    // Build update object with only provided fields
    const updateData: Record<string, number | string> = {
      updated_at: new Date().toISOString(),
      ...rates,
    };

    // Try to update existing settings
    const { data: updatedSettings, error: updateError } = await supabaseAdmin
      .from('user_tax_settings')
      .update(updateData)
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError && updateError.code === 'PGRST116') {
      // No existing settings, create with provided values
      const { data: newSettings, error: insertError } = await supabaseAdmin
        .from('user_tax_settings')
        .insert({
          user_id: userId,
          us_dividend_withholding_rate: rates.us_dividend_withholding_rate ?? 0.30,
          us_capital_gains_rate: rates.us_capital_gains_rate ?? 0.00,
          sg_dividend_withholding_rate: rates.sg_dividend_withholding_rate ?? 0.00,
          sg_capital_gains_rate: rates.sg_capital_gains_rate ?? 0.00,
        })
        .select()
        .single();

      if (insertError) {
        console.error('Error creating tax settings:', insertError);
        throw new AppError('Failed to update tax settings', 500);
      }

      res.json({ success: true, data: newSettings });
      return;
    }

    if (updateError) {
      console.error('Error updating tax settings:', updateError);
      throw new AppError('Failed to update tax settings', 500);
    }

    res.json({ success: true, data: updatedSettings });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in updateUserTaxSettings:', err);
    res.status(500).json({ success: false, error: 'Failed to update tax settings' });
  }
};
