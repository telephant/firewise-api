import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { AppError } from '../middleware/error';
import { getViewContext } from '../utils/family-context';
import { fetchStockPrices } from '../utils/findata-client';
import { computePositions } from '../utils/portfolio-calc';
import { getExchangeRates, convertAmount } from '../utils/currency-conversion';
import { PortfolioStats, PortfolioSnapshot, Trade } from '../types/portfolio';

// GET /api/portfolios/:id/stats
export const getPortfolioStats = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<PortfolioStats>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const portfolioId = req.params.id;

    // Verify ownership and get portfolio currency
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

    // 2. Compute positions (realized_pl is per-ticker inside positions)
    const positions = computePositions(tradeList);

    // 3. Fetch prices for open positions
    const activeTickers = Array.from(positions.entries())
      .filter(([, pos]) => pos.shares > 0)
      .map(([ticker]) => ticker);

    const pricesRaw = activeTickers.length > 0 ? await fetchStockPrices(activeTickers) : {};

    // 4. Collect currencies needed for conversion
    // trade.currency is the currency for each ticker's avg_cost/price
    const tickerCurrency = new Map<string, string>();
    for (const trade of tradeList) {
      tickerCurrency.set(trade.ticker.toUpperCase(), trade.currency || 'USD');
    }
    // Also include price currencies from findata (may differ from trade currency)
    for (const [ticker, priceData] of Object.entries(pricesRaw)) {
      if (priceData.currency) tickerCurrency.set(ticker.toUpperCase(), priceData.currency);
    }

    const portfolioCurrency = portfolio.currency || 'USD';
    const allCurrencies = new Set<string>([portfolioCurrency.toLowerCase()]);
    tickerCurrency.forEach(c => allCurrencies.add(c.toLowerCase()));

    const rateMap = await getExchangeRates(Array.from(allCurrencies));

    // Helper: convert to portfolio currency, fallback to original if rate unavailable
    function toPortfolioCurrency(amount: number, fromCurrency: string): number {
      if (fromCurrency.toLowerCase() === portfolioCurrency.toLowerCase()) return amount;
      const result = convertAmount(amount, fromCurrency, portfolioCurrency, rateMap);
      return result ? result.converted : amount; // fallback: use as-is
    }

    // 5. Compute total_value, total_cost, unrealized_pl (all in portfolio currency)
    let total_value = 0;
    let total_cost = 0;

    for (const [ticker, pos] of positions) {
      if (pos.shares <= 0) continue;
      const tickerCurr = tickerCurrency.get(ticker) || 'USD';
      const costLocal = pos.shares * pos.avg_cost;
      total_cost += toPortfolioCurrency(costLocal, tickerCurr);

      const priceData = pricesRaw[ticker];
      if (priceData?.price != null) {
        // Use findata's currency for price (most accurate)
        const priceCurr = priceData.currency || tickerCurr;
        const valueLocal = pos.shares * priceData.price;
        total_value += toPortfolioCurrency(valueLocal, priceCurr);
      }
    }

    const unrealized_pl = total_value - total_cost;

    // 6. Realized P&L — sum per-ticker, each converted to portfolio currency
    let realized_pl = 0;
    for (const [ticker, pos] of positions) {
      if (pos.realized_pl === 0) continue;
      const tickerCurr = tickerCurrency.get(ticker) || 'USD';
      realized_pl += toPortfolioCurrency(pos.realized_pl, tickerCurr);
    }

    // 7. Query dividends table: dividend_ytd / dividend_mtd
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const monthStr = String(currentMonth).padStart(2, '0');
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();

    const [ytdResult, mtdResult] = await Promise.all([
      supabaseAdmin
        .from('dividends')
        .select('total_amount, currency')
        .eq('portfolio_id', portfolioId)
        .gte('ex_date', `${currentYear}-01-01`)
        .lte('ex_date', `${currentYear}-12-31`),
      supabaseAdmin
        .from('dividends')
        .select('total_amount, currency')
        .eq('portfolio_id', portfolioId)
        .gte('ex_date', `${currentYear}-${monthStr}-01`)
        .lte('ex_date', `${currentYear}-${monthStr}-${daysInMonth}`),
    ]);

    // Convert each dividend row to portfolio currency before summing
    const dividend_ytd = (ytdResult.data || []).reduce(
      (sum, row) => sum + toPortfolioCurrency(row.total_amount || 0, row.currency || 'USD'),
      0
    );
    const dividend_mtd = (mtdResult.data || []).reduce(
      (sum, row) => sum + toPortfolioCurrency(row.total_amount || 0, row.currency || 'USD'),
      0
    );

    // 6. Query portfolio_snapshots for MoM gain (last 2 month-end snapshots)
    const { data: snapshots } = await supabaseAdmin
      .from('portfolio_snapshots')
      .select('total_value, snapshot_date')
      .eq('portfolio_id', portfolioId)
      .order('snapshot_date', { ascending: false })
      .limit(2);

    let mom_gain: number | null = null;
    let mom_gain_pct: number | null = null;

    if (snapshots && snapshots.length >= 2) {
      const prevSnapshot = snapshots[1]; // older of the two
      // mom_gain = current_total_value - prev_snapshot.total_value + current_month_dividends
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
      currency: portfolio.currency,
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

    // Verify ownership
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
