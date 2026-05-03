import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { AppError } from '../middleware/error';
import { getViewContext } from '../utils/family-context';
import { Trade } from '../types/portfolio';
import { COMMODITY_CONFIG, COMMODITY_TICKERS, VALID_UNITS } from '../config/commodities';

/**
 * Verify that a portfolio belongs to the current user/family context.
 * Returns the portfolio id if valid, throws AppError otherwise.
 */
async function verifyPortfolioOwnership(
  portfolioId: string,
  belongId: string
): Promise<void> {
  const { data } = await supabaseAdmin
    .from('portfolios')
    .select('id')
    .eq('id', portfolioId)
    .eq('belong_id', belongId)
    .single();

  if (!data) {
    throw new AppError('Portfolio not found', 404);
  }
}

// GET /api/portfolios/:id/trades
export const listTrades = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Trade[]>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const portfolioId = req.params.id;

    await verifyPortfolioOwnership(portfolioId, ctx.belongId);

    const { data, error } = await supabaseAdmin
      .from('trades')
      .select('*')
      .eq('portfolio_id', portfolioId)
      .order('date', { ascending: false });

    if (error) {
      throw new AppError('Failed to fetch trades', 500);
    }

    res.json({ success: true, data: data || [] });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch trades' });
  }
};

// POST /api/portfolios/:id/trades
export const createTrade = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Trade>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const portfolioId = req.params.id;

    await verifyPortfolioOwnership(portfolioId, ctx.belongId);

    const { ticker, market, type, shares, price, currency, date, notes, asset_type, unit } = req.body;

    const resolvedAssetType: 'stock' | 'commodity' = asset_type === 'commodity' ? 'commodity' : 'stock';

    if (!ticker || !type || shares === undefined || price === undefined || !currency || !date) {
      throw new AppError('ticker, type, shares, price, currency, and date are required', 400);
    }

    if (!['buy', 'sell'].includes(type)) {
      throw new AppError('type must be buy or sell', 400);
    }

    let resolvedMarket: string;
    let resolvedUnit: string | null = null;

    if (resolvedAssetType === 'commodity') {
      const upperTicker = ticker.toUpperCase();
      if (!COMMODITY_TICKERS.includes(upperTicker as typeof COMMODITY_TICKERS[number])) {
        throw new AppError(`ticker must be one of: ${COMMODITY_TICKERS.join(', ')}`, 400);
      }
      if (!unit) {
        resolvedUnit = COMMODITY_CONFIG[upperTicker as typeof COMMODITY_TICKERS[number]].unit;
      } else {
        if (!VALID_UNITS.includes(unit)) {
          throw new AppError(`unit must be one of: ${VALID_UNITS.join(', ')}`, 400);
        }
        resolvedUnit = unit;
      }
      resolvedMarket = 'COMMODITY';
    } else {
      if (!market || !['US', 'SGX', 'HK', 'CN'].includes(market)) {
        throw new AppError('market must be one of: US, SGX, HK, CN', 400);
      }
      resolvedMarket = market;
    }

    const { data, error } = await supabaseAdmin
      .from('trades')
      .insert({
        portfolio_id: portfolioId,
        ticker: ticker.toUpperCase(),
        market: resolvedMarket,
        type,
        shares: Number(shares),
        price: Number(price),
        currency,
        date,
        notes: notes || null,
        asset_type: resolvedAssetType,
        unit: resolvedUnit,
      })
      .select()
      .single();

    if (error || !data) {
      console.error('createTrade DB error:', error);
      throw new AppError('Failed to create trade', 500);
    }

    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to create trade' });
  }
};

// PUT /api/portfolios/:id/trades/:tradeId
export const updateTrade = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Trade>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const portfolioId = req.params.id;
    const tradeId = req.params.tradeId;

    await verifyPortfolioOwnership(portfolioId, ctx.belongId);

    const { ticker, market, type, shares, price, currency, date, notes, unit } = req.body;

    // Fetch existing trade to know its asset_type (can't change asset_type after creation)
    const { data: existing } = await supabaseAdmin
      .from('trades')
      .select('asset_type')
      .eq('id', tradeId)
      .eq('portfolio_id', portfolioId)
      .single();

    if (!existing) {
      throw new AppError('Trade not found', 404);
    }

    const isCommodity = existing.asset_type === 'commodity';

    if (market && !isCommodity && !['US', 'SGX', 'HK', 'CN'].includes(market)) {
      throw new AppError('market must be one of: US, SGX, HK, CN', 400);
    }

    if (type && !['buy', 'sell'].includes(type)) {
      throw new AppError('type must be buy or sell', 400);
    }

    if (unit !== undefined) {
      if (!isCommodity) {
        throw new AppError('unit can only be set on commodity trades', 400);
      }
      if (!VALID_UNITS.includes(unit)) {
        throw new AppError(`unit must be one of: ${VALID_UNITS.join(', ')}`, 400);
      }
    }

    const updates: Record<string, unknown> = {};
    if (ticker !== undefined) {
      const upper = ticker.toUpperCase();
      if (isCommodity && !COMMODITY_TICKERS.includes(upper as typeof COMMODITY_TICKERS[number])) {
        throw new AppError(`ticker must be one of: ${COMMODITY_TICKERS.join(', ')}`, 400);
      }
      updates.ticker = upper;
    }
    if (market !== undefined && !isCommodity) updates.market = market;
    if (type !== undefined) updates.type = type;
    if (shares !== undefined) updates.shares = Number(shares);
    if (price !== undefined) updates.price = Number(price);
    if (currency !== undefined) updates.currency = currency;
    if (date !== undefined) updates.date = date;
    if (notes !== undefined) updates.notes = notes;
    if (unit !== undefined && isCommodity) updates.unit = unit;

    const { data, error } = await supabaseAdmin
      .from('trades')
      .update(updates)
      .eq('id', tradeId)
      .eq('portfolio_id', portfolioId)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('Trade not found', 404);
    }

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to update trade' });
  }
};

// DELETE /api/portfolios/:id/trades/:tradeId
export const deleteTrade = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<null>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const portfolioId = req.params.id;
    const tradeId = req.params.tradeId;

    await verifyPortfolioOwnership(portfolioId, ctx.belongId);

    const { error } = await supabaseAdmin
      .from('trades')
      .delete()
      .eq('id', tradeId)
      .eq('portfolio_id', portfolioId);

    if (error) {
      throw new AppError('Failed to delete trade', 500);
    }

    res.json({ success: true, data: null });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to delete trade' });
  }
};
