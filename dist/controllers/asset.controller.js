"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNetWorthStats = exports.getAssetTypeStats = exports.deleteAsset = exports.updateAsset = exports.createAsset = exports.getAsset = exports.getDefaultCashAccount = exports.getAssets = void 0;
const supabase_1 = require("../config/supabase");
const error_1 = require("../middleware/error");
const currency_conversion_1 = require("../utils/currency-conversion");
const stock_price_1 = require("../utils/stock-price");
const family_context_1 = require("../utils/family-context");
// Metal configuration - maps metal_type to Yahoo Finance symbol
const METAL_CONFIG = {
    gold: { symbol: 'GC=F', priceUnit: 'troy_oz' },
    silver: { symbol: 'SI=F', priceUnit: 'troy_oz' },
};
// Conversion factors to grams
const UNIT_TO_GRAMS = {
    gram: 1,
    kg: 1000,
    oz: 28.3495, // avoirdupois ounce
    troy_oz: 31.1035, // troy ounce (used for precious metals)
    pound: 453.592,
};
/**
 * Convert metal price from Yahoo's unit to user's unit
 * Yahoo returns price per troy_oz (gold/silver) or per pound (copper)
 */
function convertMetalPrice(yahooPrice, fromUnit, toUnit) {
    const fromGrams = UNIT_TO_GRAMS[fromUnit] || 1;
    const toGrams = UNIT_TO_GRAMS[toUnit] || 1;
    // Price per gram = yahooPrice / fromGrams
    // Price per toUnit = (yahooPrice / fromGrams) * toGrams
    return (yahooPrice / fromGrams) * toGrams;
}
/**
 * Add stock/metal prices and converted values to stock/ETF/metals assets
 * Balance remains as shares/weight, but we calculate and convert market_value
 */
