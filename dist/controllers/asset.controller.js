"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNetWorthStats = exports.deleteAsset = exports.updateAsset = exports.createAsset = exports.getAsset = exports.getAssets = void 0;
const supabase_1 = require("../config/supabase");
const error_1 = require("../middleware/error");
const currency_conversion_1 = require("../utils/currency-conversion");
const stock_price_1 = require("../utils/stock-price");
/**
 * Add stock prices and converted values to stock/ETF assets
 * Balance remains as shares, but we calculate and convert market_value
 */
async function addStockPricesAndConversion(assets, preferredCurrency) {
    // Find all stock/ETF assets with tickers
    const stockAssets = assets.filter(a => (a.type === 'stock' || a.type === 'etf') && a.ticker);
    const tickers = [...new Set(stockAssets.map(a => a.ticker))];
    // Fetch all stock prices in parallel
    const pricePromises = tickers.map(ticker => (0, stock_price_1.fetchStockPrice)(ticker));
    const priceResults = await Promise.all(pricePromises);
    // Create price map
    const priceMap = new Map();
    tickers.forEach((ticker, index) => {
        if (priceResults[index]) {
            priceMap.set(ticker, priceResults[index]);
        }
    });
    // Collect all currencies for exchange rate conversion
    const currencies = new Set([preferredCurrency.toLowerCase()]);
    priceResults.forEach(result => {
        if (result)
            currencies.add(result.currency.toLowerCase());
    });
    assets.forEach(a => {
        if (a.currency)
            currencies.add(a.currency.toLowerCase());
    });
    // Get exchange rates
    const rateMap = await (0, currency_conversion_1.getExchangeRates)(Array.from(currencies));
    // Add stock_price, market_value, and converted_balance to assets
    return assets.map(asset => {
        if ((asset.type === 'stock' || asset.type === 'etf') && asset.ticker) {
            const stockPrice = priceMap.get(asset.ticker);
            if (stockPrice) {
                // Calculate market value in stock's currency
                const marketValue = asset.balance * stockPrice.price;
                // Convert to user's preferred currency
                const conversion = (0, currency_conversion_1.convertAmount)(marketValue, stockPrice.currency, preferredCurrency, rateMap);
                return {
                    ...asset,
                    stock_price: stockPrice.price,
                    stock_currency: stockPrice.currency,
                    market_value: marketValue,
                    converted_balance: conversion ? Math.round(conversion.converted * 100) / 100 : marketValue,
                    converted_currency: preferredCurrency,
                };
            }
        }
        return asset;
    });
}
/**
 * Get all assets for the authenticated user
 * Balance is stored in the database and managed by the application
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
        // Get user preferences for currency
        const prefs = await (0, currency_conversion_1.getUserPreferences)(userId);
        const preferredCurrency = prefs?.preferred_currency || 'USD';
        // Add stock prices and convert to preferred currency for stock/ETF assets
        const assetsWithStockPrices = await addStockPricesAndConversion(assets || [], preferredCurrency);
        // Add currency conversion fields for non-stock assets
        // Stock assets already have converted_balance from addStockPricesAndConversion
        const assetsWithConversion = await (0, currency_conversion_1.addConvertedFieldsToArray)(assetsWithStockPrices.map(a => {
            // For stock/ETF: skip balance conversion (already handled above)
            if ((a.type === 'stock' || a.type === 'etf') && a.stock_price) {
                return { ...a, skip_balance_conversion: true };
            }
            return a;
        }), userId);
        res.json({
            success: true,
            data: {
                assets: assetsWithConversion,
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
        // Get user preferences for currency
        const prefs = await (0, currency_conversion_1.getUserPreferences)(userId);
        const preferredCurrency = prefs?.preferred_currency || 'USD';
        // Add stock price and convert to preferred currency for stock/ETF assets
        const [assetWithStockPrice] = await addStockPricesAndConversion([asset], preferredCurrency);
        // Add currency conversion fields (skip for stocks - already handled above)
        const assetWithConversion = await (0, currency_conversion_1.addConvertedFieldsToSingle)({
            ...assetWithStockPrice,
            skip_balance_conversion: (asset.type === 'stock' || asset.type === 'etf') && assetWithStockPrice.stock_price ? true : undefined,
        }, userId);
        res.json({
            success: true,
            data: assetWithConversion,
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
        const validTypes = ['cash', 'deposit', 'stock', 'etf', 'bond', 'real_estate', 'crypto', 'other'];
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
        const { name, type, ticker, currency, market, metadata, balance } = req.body;
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
        if (balance !== undefined) {
            updates.balance = parseFloat(balance);
            updates.balance_updated_at = new Date().toISOString();
        }
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
/**
 * Get net worth statistics (total assets, debts, net worth)
 * All values converted to user's preferred currency
 */
