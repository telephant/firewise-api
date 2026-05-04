import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { AppError } from '../middleware/error';
import { getViewContext } from '../utils/family-context';
import { fetchStockPrices } from '../utils/findata-client';
import { computePositions } from '../utils/portfolio-calc';
import { PortfolioStats, PortfolioSnapshot, Trade } from '../types/portfolio';

// All monetary values are in USD. Portfolio currency is display-only.

// GET /api/portfolios/:id/stats
export const getPortfolioStats = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<PortfolioStats>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const portfolioId = req.params.id;

    // Verify ownership
    const { data: portfolio } = await supabaseAdmin
      .from('portfolios')
      .select('id, currency')
      .eq('id', portfolioId)
      .eq('belong_id', ctx.belongId)
      .single();

    if (!portfolio) {
      throw new AppError('Portfolio not found', 404);
    }

    // 1. Get all trades
    const { data: trades, error: tradesError } = await supabaseAdmin
      .from('trades')
      .select('*')
      .eq('portfolio_id', portfolioId)
      .order('date', { ascending: true });

    if (tradesError) {
      throw new AppError('Failed to fetch trades', 500);
    }

    const tradeList: Trade[] = trades || [];

    // 2. Compute positions (includes per-ticker realized_pl)
    const positions = computePositions(tradeList);

    // 3. Fetch live prices for open positions
    const activeTickers = Array.from(positions.entries())
      .filter(([, pos]) => pos.shares > 0)
      .map(([ticker]) => ticker);

    const pricesRaw = activeTickers.length > 0 ? await fetchStockPrices(activeTickers) : {};

    // 4. Compute totals — all in USD (prices from findata are in USD for US stocks)
    let total_value = 0;
    let total_cost = 0;
    let realized_pl = 0;

    for (const [ticker, pos] of positions) {
      realized_pl += pos.realized_pl;
      if (pos.shares <= 0) continue;

      total_cost += pos.shares * pos.avg_cost;

      const priceData = pricesRaw[ticker];
      if (priceData?.price != null) {
        total_value += pos.shares * priceData.price;
      }
    }

    const unrealized_pl = total_value - total_cost;

    // 5. Dividends YTD / MTD (stored in USD)
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const monthStr = String(currentMonth).padStart(2, '0');
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();

    const [ytdResult, mtdResult] = await Promise.all([
      supabaseAdmin
        .from('dividends')
        .select('total_amount')
        .eq('portfolio_id', portfolioId)
        .gte('ex_date', `${currentYear}-01-01`)
        .lte('ex_date', `${currentYear}-12-31`),
      supabaseAdmin
        .from('dividends')
        .select('total_amount')
        .eq('portfolio_id', portfolioId)
        .gte('ex_date', `${currentYear}-${monthStr}-01`)
        .lte('ex_date', `${currentYear}-${monthStr}-${daysInMonth}`),
    ]);

    const dividend_ytd = (ytdResult.data || []).reduce(
      (sum, row) => sum + (row.total_amount || 0), 0
    );
    const dividend_mtd = (mtdResult.data || []).reduce(
      (sum, row) => sum + (row.total_amount || 0), 0
    );

    // 6. MoM gain from last 2 snapshots
    const { data: snapshots } = await supabaseAdmin
      .from('portfolio_snapshots')
      .select('total_value, snapshot_date')
      .eq('portfolio_id', portfolioId)
      .order('snapshot_date', { ascending: false })
      .limit(2);

    let mom_gain: number | null = null;
    let mom_gain_pct: number | null = null;

    if (snapshots && snapshots.length >= 2) {
      const prevSnapshot = snapshots[1];
      mom_gain = total_value - prevSnapshot.total_value + dividend_mtd;
      mom_gain_pct =
        prevSnapshot.total_value > 0 ? (mom_gain / prevSnapshot.total_value) * 100 : null;
    }

    const stats: PortfolioStats = {
      total_value,
      total_cost,
      unrealized_pl,
      realized_pl,
      dividend_ytd,
      dividend_mtd,
      mom_gain,
      mom_gain_pct,
      currency: 'USD',
    };

    res.json({ success: true, data: stats });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch portfolio stats' });
  }
};

// GET /api/portfolios/:id/snapshots
export const listSnapshots = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<PortfolioSnapshot[]>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const portfolioId = req.params.id;

    const { data: portfolio } = await supabaseAdmin
      .from('portfolios')
      .select('id')
      .eq('id', portfolioId)
      .eq('belong_id', ctx.belongId)
      .single();

    if (!portfolio) {
      throw new AppError('Portfolio not found', 404);
    }

    const { data, error } = await supabaseAdmin
      .from('portfolio_snapshots')
      .select('*')
      .eq('portfolio_id', portfolioId)
      .order('snapshot_date', { ascending: false });

    if (error) {
      throw new AppError('Failed to fetch snapshots', 500);
    }

    res.json({ success: true, data: data || [] });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch snapshots' });
  }
};
