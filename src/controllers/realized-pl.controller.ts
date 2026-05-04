import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { AppError } from '../middleware/error';
import { getViewContext } from '../utils/family-context';
import { fetchStockPrices } from '../utils/findata-client';
import { computePositions } from '../utils/portfolio-calc';
import { getExchangeRates, convertAmount } from '../utils/currency-conversion';
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

    // Build ticker→currency map from trades (findata will override below)
    const tickerCurrency = new Map<string, string>();
    for (const trade of tradeList) {
      tickerCurrency.set(trade.ticker.toUpperCase(), trade.currency || 'USD');
    }

    // Fetch live prices to get authoritative currency per ticker (active positions only)
    const activeTickers = Array.from(positions.entries())
      .filter(([, pos]) => pos.shares > 0)
      .map(([ticker]) => ticker);
    const pricesRaw = activeTickers.length > 0 ? await fetchStockPrices(activeTickers) : {};
    for (const [ticker, priceData] of Object.entries(pricesRaw)) {
      if (priceData.currency) tickerCurrency.set(ticker.toUpperCase(), priceData.currency);
    }

    // Fetch exchange rates for all involved currencies → USD
    const allCurrencies = new Set<string>(['usd']);
    tickerCurrency.forEach(c => allCurrencies.add(c.toLowerCase()));
    const rateMap = await getExchangeRates(Array.from(allCurrencies));

    // Convert any amount to USD; fallback to original if rate missing
    function toUSD(amount: number, fromCurrency: string): number {
      if (fromCurrency.toLowerCase() === 'usd') return amount;
      const result = convertAmount(amount, fromCurrency, 'USD', rateMap);
      return result ? result.converted : amount;
    }

    // Build trade count per ticker
    const tradeCountMap = new Map<string, number>();
    for (const trade of tradeList) {
      const key = trade.ticker.toUpperCase();
      tradeCountMap.set(key, (tradeCountMap.get(key) || 0) + 1);
    }

    // Collect positions with realized_pl !== 0, converting to USD
    const result: RealizedPLItem[] = [];
    for (const [ticker, pos] of positions) {
      if (pos.realized_pl !== 0) {
        const tickerCurr = tickerCurrency.get(ticker) || 'USD';
        result.push({
          ticker,
          realized_pl: toUSD(pos.realized_pl, tickerCurr),
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
