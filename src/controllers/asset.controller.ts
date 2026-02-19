import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse, Asset, AssetFilters } from '../types';
import { AppError } from '../middleware/error';
import { addConvertedFieldsToArray, addConvertedFieldsToSingle, getUserPreferences, getExchangeRates, convertAmount } from '../utils/currency-conversion';
import { fetchStockPrice, fetchStockPrices } from '../utils/stock-price';
import { getViewContext, applyOwnershipFilter, applyOwnershipFilterWithId, buildOwnershipValues } from '../utils/family-context';

// Metal configuration - maps metal_type to Yahoo Finance symbol
const METAL_CONFIG: Record<string, { symbol: string; priceUnit: 'troy_oz' | 'pound' }> = {
  gold: { symbol: 'GC=F', priceUnit: 'troy_oz' },
  silver: { symbol: 'SI=F', priceUnit: 'troy_oz' },
};

// Conversion factors to grams
const UNIT_TO_GRAMS: Record<string, number> = {
  gram: 1,
  kg: 1000,
  oz: 28.3495,      // avoirdupois ounce
  troy_oz: 31.1035, // troy ounce (used for precious metals)
  pound: 453.592,
};

/**
 * Convert metal price from Yahoo's unit to user's unit
 * Yahoo returns price per troy_oz (gold/silver) or per pound (copper)
 */
function convertMetalPrice(yahooPrice: number, fromUnit: 'troy_oz' | 'pound', toUnit: string): number {
  const fromGrams = UNIT_TO_GRAMS[fromUnit] || 1;
  const toGrams = UNIT_TO_GRAMS[toUnit] || 1;
  // Price per gram = yahooPrice / fromGrams
  // Price per toUnit = (yahooPrice / fromGrams) * toGrams
  return (yahooPrice / fromGrams) * toGrams;
}

interface StockAssetResult extends Asset {
  stock_price?: number;
  stock_currency?: string;
  market_value?: number;
  converted_balance?: number;
  converted_currency?: string;
}

/**
 * Add stock/metal prices and converted values to stock/ETF/metals assets
 * Balance remains as shares/weight, but we calculate and convert market_value
 */
