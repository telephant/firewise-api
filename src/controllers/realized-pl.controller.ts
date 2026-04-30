import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { AppError } from '../middleware/error';
import { getViewContext } from '../utils/family-context';
import { computePositions } from '../utils/portfolio-calc';
import { Trade } from '../types/portfolio';

interface RealizedPLItem {
  ticker: string;
  realized_pl: number;
  trade_count: number;
}

// GET /api/portfolios/:id/realized-pl
export const getRealizedPL = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<RealizedPLItem[]>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const portfolioId = req.params.id;

    // Auth + ownership check
    const { data: portfolio } = await supabaseAdmin
      .from('portfolios')
      .select('id')
      .eq('id', portfolioId)
      .eq('belong_id', ctx.belongId)
      .single();

    if (!portfolio) {
      throw new AppError('Portfolio not found', 404);
    }

    // Fetch trades
    const { data: trades, error: tradesError } = await supabaseAdmin
      .from('trades')
      .select('*')
      .eq('portfolio_id', portfolioId)
      .order('date', { ascending: true });

    if (tradesError) {
      throw new AppError('Failed to fetch trades', 500);
    }

    const tradeList: Trade[] = trades || [];

    // Compute positions
    const positions = computePositions(tradeList);

    // Build trade count per ticker
    const tradeCountMap = new Map<string, number>();
    for (const trade of tradeList) {
      const key = trade.ticker.toUpperCase();
      tradeCountMap.set(key, (tradeCountMap.get(key) || 0) + 1);
    }

    // Collect positions with realized_pl !== 0
    const result: RealizedPLItem[] = [];
    for (const [ticker, pos] of positions) {
      if (pos.realized_pl !== 0) {
        result.push({
          ticker,
          realized_pl: pos.realized_pl,
          trade_count: tradeCountMap.get(ticker) || 0,
        });
      }
    }

    // Sort by realized_pl descending
    result.sort((a, b) => b.realized_pl - a.realized_pl);

    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch realized P&L' });
  }
};
