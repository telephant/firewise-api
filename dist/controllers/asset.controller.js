"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteAsset = exports.updateAsset = exports.createAsset = exports.getAsset = exports.getAssets = void 0;
const supabase_1 = require("../config/supabase");
const error_1 = require("../middleware/error");
/**
 * Get all assets for the authenticated user
 * Balance is stored in the database and updated when flows change
 */
const getAssets = async (req, res) => {
    try {
        const userId = req.user.id;
        const { page = '1', limit = '50', type } = req.query;
        const pageNum = parseInt(page, 10) || 1;
        const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
        const offset = (pageNum - 1) * limitNum;
        // Build query
        let query = supabase_1.supabaseAdmin
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
            throw new error_1.AppError('Failed to fetch assets', 500);
        }
        res.json({
            success: true,
            data: {
                assets: assets || [],
                total: count || 0,
            },
        });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to fetch assets' });
    }
};
exports.getAssets = getAssets;
/**
 * Get a single asset by ID
 * Balance is stored in the database
 */
const getAsset = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const { data: asset, error } = await supabase_1.supabaseAdmin
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
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to fetch asset' });
    }
};
exports.getAsset = getAsset;
/**
 * Create a new asset
 */
const createAsset = async (req, res) => {
    try {
        const userId = req.user.id;
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
        const { data: asset, error } = await supabase_1.supabaseAdmin
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
            throw new error_1.AppError('Failed to create asset', 500);
        }
        res.status(201).json({ success: true, data: asset });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to create asset' });
    }
};
exports.createAsset = createAsset;
/**
 * Update an existing asset
 */
const updateAsset = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const { name, type, ticker, currency, market, metadata } = req.body;
        // Check if asset exists and belongs to user
        const { data: existingAsset, error: fetchError } = await supabase_1.supabaseAdmin
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
        const updates = { updated_at: new Date().toISOString() };
        if (name !== undefined)
            updates.name = name.trim();
        if (type !== undefined)
            updates.type = type;
        if (ticker !== undefined)
            updates.ticker = ticker?.trim() || null;
        if (currency !== undefined)
            updates.currency = currency;
        if (market !== undefined)
            updates.market = market || null;
        if (metadata !== undefined)
            updates.metadata = metadata;
        const { data: asset, error } = await supabase_1.supabaseAdmin
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
            throw new error_1.AppError('Failed to update asset', 500);
        }
        res.json({ success: true, data: asset });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to update asset' });
    }
};
exports.updateAsset = updateAsset;
/**
 * Delete an asset (only if no flows reference it)
 */
const deleteAsset = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        // Check if asset exists and belongs to user
        const { data: existingAsset, error: fetchError } = await supabase_1.supabaseAdmin
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
        const { data: flows, error: flowsError } = await supabase_1.supabaseAdmin
            .from('flows')
            .select('id')
            .or(`from_asset_id.eq.${id},to_asset_id.eq.${id}`)
            .limit(1);
        if (flowsError) {
            throw new error_1.AppError('Failed to check asset usage', 500);
        }
        if (flows && flows.length > 0) {
            res.status(400).json({
                success: false,
                error: 'Cannot delete asset with existing flows. Delete the flows first.',
            });
            return;
        }
        const { error } = await supabase_1.supabaseAdmin.from('assets').delete().eq('id', id);
        if (error) {
            throw new error_1.AppError('Failed to delete asset', 500);
        }
        res.json({ success: true, message: 'Asset deleted successfully' });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to delete asset' });
    }
};
exports.deleteAsset = deleteAsset;
//# sourceMappingURL=asset.controller.js.map