async function addStockPricesAndConversion(
  assets: Asset[],
  preferredCurrency: string
): Promise<StockAssetResult[]> {
  // Find all stock/ETF/crypto assets with tickers
  const stockAssets = assets.filter(a => (a.type === 'stock' || a.type === 'etf' || a.type === 'crypto') && a.ticker);
  const tickers = [...new Set(stockAssets.map(a => a.ticker!))];

  // Find all metal assets and get their Yahoo symbols
  const metalAssets = assets.filter(a => a.type === 'metals' && a.metadata?.metal_type);
  const metalSymbols = [...new Set(
    metalAssets
      .map(a => METAL_CONFIG[a.metadata?.metal_type as string]?.symbol)
      .filter((s): s is string => !!s)
  )];

  // Combine all symbols to fetch
  const allSymbols = [...tickers, ...metalSymbols];

  // Fetch all prices in parallel
  const pricePromises = allSymbols.map(symbol => fetchStockPrice(symbol));
  const priceResults = await Promise.all(pricePromises);

  // Create price map
  const priceMap = new Map<string, { price: number; currency: string }>();
  allSymbols.forEach((symbol, index) => {
    if (priceResults[index]) {
      priceMap.set(symbol, priceResults[index]!);
    }
  });

  // Collect all currencies for exchange rate conversion
  const currencies = new Set<string>([preferredCurrency.toLowerCase()]);
  priceResults.forEach(result => {
    if (result) currencies.add(result.currency.toLowerCase());
  });
  assets.forEach(a => {
    if (a.currency) currencies.add(a.currency.toLowerCase());
  });

  // Get exchange rates
  const rateMap = await getExchangeRates(Array.from(currencies));

  // Add prices, market_value, and converted_balance to assets
  return assets.map(asset => {
    // Handle stocks/ETFs/crypto (all have tickers and balance = shares/units)
    if ((asset.type === 'stock' || asset.type === 'etf' || asset.type === 'crypto') && asset.ticker) {
      const stockPrice = priceMap.get(asset.ticker);
      if (stockPrice) {
        // Calculate market value in asset's currency
        const marketValue = asset.balance * stockPrice.price;

        // Convert to user's preferred currency
        const conversion = convertAmount(marketValue, stockPrice.currency, preferredCurrency, rateMap);

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
      const metalType = asset.metadata.metal_type as string;
      const metalConfig = METAL_CONFIG[metalType];
      if (metalConfig) {
        const metalPrice = priceMap.get(metalConfig.symbol);
        if (metalPrice) {
          // Get the user's unit (e.g., gram, kg, oz)
          const userUnit = (asset.metadata.metal_unit as string) || 'gram';

          // Convert Yahoo price (per troy_oz or pound) to user's unit
          const pricePerUserUnit = convertMetalPrice(metalPrice.price, metalConfig.priceUnit, userUnit);

          // Calculate market value: weight * price_per_unit (in USD)
          const marketValue = asset.balance * pricePerUserUnit;

          // Convert to user's preferred currency
          const conversion = convertAmount(marketValue, metalPrice.currency, preferredCurrency, rateMap);

          return {
            ...asset,
            stock_price: pricePerUserUnit,  // Price per user's unit
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
export const getAssets = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ assets: Asset[]; total: number }>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const { page = '1', limit = '50', type, search, sortBy = 'created_at', sortOrder = 'desc' } = req.query as unknown as AssetFilters & { page: string; limit: string; sortBy?: string; sortOrder?: string };

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = Math.min(parseInt(limit as string, 10) || 50, 100);
    const offset = (pageNum - 1) * limitNum;

    // Validate sort field
    const validSortFields = ['name', 'type', 'balance', 'created_at', 'updated_at'];
    const sortField = validSortFields.includes(sortBy as string) ? sortBy : 'created_at';
    const ascending = sortOrder === 'asc';

    // Build query with family/personal context
    let query = supabaseAdmin
      .from('assets')
      .select('*', { count: 'exact' })
      .order(sortField as string, { ascending });

    // Apply ownership filter (family or personal)
    query = applyOwnershipFilter(query, viewContext);

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
      throw new AppError('Failed to fetch assets', 500);
    }

    // Get user preferences for currency
    const prefs = await getUserPreferences(userId);
    const preferredCurrency = prefs?.preferred_currency || 'USD';

    // Add stock prices and convert to preferred currency for stock/ETF/crypto/metals assets
    const assetsWithStockPrices = await addStockPricesAndConversion(assets || [], preferredCurrency);

    // Add currency conversion fields for non-price-fetched assets (cash, deposit, bond, real_estate, other)
    // Stock/ETF/crypto/metals already have converted_balance from addStockPricesAndConversion
    const assetsWithConversion = await addConvertedFieldsToArray(
      assetsWithStockPrices.map(a => {
        // For stock/ETF/crypto/metals: skip balance conversion (already handled above)
        if (((a.type === 'stock' || a.type === 'etf' || a.type === 'crypto') && a.stock_price) ||
            (a.type === 'metals' && a.converted_balance !== undefined)) {
          return { ...a, skip_balance_conversion: true };
        }
        return a;
      }),
      userId
    );

    res.json({
      success: true,
      data: {
        assets: assetsWithConversion,
        total: count || 0,
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to fetch assets' });
  }
};

/**
 * Get the default cash account (first cash account)
 * GET /api/fire/assets/default-cash
 * Used by chat agent for prefetching
 */
export const getDefaultCashAccount = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ id: string; name: string } | null>>
): Promise<void> => {
  try {
    const viewContext = await getViewContext(req);

    // Get first cash account
    let query = supabaseAdmin
      .from('assets')
      .select('id, name')
      .eq('type', 'cash')
      .order('created_at', { ascending: true })
      .limit(1);

    query = applyOwnershipFilter(query, viewContext);

    const { data: assets, error } = await query;

    if (error) {
      throw new AppError('Failed to fetch default cash account', 500);
    }

    if (assets && assets.length > 0) {
      res.json({
        success: true,
        data: { id: assets[0].id, name: assets[0].name },
      });
    } else {
      res.json({
        success: true,
        data: null,
      });
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to fetch default cash account' });
  }
};

/**
 * Get a single asset by ID
 */
export const getAsset = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Asset>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const { id } = req.params;

    // Build query with family/personal context
    let query = supabaseAdmin.from('assets').select('*');
    query = applyOwnershipFilterWithId(query, id, viewContext);

    const { data: asset, error } = await query.single();

    if (error || !asset) {
      res.status(404).json({ success: false, error: 'Asset not found' });
      return;
    }

    // Get user preferences for currency
    const prefs = await getUserPreferences(userId);
    const preferredCurrency = prefs?.preferred_currency || 'USD';

    // Add stock price and convert to preferred currency for stock/ETF assets
    const [assetWithStockPrice] = await addStockPricesAndConversion([asset], preferredCurrency);

    // Add currency conversion fields (skip for stocks/metals - already handled above)
    const assetWithConversion = await addConvertedFieldsToSingle(
      {
        ...assetWithStockPrice,
        skip_balance_conversion: (
          ((asset.type === 'stock' || asset.type === 'etf') && assetWithStockPrice.stock_price) ||
          (asset.type === 'metals' && assetWithStockPrice.converted_balance !== undefined)
        ) ? true : undefined,
      },
      userId
    );

    res.json({
      success: true,
      data: assetWithConversion,
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
    const viewContext = await getViewContext(req);
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
    let ownershipValues: { user_id: string; belong_id: string };
    if (belong_id) {
      // Use explicitly provided belong_id (must be user's own ID or their family ID)
      const validBelongIds = [userId];
      if (viewContext.familyId) validBelongIds.push(viewContext.familyId);

      if (!validBelongIds.includes(belong_id)) {
        res.status(400).json({ success: false, error: 'Invalid belong_id' });
        return;
      }
      ownershipValues = { user_id: userId, belong_id };
    } else {
      // Default: use current view context
      ownershipValues = buildOwnershipValues(viewContext);
    }

    const { data: asset, error } = await supabaseAdmin
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
 * If balance changes, creates an adjustment transaction atomically
 */
export const updateAsset = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Asset>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const { id } = req.params;
    const { name, type, ticker, currency, market, metadata, balance } = req.body;

    // Fetch existing asset with current balance
    let checkQuery = supabaseAdmin.from('assets').select('*');
    checkQuery = applyOwnershipFilterWithId(checkQuery, id, viewContext);

    const { data: existingAsset, error: fetchError } = await checkQuery.single();

    if (fetchError || !existingAsset) {
      res.status(404).json({ success: false, error: 'Asset not found' });
      return;
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name.trim();
    if (type !== undefined) updates.type = type;
    if (ticker !== undefined) updates.ticker = ticker?.trim() || null;
    if (currency !== undefined) updates.currency = currency;
    if (market !== undefined) updates.market = market || null;
    if (metadata !== undefined) updates.metadata = metadata;

    // Update balance if provided
    if (balance !== undefined) {
      updates.balance = parseFloat(balance);
      updates.balance_updated_at = new Date().toISOString();
    }

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

    // Get user preferences for currency
    const prefs = await getUserPreferences(userId);
    const preferredCurrency = prefs?.preferred_currency || 'USD';

    // Add stock/metal price and convert to preferred currency
    const [assetWithPrice] = await addStockPricesAndConversion([asset], preferredCurrency);

    // Add currency conversion fields (skip for stocks/metals - already handled above)
    const assetWithConversion = await addConvertedFieldsToSingle(
      {
        ...assetWithPrice,
        skip_balance_conversion: (
          ((asset.type === 'stock' || asset.type === 'etf') && assetWithPrice.stock_price) ||
          (asset.type === 'metals' && assetWithPrice.converted_balance !== undefined)
        ) ? true : undefined,
      },
      userId
    );

    res.json({ success: true, data: assetWithConversion });
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
    const viewContext = await getViewContext(req);
    const { id } = req.params;

    // Check if asset exists and belongs to user/family
    let checkQuery = supabaseAdmin.from('assets').select('id');
    checkQuery = applyOwnershipFilterWithId(checkQuery, id, viewContext);

    const { data: existingAsset, error: fetchError } = await checkQuery.single();

    if (fetchError || !existingAsset) {
      res.status(404).json({ success: false, error: 'Asset not found' });
      return;
    }

    // Flow is now an audit log - assets can be deleted freely
    // Flow references will be set to NULL (ON DELETE SET NULL)
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

/**
 * Get asset stats grouped by type (for stats row)
 * Returns total value per type, converted to user's preferred currency
 * GET /api/fire/assets/type-stats
 */
export const getAssetTypeStats = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{
    stats: Array<{ type: string; total: number; count: number }>;
    grandTotal: number;
    currency: string;
  }>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);

    // Get user preferences for currency
    const prefs = await getUserPreferences(userId);
    const preferredCurrency = prefs?.preferred_currency || 'USD';

    // Build query with family/personal context
    let query = supabaseAdmin.from('assets').select('*');
    query = applyOwnershipFilter(query, viewContext);

    const { data: assets, error } = await query;

    if (error) {
      throw new AppError('Failed to fetch assets', 500);
    }

    // Add stock prices and convert to preferred currency for stock/ETF/crypto/metals
    const assetsWithStockPrices = await addStockPricesAndConversion(assets || [], preferredCurrency);

    // Add currency conversion for all other asset types (cash, deposit, bond, real_estate, other)
    // This mirrors the logic in getAssets
    const assetsWithConversion = await addConvertedFieldsToArray(
      assetsWithStockPrices.map(a => {
        // For stock/ETF/crypto/metals: skip balance conversion (already handled above)
        if (((a.type === 'stock' || a.type === 'etf' || a.type === 'crypto') && (a as StockAssetResult).stock_price) ||
            (a.type === 'metals' && (a as StockAssetResult).converted_balance !== undefined)) {
          return { ...a, skip_balance_conversion: true };
        }
        return a;
      }),
      userId
    );

    // Group by type and sum values
    const typeMap = new Map<string, { total: number; count: number }>();
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
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to fetch asset type stats' });
  }
};

/**
 * Get net worth statistics (total assets, debts, net worth)
 * All values converted to user's preferred currency
 */
export const getNetWorthStats = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{
    totalAssets: number;
    totalDebts: number;
    netWorth: number;
    currency: string;
  }>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);

    // Get user preferences for currency
    const prefs = await getUserPreferences(userId);
    const preferredCurrency = prefs?.preferred_currency || 'USD';

    // Build queries with family/personal context
    // Include metadata for metals (needed for metal_type and metal_unit)
    let assetsQuery = supabaseAdmin.from('assets').select('id, type, ticker, balance, currency, metadata');
    assetsQuery = applyOwnershipFilter(assetsQuery, viewContext);

    let debtsQuery = supabaseAdmin.from('debts').select('id, current_balance, currency, status').eq('status', 'active');
    debtsQuery = applyOwnershipFilter(debtsQuery, viewContext);

    // Fetch all assets and debts in parallel
    const [assetsResult, debtsResult] = await Promise.all([
      assetsQuery,
      debtsQuery,
    ]);

    if (assetsResult.error) {
      throw new AppError('Failed to fetch assets', 500);
    }
    if (debtsResult.error) {
      throw new AppError('Failed to fetch debts', 500);
    }

    const assets = assetsResult.data || [];
    const debts = debtsResult.data || [];

    // Find stock/ETF assets and fetch prices
    const stockAssets = assets.filter(a => (a.type === 'stock' || a.type === 'etf') && a.ticker);
    const tickers = [...new Set(stockAssets.map(a => a.ticker!))];

    // Find metal assets and get their Yahoo symbols
    const metalAssets = assets.filter(a => a.type === 'metals' && a.metadata?.metal_type);
    const metalSymbols = [...new Set(
      metalAssets
        .map(a => METAL_CONFIG[(a.metadata as Record<string, unknown>)?.metal_type as string]?.symbol)
        .filter((s): s is string => !!s)
    )];

    // Fetch all prices (stocks + metals)
    const allSymbols = [...tickers, ...metalSymbols];
    const pricePromises = allSymbols.map(symbol => fetchStockPrice(symbol));
    const priceResults = await Promise.all(pricePromises);

    const priceMap = new Map<string, { price: number; currency: string }>();
    allSymbols.forEach((symbol, index) => {
      if (priceResults[index]) {
        priceMap.set(symbol, priceResults[index]!);
      }
    });

    // Collect all currencies for exchange rates
    const currencies = new Set<string>([preferredCurrency.toLowerCase()]);
    assets.forEach(a => currencies.add((a.currency || 'USD').toLowerCase()));
    debts.forEach(d => currencies.add((d.currency || 'USD').toLowerCase()));
    priceResults.forEach(result => {
      if (result) currencies.add(result.currency.toLowerCase());
    });

    const rateMap = await getExchangeRates(Array.from(currencies));

    // Calculate total assets (converted to preferred currency)
    let totalAssets = 0;
    for (const asset of assets) {
      let value: number;
      let valueCurrency: string;

      if ((asset.type === 'stock' || asset.type === 'etf') && asset.ticker) {
        const price = priceMap.get(asset.ticker);
        if (price) {
          value = asset.balance * price.price;
          valueCurrency = price.currency;
        } else {
          continue; // Skip if no price available
        }
      } else if (asset.type === 'metals' && asset.metadata?.metal_type) {
        // Handle metals
        const metalType = (asset.metadata as Record<string, unknown>).metal_type as string;
        const metalConfig = METAL_CONFIG[metalType];
        if (metalConfig) {
          const metalPrice = priceMap.get(metalConfig.symbol);
          if (metalPrice) {
            const userUnit = ((asset.metadata as Record<string, unknown>).metal_unit as string) || 'gram';
            const pricePerUserUnit = convertMetalPrice(metalPrice.price, metalConfig.priceUnit, userUnit);
            value = asset.balance * pricePerUserUnit;
            valueCurrency = metalPrice.currency;
          } else {
            continue; // Skip if no price available
          }
        } else {
          continue;
        }
      } else {
        value = asset.balance;
        valueCurrency = asset.currency || 'USD';
      }

      // Convert to preferred currency
      const conversion = convertAmount(value, valueCurrency, preferredCurrency, rateMap);
      totalAssets += conversion ? conversion.converted : value;
    }

    // Calculate total debts (converted to preferred currency)
    let totalDebts = 0;
    for (const debt of debts) {
      const value = debt.current_balance;
      const valueCurrency = debt.currency || 'USD';

      const conversion = convertAmount(value, valueCurrency, preferredCurrency, rateMap);
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
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to calculate net worth' });
  }
};
