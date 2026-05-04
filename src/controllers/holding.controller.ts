import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { AppError } from '../middleware/error';
import { getViewContext } from '../utils/family-context';
import { fetchStockPrices } from '../utils/findata-client';
import { buildHoldings, computePositions } from '../utils/portfolio-calc';
import { Holding, Trade } from '../types/portfolio';
import { getExchangeRates, convertAmount } from '../utils/currency-conversion';

// GET /api/portfolios/:id/holdings — computed from trades + live prices
export const getHoldings = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Holding[]>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const portfolioId = req.params.id;

    // 1. Verify portfolio ownership
    const { data: portfolio } = await supabaseAdmin
      .from('portfolios')
      .select('id')
      .eq('id', portfolioId)
      .eq('belong_id', ctx.belongId)
      .single();

    if (!portfolio) {
      throw new AppError('Portfolio not found', 404);
    }

    // 2. Get all trades for portfolio
    const { data: trades, error: tradesError } = await supabaseAdmin
      .from('trades')
      .select('*')
      .eq('portfolio_id', portfolioId)
      .order('date', { ascending: true });

    if (tradesError) {
      throw new AppError('Failed to fetch trades', 500);
    }

    const tradeList: Trade[] = trades || [];

    if (tradeList.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    // 3. Get unique tickers with shares > 0
    const positions = computePositions(tradeList);
    const activeTickers = Array.from(positions.entries())
      .filter(([, pos]) => pos.shares > 0)
      .map(([ticker]) => ticker);

    // 4. Batch fetch prices from findata
    const pricesRaw = await fetchStockPrices(activeTickers);

    // Build priceMap in the format buildHoldings expects
    const priceMap: Record<string, { price: number | null; currency: string }> = {};
    for (const [ticker, stockPrice] of Object.entries(pricesRaw)) {
      priceMap[ticker] = {
        price: stockPrice.price,
        currency: stockPrice.currency,
      };
    }

    // 5. Build holdings via buildHoldings()
    const holdings = buildHoldings(tradeList, priceMap);

    // 6. Enrich holdings with value_usd for correct cross-currency weight calculations

    // Build ticker→currency map (findata is authoritative)
    const tickerCurrency = new Map<string, string>();
    for (const trade of tradeList) {
      tickerCurrency.set(trade.ticker.toUpperCase(), trade.currency || 'USD');
    }
    for (const [ticker, priceData] of Object.entries(pricesRaw)) {
      if (priceData.currency) tickerCurrency.set(ticker.toUpperCase(), priceData.currency);
    }

    // Fetch exchange rates for all involved currencies
    const currencies = new Set<string>(['usd']);
    tickerCurrency.forEach(c => currencies.add(c.toLowerCase()));
    const rateMap = await getExchangeRates(Array.from(currencies));

    function toUSD(amount: number, fromCurrency: string): number | undefined {
      if (fromCurrency.toLowerCase() === 'usd') return amount;
      const result = convertAmount(amount, fromCurrency, 'USD', rateMap);
      return result?.converted;
    }

    const enriched = holdings.map(h => ({
      ...h,
      value_usd: h.value !== null ? toUSD(h.value, h.currency) : undefined,
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch holdings' });
  }
};