async function addStockPricesAndConversion(assets, preferredCurrency) {
    // Find all stock/ETF/crypto assets with tickers
    const stockAssets = assets.filter(a => (a.type === 'stock' || a.type === 'etf' || a.type === 'crypto') && a.ticker);
    const tickers = [...new Set(stockAssets.map(a => a.ticker))];
    // Find all metal assets and get their Yahoo symbols
    const metalAssets = assets.filter(a => a.type === 'metals' && a.metadata?.metal_type);
    const metalSymbols = [...new Set(metalAssets
            .map(a => METAL_CONFIG[a.metadata?.metal_type]?.symbol)
            .filter((s) => !!s))];
    // Combine all symbols to fetch
    const allSymbols = [...tickers, ...metalSymbols];
    // Fetch all prices in batch
    const priceMap = await (0, stock_price_1.fetchStockPrices)(allSymbols);
    // Collect all currencies for exchange rate conversion
    const currencies = new Set([preferredCurrency.toLowerCase()]);
    priceMap.forEach(result => {
        if (result)
            currencies.add(result.currency.toLowerCase());
    });
    assets.forEach(a => {
        if (a.currency)
            currencies.add(a.currency.toLowerCase());
    });
    // Get exchange rates
    const rateMap = await (0, currency_conversion_1.getExchangeRates)(Array.from(currencies));
    // Add prices, market_value, and converted_balance to assets
    return assets.map(asset => {
        // Handle stocks/ETFs/crypto (all have tickers and balance = shares/units)
        if ((asset.type === 'stock' || asset.type === 'etf' || asset.type === 'crypto') && asset.ticker) {
            // Use uppercase for lookup since findata returns uppercase keys
            const stockPrice = priceMap.get(asset.ticker.toUpperCase());
            if (stockPrice) {
                // Calculate market value in asset's currency
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
        // Handle metals
        if (asset.type === 'metals' && asset.metadata?.metal_type) {
            const metalType = asset.metadata.metal_type;
            const metalConfig = METAL_CONFIG[metalType];
            if (metalConfig) {
                const metalPrice = priceMap.get(metalConfig.symbol);
                if (metalPrice) {
                    // Get the user's unit (e.g., gram, kg, oz)
                    const userUnit = asset.metadata.metal_unit || 'gram';
                    // Convert Yahoo price (per troy_oz or pound) to user's unit
                    const pricePerUserUnit = convertMetalPrice(metalPrice.price, metalConfig.priceUnit, userUnit);
                    // Calculate market value: weight * price_per_unit (in USD)
                    const marketValue = asset.balance * pricePerUserUnit;
                    // Convert to user's preferred currency
                    const conversion = (0, currency_conversion_1.convertAmount)(marketValue, metalPrice.currency, preferredCurrency, rateMap);
                    return {
                        ...asset,
                        stock_price: pricePerUserUnit, // Price per user's unit
                        stock_currency: metalPrice.currency,
                        market_value: marketValue,
                        converted_balance: conversion ? Math.round(conversion.converted * 100) / 100 : marketValue,
                        converted_currency: preferredCurrency,
                    };
                }
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
        const viewContext = await (0, family_context_1.getViewContext)(req);
        const { page = '1', limit = '50', type, search, sortBy = 'created_at', sortOrder = 'desc' } = req.query;
        const pageNum = parseInt(page, 10) || 1;
        const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
        const offset = (pageNum - 1) * limitNum;
        // Validate sort field
        const validSortFields = ['name', 'type', 'balance', 'created_at', 'updated_at'];
        const sortField = validSortFields.includes(sortBy) ? sortBy : 'created_at';
        const ascending = sortOrder === 'asc';
        // Build query with family/personal context
        let query = supabase_1.supabaseAdmin
            .from('assets')
            .select('*', { count: 'exact' })
            .order(sortField, { ascending });
        // Apply ownership filter
        query = query.eq('belong_id', viewContext.belongId);
        if (type) {
            query = query.eq('type', type);
        }
        // Search by name or ticker (case-insensitive)
        if (search) {
            const searchTerm = search.trim().toLowerCase();
            query = query.or(`name.ilike.%${searchTerm}%,ticker.ilike.%${searchTerm}%`);
        }
        query = query.range(offset, offset + limitNum - 1);
        const { data: assets, error, count } = await query;
        if (error) {
            throw new error_1.AppError('Failed to fetch assets', 500);
        }
        // Get user preferences for currency
        const prefs = await (0, currency_conversion_1.getUserPreferences)(userId);
        const preferredCurrency = prefs?.preferred_currency || 'USD';
        // Add stock prices and convert to preferred currency for stock/ETF/crypto/metals assets
        const assetsWithStockPrices = await addStockPricesAndConversion(assets || [], preferredCurrency);
        // Add currency conversion fields for non-price-fetched assets (cash, deposit, bond, real_estate, other)
        // Stock/ETF/crypto/metals already have converted_balance from addStockPricesAndConversion
        const assetsWithConversion = await (0, currency_conversion_1.addConvertedFieldsToArray)(assetsWithStockPrices.map(a => {
            // For stock/ETF/crypto/metals: skip balance conversion (already handled above)
            if (((a.type === 'stock' || a.type === 'etf' || a.type === 'crypto') && a.stock_price) ||
                (a.type === 'metals' && a.converted_balance !== undefined)) {
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
 * Get the default cash account (first cash account)
 * GET /api/fire/assets/default-cash
 * Used by chat agent for prefetching
 */
const getDefaultCashAccount = async (req, res) => {
    try {
        const viewContext = await (0, family_context_1.getViewContext)(req);
        // Get first cash account
        let query = supabase_1.supabaseAdmin
            .from('assets')
            .select('id, name')
            .eq('type', 'cash')
            .order('created_at', { ascending: true })
            .limit(1);
        query = query.eq('belong_id', viewContext.belongId);
        const { data: assets, error } = await query;
        if (error) {
            throw new error_1.AppError('Failed to fetch default cash account', 500);
        }
        if (assets && assets.length > 0) {
            res.json({
                success: true,
                data: { id: assets[0].id, name: assets[0].name },
            });
        }
        else {
            res.json({
                success: true,
                data: null,
            });
        }
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to fetch default cash account' });
    }
};
exports.getDefaultCashAccount = getDefaultCashAccount;
/**
 * Get a single asset by ID
 */
const getAsset = async (req, res) => {
    try {
        const userId = req.user.id;
        const viewContext = await (0, family_context_1.getViewContext)(req);
        const { id } = req.params;
        // Build query with family/personal context
        const { data: asset, error } = await supabase_1.supabaseAdmin
            .from('assets')
            .select('*')
            .eq('id', id)
            .eq('belong_id', viewContext.belongId)
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
        // Add currency conversion fields (skip for stocks/crypto/metals - already handled above)
        const assetWithConversion = await (0, currency_conversion_1.addConvertedFieldsToSingle)({
            ...assetWithStockPrice,
            skip_balance_conversion: (((asset.type === 'stock' || asset.type === 'etf' || asset.type === 'crypto') && assetWithStockPrice.stock_price) ||
                (asset.type === 'metals' && assetWithStockPrice.converted_balance !== undefined)) ? true : undefined,
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
        const viewContext = await (0, family_context_1.getViewContext)(req);
        const { name, type, ticker, currency, market, metadata, balance, belong_id } = req.body;
        // Validation
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            res.status(400).json({ success: false, error: 'Name is required' });
            return;
        }
        if (!type) {
            res.status(400).json({ success: false, error: 'Asset type is required' });
            return;
        }
        const validTypes = ['cash', 'deposit', 'stock', 'etf', 'bond', 'real_estate', 'crypto', 'metals', 'other'];
        if (!validTypes.includes(type)) {
            res.status(400).json({ success: false, error: 'Invalid asset type' });
            return;
        }
        // Determine ownership: use provided belong_id or default to view context
        let ownershipValues;
        if (belong_id) {
            // Use explicitly provided belong_id (must be user's own ID or their family ID)
            const validBelongIds = [userId, viewContext.familyId];
            if (!validBelongIds.includes(belong_id)) {
                res.status(400).json({ success: false, error: 'Invalid belong_id' });
                return;
            }
            ownershipValues = { user_id: userId, belong_id };
        }
        else {
            // Default: use current view context
            ownershipValues = { user_id: viewContext.userId, belong_id: viewContext.belongId };
        }
        const { data: asset, error } = await supabase_1.supabaseAdmin
            .from('assets')
            .insert({
            ...ownershipValues,
            name: name.trim(),
            type,
            ticker: ticker?.trim() || null,
            currency: currency || 'USD',
            market: market || null,
            metadata: metadata || null,
            balance: balance ?? 0,
            balance_updated_at: balance ? new Date().toISOString() : null,
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
 * If balance changes, creates an adjustment transaction atomically
 */
const updateAsset = async (req, res) => {
    try {
        const userId = req.user.id;
        const viewContext = await (0, family_context_1.getViewContext)(req);
        const { id } = req.params;
        const { name, type, ticker, currency, market, metadata, balance, total_realized_pl } = req.body;
        // Fetch existing asset with current balance
        const { data: existingAsset, error: fetchError } = await supabase_1.supabaseAdmin
            .from('assets')
            .select('*')
            .eq('id', id)
            .eq('belong_id', viewContext.belongId)
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
        if (total_realized_pl !== undefined)
            updates.total_realized_pl = total_realized_pl;
        // Update balance if provided
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
        // Get user preferences for currency
        const prefs = await (0, currency_conversion_1.getUserPreferences)(userId);
        const preferredCurrency = prefs?.preferred_currency || 'USD';
        // Add stock/metal price and convert to preferred currency
        const [assetWithPrice] = await addStockPricesAndConversion([asset], preferredCurrency);
        // Add currency conversion fields (skip for stocks/crypto/metals - already handled above)
        const assetWithConversion = await (0, currency_conversion_1.addConvertedFieldsToSingle)({
            ...assetWithPrice,
            skip_balance_conversion: (((asset.type === 'stock' || asset.type === 'etf' || asset.type === 'crypto') && assetWithPrice.stock_price) ||
                (asset.type === 'metals' && assetWithPrice.converted_balance !== undefined)) ? true : undefined,
        }, userId);
        res.json({ success: true, data: assetWithConversion });
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
        const viewContext = await (0, family_context_1.getViewContext)(req);
        const { id } = req.params;
        // Check if asset exists and belongs to user/family
        const { data: existingAsset, error: fetchError } = await supabase_1.supabaseAdmin
            .from('assets')
            .select('id')
            .eq('id', id)
            .eq('belong_id', viewContext.belongId)
            .single();
        if (fetchError || !existingAsset) {
            res.status(404).json({ success: false, error: 'Asset not found' });
            return;
        }
        // Flow is now an audit log - assets can be deleted freely
        // Flow references will be set to NULL (ON DELETE SET NULL)
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
 * Get asset stats grouped by type (for stats row)
 * Returns total value per type, converted to user's preferred currency
 * GET /api/fire/assets/type-stats
 */
const getAssetTypeStats = async (req, res) => {
    try {
        const userId = req.user.id;
        const viewContext = await (0, family_context_1.getViewContext)(req);
        // Get user preferences for currency
        const prefs = await (0, currency_conversion_1.getUserPreferences)(userId);
        const preferredCurrency = prefs?.preferred_currency || 'USD';
        // Build query with family/personal context
        const { data: assets, error } = await supabase_1.supabaseAdmin
            .from('assets')
            .select('*')
            .eq('belong_id', viewContext.belongId);
        if (error) {
            throw new error_1.AppError('Failed to fetch assets', 500);
        }
        // Add stock prices and convert to preferred currency for stock/ETF/crypto/metals
        const assetsWithStockPrices = await addStockPricesAndConversion(assets || [], preferredCurrency);
        // Add currency conversion for all other asset types (cash, deposit, bond, real_estate, other)
        // This mirrors the logic in getAssets
        const assetsWithConversion = await (0, currency_conversion_1.addConvertedFieldsToArray)(assetsWithStockPrices.map(a => {
            // For stock/ETF/crypto/metals: skip balance conversion (already handled above)
            if (((a.type === 'stock' || a.type === 'etf' || a.type === 'crypto') && a.stock_price) ||
                (a.type === 'metals' && a.converted_balance !== undefined)) {
                return { ...a, skip_balance_conversion: true };
            }
            return a;
        }), userId);
        // Group by type and sum values
        const typeMap = new Map();
        let grandTotal = 0;
        for (const asset of assetsWithConversion) {
            // Use converted_balance (market value in preferred currency) if available
            const value = asset.converted_balance ?? asset.balance;
            const existing = typeMap.get(asset.type) || { total: 0, count: 0 };
            existing.total += value;
            existing.count += 1;
            typeMap.set(asset.type, existing);
            grandTotal += value;
        }
        // Convert to array
        const stats = Array.from(typeMap.entries()).map(([type, data]) => ({
            type,
            total: data.total,
            count: data.count,
        }));
        res.json({
            success: true,
            data: {
                stats,
                grandTotal,
                currency: preferredCurrency,
            },
        });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to fetch asset type stats' });
    }
};
exports.getAssetTypeStats = getAssetTypeStats;
/**
 * Get net worth statistics (total assets, debts, net worth)
 * All values converted to user's preferred currency
 */
const getNetWorthStats = async (req, res) => {
    try {
        const userId = req.user.id;
        const viewContext = await (0, family_context_1.getViewContext)(req);
        // Get user preferences for currency
        const prefs = await (0, currency_conversion_1.getUserPreferences)(userId);
        const preferredCurrency = prefs?.preferred_currency || 'USD';
        // Build queries with family/personal context
        // Include metadata for metals (needed for metal_type and metal_unit)
        const assetsQuery = supabase_1.supabaseAdmin
            .from('assets')
            .select('id, type, ticker, balance, currency, metadata')
            .eq('belong_id', viewContext.belongId);
        const debtsQuery = supabase_1.supabaseAdmin
            .from('debts')
            .select('id, current_balance, currency, status')
            .eq('status', 'active')
            .eq('belong_id', viewContext.belongId);
        // Fetch all assets and debts in parallel
        const [assetsResult, debtsResult] = await Promise.all([
            assetsQuery,
            debtsQuery,
        ]);
        if (assetsResult.error) {
            throw new error_1.AppError('Failed to fetch assets', 500);
        }
        if (debtsResult.error) {
            throw new error_1.AppError('Failed to fetch debts', 500);
        }
        const assets = assetsResult.data || [];
        const debts = debtsResult.data || [];
        // Find stock/ETF/crypto assets and fetch prices
        const stockAssets = assets.filter(a => (a.type === 'stock' || a.type === 'etf' || a.type === 'crypto') && a.ticker);
        const tickers = [...new Set(stockAssets.map(a => a.ticker))];
        // Find metal assets and get their Yahoo symbols
        const metalAssets = assets.filter(a => a.type === 'metals' && a.metadata?.metal_type);
        const metalSymbols = [...new Set(metalAssets
                .map(a => METAL_CONFIG[a.metadata?.metal_type]?.symbol)
                .filter((s) => !!s))];
        // Fetch all prices (stocks + metals) in batch
        const allSymbols = [...tickers, ...metalSymbols];
        const priceMap = await (0, stock_price_1.fetchStockPrices)(allSymbols);
        // Collect all currencies for exchange rates
        const currencies = new Set([preferredCurrency.toLowerCase()]);
        assets.forEach(a => currencies.add((a.currency || 'USD').toLowerCase()));
        debts.forEach(d => currencies.add((d.currency || 'USD').toLowerCase()));
        priceMap.forEach(result => {
            if (result)
                currencies.add(result.currency.toLowerCase());
        });
        const rateMap = await (0, currency_conversion_1.getExchangeRates)(Array.from(currencies));
        // Calculate total assets (converted to preferred currency)
        let totalAssets = 0;
        for (const asset of assets) {
            let value;
            let valueCurrency;
            if ((asset.type === 'stock' || asset.type === 'etf' || asset.type === 'crypto') && asset.ticker) {
                // Use uppercase for lookup since findata returns uppercase keys
                const price = priceMap.get(asset.ticker.toUpperCase());
                if (price) {
                    value = asset.balance * price.price;
                    valueCurrency = price.currency;
                }
                else {
                    continue; // Skip if no price available
                }
            }
            else if (asset.type === 'metals' && asset.metadata?.metal_type) {
                // Handle metals
                const metalType = asset.metadata.metal_type;
                const metalConfig = METAL_CONFIG[metalType];
                if (metalConfig) {
                    const metalPrice = priceMap.get(metalConfig.symbol);
                    if (metalPrice) {
                        const userUnit = asset.metadata.metal_unit || 'gram';
                        const pricePerUserUnit = convertMetalPrice(metalPrice.price, metalConfig.priceUnit, userUnit);
                        value = asset.balance * pricePerUserUnit;
                        valueCurrency = metalPrice.currency;
                    }
                    else {
                        continue; // Skip if no price available
                    }
                }
                else {
                    continue;
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