const getNetWorthStats = async (req, res) => {
    try {
        const userId = req.user.id;
        // Get user preferences for currency
        const prefs = await (0, currency_conversion_1.getUserPreferences)(userId);
        const preferredCurrency = prefs?.preferred_currency || 'USD';
        // Fetch all assets and debts in parallel
        const [assetsResult, debtsResult] = await Promise.all([
            supabase_1.supabaseAdmin
                .from('assets')
                .select('id, type, ticker, balance, currency')
                .eq('user_id', userId),
            supabase_1.supabaseAdmin
                .from('debts')
                .select('id, current_balance, currency, status')
                .eq('user_id', userId)
                .eq('status', 'active'),
        ]);
        if (assetsResult.error) {
            throw new error_1.AppError('Failed to fetch assets', 500);
        }
        if (debtsResult.error) {
            throw new error_1.AppError('Failed to fetch debts', 500);
        }
        const assets = assetsResult.data || [];
        const debts = debtsResult.data || [];
        // Find stock/ETF assets and fetch prices
        const stockAssets = assets.filter(a => (a.type === 'stock' || a.type === 'etf') && a.ticker);
        const tickers = [...new Set(stockAssets.map(a => a.ticker))];
        const pricePromises = tickers.map(ticker => (0, stock_price_1.fetchStockPrice)(ticker));
        const priceResults = await Promise.all(pricePromises);
        const priceMap = new Map();
        tickers.forEach((ticker, index) => {
            if (priceResults[index]) {
                priceMap.set(ticker, priceResults[index]);
            }
        });
        // Collect all currencies for exchange rates
        const currencies = new Set([preferredCurrency.toLowerCase()]);
        assets.forEach(a => currencies.add((a.currency || 'USD').toLowerCase()));
        debts.forEach(d => currencies.add((d.currency || 'USD').toLowerCase()));
        priceResults.forEach(result => {
            if (result)
                currencies.add(result.currency.toLowerCase());
        });
        const rateMap = await (0, currency_conversion_1.getExchangeRates)(Array.from(currencies));
        // Calculate total assets (converted to preferred currency)
        let totalAssets = 0;
        for (const asset of assets) {
            let value;
            let valueCurrency;
            if ((asset.type === 'stock' || asset.type === 'etf') && asset.ticker) {
                const price = priceMap.get(asset.ticker);
                if (price) {
                    value = asset.balance * price.price;
                    valueCurrency = price.currency;
                }
                else {
                    continue; // Skip if no price available
                }
            }
            else {
                value = asset.balance;
                valueCurrency = asset.currency || 'USD';
            }
            // Convert to preferred currency
            const conversion = (0, currency_conversion_1.convertAmount)(value, valueCurrency, preferredCurrency, rateMap);
            totalAssets += conversion ? conversion.converted : value;
        }
        // Calculate total debts (converted to preferred currency)
        let totalDebts = 0;
        for (const debt of debts) {
            const value = debt.current_balance;
            const valueCurrency = debt.currency || 'USD';
            const conversion = (0, currency_conversion_1.convertAmount)(value, valueCurrency, preferredCurrency, rateMap);
            totalDebts += conversion ? conversion.converted : value;
        }
        res.json({
            success: true,
            data: {
                totalAssets: Math.round(totalAssets * 100) / 100,
                totalDebts: Math.round(totalDebts * 100) / 100,
                netWorth: Math.round((totalAssets - totalDebts) * 100) / 100,
                currency: preferredCurrency,
            },
        });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to calculate net worth' });
    }
};
exports.getNetWorthStats = getNetWorthStats;
//# sourceMappingURL=asset.controller.js.map