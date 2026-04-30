import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { AppError } from '../middleware/error';
import { getViewContext } from '../utils/family-context';
import { Trade } from '../types/portfolio';

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

    const { ticker, market, type, shares, price, currency, date, notes } = req.body;

    if (!ticker || !market || !type || shares === undefined || price === undefined || !currency || !date) {
      throw new AppError('ticker, market, type, shares, price, currency, and date are required', 400);
    }

    if (!['US', 'SGX', 'HK', 'CN'].includes(market)) {
      throw new AppError('market must be one of: US, SGX, HK, CN', 400);
    }

    if (!['buy', 'sell'].includes(type)) {
      throw new AppError('type must be buy or sell', 400);
    }

    const { data, error } = await supabaseAdmin
      .from('trades')
      .insert({
        portfolio_id: portfolioId,
        ticker: ticker.toUpperCase(),
        market,
        type,
        shares: Number(shares),
        price: Number(price),
        currency,
        date,
        notes: notes || null,
      })
      .select()
      .single();

    if (error || !data) {
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

    const { ticker, market, type, shares, price, currency, date, notes } = req.body;

    if (market && !['US', 'SGX', 'HK', 'CN'].includes(market)) {
      throw new AppError('market must be one of: US, SGX, HK, CN', 400);
    }

    if (type && !['buy', 'sell'].includes(type)) {
      throw new AppError('type must be buy or sell', 400);
    }

    const updates: Record<string, unknown> = {};
    if (ticker !== undefined) updates.ticker = ticker.toUpperCase();
    if (market !== undefined) updates.market = market;
    if (type !== undefined) updates.type = type;
    if (shares !== undefined) updates.shares = Number(shares);
    if (price !== undefined) updates.price = Number(price);
    if (currency !== undefined) updates.currency = currency;
    if (date !== undefined) updates.date = date;
    if (notes !== undefined) updates.notes = notes;

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
