import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { AppError } from '../middleware/error';
import { getViewContext } from '../utils/family-context';
import { fetchStockPrices } from '../utils/findata-client';
import { computePositions } from '../utils/portfolio-calc';
import { getExchangeRates, convertAmount } from '../utils/currency-conversion';
import { PortfolioStats, PortfolioSnapshot, Trade } from '../types/portfolio';

// All monetary values returned in USD. Frontend handles display currency conversion.

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

    // 4. Build ticker→currency map from trades + findata (findata is authoritative for price currency)
    const tickerCurrency = new Map<string, string>();
    for (const trade of tradeList) {
      tickerCurrency.set(trade.ticker.toUpperCase(), trade.currency || 'USD');
    }
    for (const [ticker, priceData] of Object.entries(pricesRaw)) {
      if (priceData.currency) tickerCurrency.set(ticker.toUpperCase(), priceData.currency);
    }

    // Fetch exchange rates for all involved currencies → USD
    const allCurrencies = new Set<string>(['usd']);
    tickerCurrency.forEach(c => allCurrencies.add(c.toLowerCase()));
    const rateMap = await getExchangeRates(Array.from(allCurrencies));

    // Convert any amount to USD; returns 0 if rate missing (never silently return native amount as USD)
    function toUSD(amount: number, fromCurrency: string): number {
      if (fromCurrency.toLowerCase() === 'usd') return amount;
      const result = convertAmount(amount, fromCurrency, 'USD', rateMap);
      if (!result) {
        console.warn(`[portfolio-stats] Missing exchange rate for ${fromCurrency} → USD; treating as 0`);
        return 0;
      }
      return result.converted;
    }

    // 5. Compute totals in USD
    let total_value = 0;
    let total_cost = 0;
    let realized_pl = 0;

    for (const [ticker, pos] of positions) {
      const tickerCurr = tickerCurrency.get(ticker) || 'USD';
      realized_pl += toUSD(pos.realized_pl, tickerCurr);
      if (pos.shares <= 0) continue;

      total_cost += toUSD(pos.shares * pos.avg_cost, tickerCurr);

      const priceData = pricesRaw[ticker];
      if (priceData?.price != null) {
        const priceCurr = priceData.currency || tickerCurr;
        total_value += toUSD(pos.shares * priceData.price, priceCurr);
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
        .select('total_amount, tax_withheld, currency')
        .eq('portfolio_id', portfolioId)
        .gte('ex_date', `${currentYear}-01-01`)
        .lte('ex_date', `${currentYear}-12-31`),
      supabaseAdmin
        .from('dividends')
        .select('total_amount, tax_withheld, currency')
        .eq('portfolio_id', portfolioId)
        .gte('ex_date', `${currentYear}-${monthStr}-01`)
        .lte('ex_date', `${currentYear}-${monthStr}-${daysInMonth}`),
    ]);

    const dividend_ytd = (ytdResult.data || []).reduce(
      (sum, row) => sum + toUSD((row.total_amount || 0) - (row.tax_withheld || 0), row.currency || 'USD'), 0
    );
    const dividend_mtd = (mtdResult.data || []).reduce(
      (sum, row) => sum + toUSD((row.total_amount || 0) - (row.tax_withheld || 0), row.currency || 'USD'), 0
    );

    // 6. MoM gain from last 2 snapshots
    const { data: snapshots } = await supabaseAdmin
      .from('portfolio_snapshots')
      .select('total_value, unrealized_pl, snapshot_date, currency')
      .eq('portfolio_id', portfolioId)
      .order('snapshot_date', { ascending: false })
      .limit(2);

    let mom_gain: number | null = null;
    let mom_gain_pct: number | null = null;
    let mom_unrealized_pl: number | null = null;

    if (snapshots && snapshots.length >= 2) {
      const prevSnapshot = snapshots[1];
      // Only compute MoM values if snapshot is in USD (cannot reliably compare different currencies)
      if ((prevSnapshot.currency || '').toUpperCase() === 'USD') {
        mom_gain = total_value - prevSnapshot.total_value + dividend_mtd;
        mom_gain_pct =
          prevSnapshot.total_value > 0 ? (mom_gain / prevSnapshot.total_value) * 100 : null;
        mom_unrealized_pl = unrealized_pl - (prevSnapshot.unrealized_pl ?? 0);
      }
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
      mom_unrealized_pl,
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
