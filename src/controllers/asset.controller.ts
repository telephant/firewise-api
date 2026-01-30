import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse, Asset, AssetFilters } from '../types';
import { AppError } from '../middleware/error';
import { addConvertedFieldsToArray, addConvertedFieldsToSingle, getUserPreferences, getExchangeRates, convertAmount } from '../utils/currency-conversion';
import { fetchStockPrice, fetchStockPrices } from '../utils/stock-price';
import { getViewContext, applyOwnershipFilter, applyOwnershipFilterWithId, buildOwnershipValues } from '../utils/family-context';

interface StockAssetResult extends Asset {
  stock_price?: number;
  stock_currency?: string;
  market_value?: number;
  converted_balance?: number;
  converted_currency?: string;
}

/**
 * Add stock prices and converted values to stock/ETF assets
 * Balance remains as shares, but we calculate and convert market_value
 */
async function addStockPricesAndConversion(
  assets: Asset[],
  preferredCurrency: string
): Promise<StockAssetResult[]> {
  // Find all stock/ETF assets with tickers
  const stockAssets = assets.filter(a => (a.type === 'stock' || a.type === 'etf') && a.ticker);
  const tickers = [...new Set(stockAssets.map(a => a.ticker!))];

  // Fetch all stock prices in parallel
  const pricePromises = tickers.map(ticker => fetchStockPrice(ticker));
  const priceResults = await Promise.all(pricePromises);

  // Create price map
  const priceMap = new Map<string, { price: number; currency: string }>();
  tickers.forEach((ticker, index) => {
    if (priceResults[index]) {
      priceMap.set(ticker, priceResults[index]!);
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

  // Add stock_price, market_value, and converted_balance to assets
  return assets.map(asset => {
    if ((asset.type === 'stock' || asset.type === 'etf') && asset.ticker) {
      const stockPrice = priceMap.get(asset.ticker);
      if (stockPrice) {
        // Calculate market value in stock's currency
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
    const { page = '1', limit = '50', type, sortBy = 'created_at', sortOrder = 'desc' } = req.query as unknown as AssetFilters & { page: string; limit: string; sortBy?: string; sortOrder?: string };

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

    query = query.range(offset, offset + limitNum - 1);

    const { data: assets, error, count } = await query;

    if (error) {
      throw new AppError('Failed to fetch assets', 500);
    }

    // Get user preferences for currency
    const prefs = await getUserPreferences(userId);
    const preferredCurrency = prefs?.preferred_currency || 'USD';

    // Add stock prices and convert to preferred currency for stock/ETF assets
    const assetsWithStockPrices = await addStockPricesAndConversion(assets || [], preferredCurrency);

    // Add currency conversion fields for non-stock assets
    // Stock assets already have converted_balance from addStockPricesAndConversion
    const assetsWithConversion = await addConvertedFieldsToArray(
      assetsWithStockPrices.map(a => {
        // For stock/ETF: skip balance conversion (already handled above)
        if ((a.type === 'stock' || a.type === 'etf') && a.stock_price) {
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

    // Add currency conversion fields (skip for stocks - already handled above)
    const assetWithConversion = await addConvertedFieldsToSingle(
      {
        ...assetWithStockPrice,
        skip_balance_conversion: (asset.type === 'stock' || asset.type === 'etf') && assetWithStockPrice.stock_price ? true : undefined,
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

    // Get ownership values based on view mode (personal or family)
    const ownershipValues = buildOwnershipValues(viewContext);

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
    const viewContext = await getViewContext(req);
    const { id } = req.params;
    const { name, type, ticker, currency, market, metadata, balance } = req.body;

    // Check if asset exists and belongs to user/family
    let checkQuery = supabaseAdmin.from('assets').select('id');
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
    let assetsQuery = supabaseAdmin.from('assets').select('id, type, ticker, balance, currency');
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

    const pricePromises = tickers.map(ticker => fetchStockPrice(ticker));
    const priceResults = await Promise.all(pricePromises);

    const priceMap = new Map<string, { price: number; currency: string }>();
    tickers.forEach((ticker, index) => {
      if (priceResults[index]) {
        priceMap.set(ticker, priceResults[index]!);
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
