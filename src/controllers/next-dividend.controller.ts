import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { getViewContext } from '../utils/family-context';
import { getExchangeRates, convertAmount } from '../utils/currency-conversion';
import { computePositions } from '../utils/portfolio-calc';
import { Trade } from '../types/portfolio';
import * as findata from '../utils/findata-client';

interface NextDividendResponse {
  date: string;
  amount_usd: number;
  ticker: string;
  portfolio_name: string;
  is_forecasted: boolean;
}

/**
 * GET /api/fire/next-dividend
 *
 * Returns the single nearest upcoming dividend across all portfolios.
 * Only considers holdings that actually pay dividends (has_dividends=true).
 * Uses next_ex_date from findata to determine the nearest event.
 */
export const getNextDividend = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<NextDividendResponse | null>>
): Promise<void> => {
  try {
    const viewContext = await getViewContext(req);

    // 1. Get all portfolios
    const { data: portfolios, error: portfoliosError } = await supabaseAdmin
      .from('portfolios')
      .select('id, name, currency')
      .eq('belong_id', viewContext.belongId);

    if (portfoliosError || !portfolios || portfolios.length === 0) {
      res.json({ success: true, data: null });
      return;
    }

    const portfolioIds = portfolios.map((p) => p.id);
    const portfolioMap = new Map(portfolios.map((p) => [p.id, p]));

    // 2. Get all trades to compute active positions
    const { data: allTrades, error: tradesError } = await supabaseAdmin
      .from('trades')
      .select('*')
      .in('portfolio_id', portfolioIds)
      .order('date', { ascending: true });

    if (tradesError || !allTrades || allTrades.length === 0) {
      res.json({ success: true, data: null });
      return;
    }

    // 3. Compute active positions per portfolio
    // Group trades by portfolio to preserve portfolio attribution
    const tradesByPortfolio = new Map<string, Trade[]>();
    for (const trade of allTrades as Trade[]) {
      if (!tradesByPortfolio.has(trade.portfolio_id)) {
        tradesByPortfolio.set(trade.portfolio_id, []);
      }
      tradesByPortfolio.get(trade.portfolio_id)!.push(trade);
    }

    // Collect all active tickers across portfolios (deduplicated for batch fetch)
    const tickerPortfolioMap = new Map<string, { shares: number; portfolioId: string }>();
    for (const [portfolioId, trades] of tradesByPortfolio) {
      const positions = computePositions(trades);
      for (const [ticker, pos] of positions.entries()) {
        if (pos.shares <= 0.0001) continue;
        // If ticker appears in multiple portfolios, pick the one with more shares
        const existing = tickerPortfolioMap.get(ticker);
        if (!existing || pos.shares > existing.shares) {
          tickerPortfolioMap.set(ticker, { shares: pos.shares, portfolioId });
        }
      }
    }

    if (tickerPortfolioMap.size === 0) {
      res.json({ success: true, data: null });
      return;
    }

    const activeTickers = Array.from(tickerPortfolioMap.keys());

    // 4. Fetch dividend data for all active tickers
    const year = new Date().getFullYear();
    const dividendData = await findata.fetchDividendsBatch(activeTickers, year);

    // 5. Find the nearest upcoming dividend using next_ex_date
    // Only consider tickers that pay dividends
    const today = new Date().toISOString().split('T')[0];

    let nearest: {
      date: string;
      ticker: string;
      portfolioId: string;
      shares: number;
      amountPerShare: number;
      currency: string;
      isForecasted: boolean;
    } | null = null;

    for (const [ticker, data] of Object.entries(dividendData)) {
      if (!data || !data.has_dividends || !data.next_ex_date) continue;
      if (data.next_ex_date < today) continue;

      const tickerInfo = tickerPortfolioMap.get(ticker);
      if (!tickerInfo) continue;

      // Estimate per-share amount from annual total / frequency
      const divEvents = data.dividends.filter((d) => d.is_forecasted || !d.is_forecasted);
      const nextEvent = divEvents.find((d) => d.date >= today);
      const amountPerShare = nextEvent?.amount ?? (data.annual_total_per_share > 0
        ? data.annual_total_per_share / Math.max((data.payment_months?.length ?? 4), 1)
        : 0);

      if (amountPerShare <= 0) continue;

      if (!nearest || data.next_ex_date < nearest.date) {
        nearest = {
          date: data.next_ex_date,
          ticker,
          portfolioId: tickerInfo.portfolioId,
          shares: tickerInfo.shares,
          amountPerShare,
          currency: data.currency || 'USD',
          isForecasted: true,
        };
      }
    }

    if (!nearest) {
      res.json({ success: true, data: null });
      return;
    }

    // 6. Convert amount to USD
    const grossAmount = nearest.amountPerShare * nearest.shares;
    let amountUsd = grossAmount;

    if (nearest.currency.toUpperCase() !== 'USD') {
      const currencies = new Set([nearest.currency.toLowerCase(), 'usd']);
      const rateMap = await getExchangeRates(Array.from(currencies));
      const converted = convertAmount(grossAmount, nearest.currency, 'USD', rateMap);
      if (converted) amountUsd = converted.converted;
    }

    const portfolio = portfolioMap.get(nearest.portfolioId);

    res.json({
      success: true,
      data: {
        date: nearest.date,
        amount_usd: amountUsd,
        ticker: nearest.ticker,
        portfolio_name: portfolio?.name ?? '',
        is_forecasted: nearest.isForecasted,
      },
    });
  } catch (err) {
    console.error('getNextDividend error:', err);
    res.status(500).json({ success: false, error: 'Failed to get next dividend' });
  }
};
