import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { AppError } from '../middleware/error';

// Payment period options
export type PaymentPeriod =
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'semi_annual'
  | 'annual'
  | 'biennial'      // 2 years
  | 'triennial'     // 3 years
  | 'quinquennial'; // 5 years

export interface AssetInterestSettings {
  id: string;
  asset_id: string;
  interest_rate: number;
  payment_period: PaymentPeriod;
  created_at: string;
  updated_at: string;
}

const VALID_PAYMENT_PERIODS: PaymentPeriod[] = [
  'weekly',
  'monthly',
  'quarterly',
  'semi_annual',
  'annual',
  'biennial',
  'triennial',
  'quinquennial',
];

// Get interest settings for an asset
export const getAssetInterestSettings = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<AssetInterestSettings>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { assetId } = req.params;

    // Verify asset belongs to user
    const { data: asset, error: assetError } = await supabaseAdmin
      .from('assets')
      .select('id')
      .eq('id', assetId)
      .eq('user_id', userId)
      .single();

    if (assetError || !asset) {
      res.status(404).json({ success: false, error: 'Asset not found' });
      return;
    }

    // Get interest settings
    const { data: settings, error: fetchError } = await supabaseAdmin
      .from('asset_interest_settings')
      .select('*')
      .eq('asset_id', assetId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('Error fetching asset interest settings:', fetchError);
      throw new AppError('Failed to fetch interest settings', 500);
    }

    if (!settings) {
      res.status(404).json({ success: false, error: 'Interest settings not found' });
      return;
    }

    res.json({ success: true, data: settings });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in getAssetInterestSettings:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch interest settings' });
  }
};

// Get all interest settings for user's deposit assets
export const getAllAssetInterestSettings = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<AssetInterestSettings[]>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    // Get all user's deposit assets
    const { data: depositAssets, error: assetsError } = await supabaseAdmin
      .from('assets')
      .select('id')
      .eq('user_id', userId)
      .eq('type', 'deposit');

    if (assetsError) {
      console.error('Error fetching deposit assets:', assetsError);
      throw new AppError('Failed to fetch deposit assets', 500);
    }

    if (!depositAssets || depositAssets.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const assetIds = depositAssets.map((a) => a.id);

    // Get interest settings for all deposit assets
    const { data: settings, error: fetchError } = await supabaseAdmin
      .from('asset_interest_settings')
      .select('*')
      .in('asset_id', assetIds);

    if (fetchError) {
      console.error('Error fetching interest settings:', fetchError);
      throw new AppError('Failed to fetch interest settings', 500);
    }

    res.json({ success: true, data: settings || [] });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in getAllAssetInterestSettings:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch interest settings' });
  }
};

// Create or update interest settings for an asset
export const upsertAssetInterestSettings = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<AssetInterestSettings>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { assetId } = req.params;
    const { interest_rate, payment_period } = req.body;

    // Validate interest_rate
    if (interest_rate === undefined || interest_rate === null) {
      res.status(400).json({ success: false, error: 'interest_rate is required' });
      return;
    }

    const rate = Number(interest_rate);
    if (isNaN(rate) || rate < 0 || rate > 1) {
      res.status(400).json({
        success: false,
        error: 'interest_rate must be a number between 0 and 1 (e.g., 0.045 for 4.5%)',
      });
      return;
    }

    // Validate payment_period
    if (payment_period && !VALID_PAYMENT_PERIODS.includes(payment_period)) {
      res.status(400).json({
        success: false,
        error: `payment_period must be one of: ${VALID_PAYMENT_PERIODS.join(', ')}`,
      });
      return;
    }

    // Verify asset belongs to user and is a deposit type
    const { data: asset, error: assetError } = await supabaseAdmin
      .from('assets')
      .select('id, type')
      .eq('id', assetId)
      .eq('user_id', userId)
      .single();

    if (assetError || !asset) {
      res.status(404).json({ success: false, error: 'Asset not found' });
      return;
    }

    if (asset.type !== 'deposit') {
      res.status(400).json({
        success: false,
        error: 'Interest settings can only be set for deposit assets',
      });
      return;
    }

    // Upsert settings
    const { data: settings, error: upsertError } = await supabaseAdmin
      .from('asset_interest_settings')
      .upsert(
        {
          asset_id: assetId,
          interest_rate: rate,
          payment_period: payment_period || 'annual',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'asset_id' }
      )
      .select()
      .single();

    if (upsertError) {
      console.error('Error upserting interest settings:', upsertError);
      throw new AppError('Failed to save interest settings', 500);
    }

    res.json({ success: true, data: settings });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in upsertAssetInterestSettings:', err);
    res.status(500).json({ success: false, error: 'Failed to save interest settings' });
  }
};

// Delete interest settings for an asset
export const deleteAssetInterestSettings = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ deleted: boolean }>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { assetId } = req.params;

    // Verify asset belongs to user
    const { data: asset, error: assetError } = await supabaseAdmin
      .from('assets')
      .select('id')
      .eq('id', assetId)
      .eq('user_id', userId)
      .single();

    if (assetError || !asset) {
      res.status(404).json({ success: false, error: 'Asset not found' });
      return;
    }

    // Delete settings
    const { error: deleteError } = await supabaseAdmin
      .from('asset_interest_settings')
      .delete()
      .eq('asset_id', assetId);

    if (deleteError) {
      console.error('Error deleting interest settings:', deleteError);
      throw new AppError('Failed to delete interest settings', 500);
    }

    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in deleteAssetInterestSettings:', err);
    res.status(500).json({ success: false, error: 'Failed to delete interest settings' });
  }
};
