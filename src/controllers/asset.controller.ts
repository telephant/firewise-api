import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse, Asset, AssetFilters } from '../types';
import { AppError } from '../middleware/error';

/**
 * Get all assets for the authenticated user
 * Balance is stored in the database and updated when flows change
 */
export const getAssets = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ assets: Asset[]; total: number }>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { page = '1', limit = '50', type } = req.query as unknown as AssetFilters & { page: string; limit: string };

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = Math.min(parseInt(limit as string, 10) || 50, 100);
    const offset = (pageNum - 1) * limitNum;

    // Build query
    let query = supabaseAdmin
      .from('assets')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (type) {
      query = query.eq('type', type);
    }

    query = query.range(offset, offset + limitNum - 1);

    const { data: assets, error, count } = await query;

    if (error) {
      throw new AppError('Failed to fetch assets', 500);
    }

    res.json({
      success: true,
      data: {
        assets: assets || [],
        total: count || 0,
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to fetch assets' });
  }
};

/**
 * Get a single asset by ID
 * Balance is stored in the database
 */
export const getAsset = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Asset>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const { data: asset, error } = await supabaseAdmin
      .from('assets')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !asset) {
      res.status(404).json({ success: false, error: 'Asset not found' });
      return;
    }

    res.json({
      success: true,
      data: asset,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to fetch asset' });
  }
};

/**
 * Create a new asset
 */
export const createAsset = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Asset>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { name, type, ticker, currency, market, metadata } = req.body;

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ success: false, error: 'Name is required' });
      return;
    }

    if (!type) {
      res.status(400).json({ success: false, error: 'Asset type is required' });
      return;
    }

    const validTypes = ['cash', 'stock', 'etf', 'bond', 'real_estate', 'crypto', 'debt', 'other'];
    if (!validTypes.includes(type)) {
      res.status(400).json({ success: false, error: 'Invalid asset type' });
      return;
    }

    const { data: asset, error } = await supabaseAdmin
      .from('assets')
      .insert({
        user_id: userId,
        name: name.trim(),
        type,
        ticker: ticker?.trim() || null,
        currency: currency || 'USD',
        market: market || null,
        metadata: metadata || null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(400).json({ success: false, error: 'An asset with this name already exists' });
        return;
      }
      throw new AppError('Failed to create asset', 500);
    }

    res.status(201).json({ success: true, data: asset });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to create asset' });
  }
};

/**
 * Update an existing asset
 */
export const updateAsset = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Asset>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const { name, type, ticker, currency, market, metadata } = req.body;

    // Check if asset exists and belongs to user
    const { data: existingAsset, error: fetchError } = await supabaseAdmin
      .from('assets')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (fetchError || !existingAsset) {
      res.status(404).json({ success: false, error: 'Asset not found' });
      return;
    }

    // Note: balance is calculated from flows, not stored in the database
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name.trim();
    if (type !== undefined) updates.type = type;
    if (ticker !== undefined) updates.ticker = ticker?.trim() || null;
    if (currency !== undefined) updates.currency = currency;
    if (market !== undefined) updates.market = market || null;
    if (metadata !== undefined) updates.metadata = metadata;

    const { data: asset, error } = await supabaseAdmin
      .from('assets')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(400).json({ success: false, error: 'An asset with this name already exists' });
        return;
      }
      throw new AppError('Failed to update asset', 500);
    }

    res.json({ success: true, data: asset });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to update asset' });
  }
};

/**
 * Delete an asset (only if no flows reference it)
 */
export const deleteAsset = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    // Check if asset exists and belongs to user
    const { data: existingAsset, error: fetchError } = await supabaseAdmin
      .from('assets')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (fetchError || !existingAsset) {
      res.status(404).json({ success: false, error: 'Asset not found' });
      return;
    }

    // Check if any flows reference this asset
    const { data: flows, error: flowsError } = await supabaseAdmin
      .from('flows')
      .select('id')
      .or(`from_asset_id.eq.${id},to_asset_id.eq.${id}`)
      .limit(1);

    if (flowsError) {
      throw new AppError('Failed to check asset usage', 500);
    }

    if (flows && flows.length > 0) {
      res.status(400).json({
        success: false,
        error: 'Cannot delete asset with existing flows. Delete the flows first.',
      });
      return;
    }

    const { error } = await supabaseAdmin.from('assets').delete().eq('id', id);

    if (error) {
      throw new AppError('Failed to delete asset', 500);
    }

    res.json({ success: true, message: 'Asset deleted successfully' });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to delete asset' });
  }
};
