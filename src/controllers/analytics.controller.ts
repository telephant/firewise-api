// src/controllers/analytics.controller.ts
import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { AppError } from '../middleware/error';
import { getViewContext } from '../utils/family-context';
import { fetchStockPrices } from '../utils/findata-client';
import { buildHoldings, computePositions } from '../utils/portfolio-calc';
import { Trade } from '../types/portfolio';

const FINDATA_BASE_URL = process.env.FINDATA_URL || 'http://localhost:8002';

type ScoringProfile = 'lenient' | 'moderate' | 'strict';

interface MonthlyPrice { date: string; close: number | null; }

interface AnalyticsMetrics {
  sharpe_ratio: number | null;
  sortino_ratio: number | null;
  volatility_annual: number | null;
  max_drawdown: number | null;
  win_rate: number | null;
  avg_win_pct: number | null;
  avg_loss_pct: number | null;
  concentration_top3: number;
  concentration_hhi: number;
  market_count: number;
  data_months: number;
  beta: number | null;
  alpha_annual: number | null;
  r_squared: number | null;
}

interface AnalyticsScore {
  total: number;
  level: 'A' | 'B' | 'C' | 'D';
  return_quality: number;
  risk_control: number;
  diversification: number;
  win_loss_quality: number;
}

interface AnalyticsFlag { type: 'warning' | 'info'; message: string; }

interface AnalyticsResponse {
  score: AnalyticsScore;
  metrics: AnalyticsMetrics;
  flags: AnalyticsFlag[];
  scoring_profile: ScoringProfile;
}

async function fetchDailyHistory(ticker: string, market: string): Promise<MonthlyPrice[]> {
  if (market === 'COMMODITY') return [];
  // Tickers are already stored with exchange suffixes (e.g. D05.SI, 0700.HK)
  const yticker = ticker;
  try {
    const url = `${FINDATA_BASE_URL}/stock/history/${encodeURIComponent(yticker)}?period=1y&interval=1d`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json() as { prices: { date: string; close: number | null }[] };
    return data.prices ?? [];
  } catch {
    return [];
  }
}

function computePortfolioReturns(
  histories: { weight: number; prices: MonthlyPrice[] }[],
  referenceDates?: string[]
): number[] {
  if (histories.length === 0) return [];

  // Use provided date calendar (e.g. SPY), or fall back to first history with enough data
  let dates: string[];
  if (referenceDates && referenceDates.length >= 3) {
    dates = referenceDates;
  } else {
    const reference = histories.find(h => h.prices.length >= 3);
    if (!reference) return [];
    dates = reference.prices.filter(p => p.close !== null).map(p => p.date);
  }

  // Build date→price index per holding for O(1) lookup
  const priceIndex = histories.map(({ prices }) => {
    const m = new Map<string, number>();
    for (const p of prices) {
      if (p.close !== null) m.set(p.date, p.close);
    }
    return m;
  });

  const returns: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    let portfolioReturn = 0;
    for (let j = 0; j < histories.length; j++) {
      const prev = priceIndex[j].get(dates[i - 1]);
      const curr = priceIndex[j].get(dates[i]);
      if (prev && curr && prev > 0) {
        portfolioReturn += histories[j].weight * ((curr - prev) / prev);
      }
    }
    // Fixed-weight: missing prices (holidays, commodities) contribute 0 for that day.
    // Matches standard portfolio return methodology (no normalisation).
    returns.push(portfolioReturn);
  }
  return returns;
}

const RISK_FREE_DAILY = 0.04 / 252;

function calcSharpe(returns: number[]): number | null {
  if (returns.length < 63) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + Math.pow(r - mean, 2), 0) / (returns.length - 1);
  const stddev = Math.sqrt(variance);
  if (stddev === 0) return null;
  return ((mean - RISK_FREE_DAILY) / stddev) * Math.sqrt(252);
}

function calcSortino(returns: number[]): number | null {
  if (returns.length < 63) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const downside = returns.filter(r => r < RISK_FREE_DAILY);
  if (downside.length === 0) return null;
  const downVariance = downside.reduce((a, r) => a + Math.pow(r - RISK_FREE_DAILY, 2), 0) / downside.length;
  const downStd = Math.sqrt(downVariance);
  if (downStd === 0) return null;
  return ((mean - RISK_FREE_DAILY) / downStd) * Math.sqrt(252);
}

function calcVolatility(returns: number[]): number | null {
  if (returns.length < 63) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + Math.pow(r - mean, 2), 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

function calcMaxDrawdown(returns: number[]): number | null {
  if (returns.length < 63) return null;
  let peak = 1, value = 1, maxDD = 0;
  for (const r of returns) {
    value *= 1 + r;
    if (value > peak) peak = value;
    const dd = (value - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }
  return maxDD;
}

function calcBetaAlpha(portfolioReturns: number[], spyReturns: number[]): { beta: number | null; alpha_annual: number | null; r_squared: number | null } {
  // Align to same length (take the shorter)
  const n = Math.min(portfolioReturns.length, spyReturns.length);
  if (n < 63) return { beta: null, alpha_annual: null, r_squared: null };

  const p = portfolioReturns.slice(-n);
  const s = spyReturns.slice(-n);

  const meanP = p.reduce((a, b) => a + b, 0) / n;
  const meanS = s.reduce((a, b) => a + b, 0) / n;

  let cov = 0, varS = 0, varP = 0;
  for (let i = 0; i < n; i++) {
    cov += (p[i] - meanP) * (s[i] - meanS);
    varS += (s[i] - meanS) ** 2;
    varP += (p[i] - meanP) ** 2;
  }

  if (varS === 0) return { beta: null, alpha_annual: null, r_squared: null };

  const beta = cov / varS;
  const alpha_annual = (meanP - RISK_FREE_DAILY - beta * (meanS - RISK_FREE_DAILY)) * 12;
  const r_squared = varP === 0 ? 0 : (cov / Math.sqrt(varS * varP)) ** 2;

  return { beta, alpha_annual, r_squared };
}

function scoreMetric(value: number | null, thresholds: [number, number][], nullScore = 50): number {
  if (value === null) return nullScore;
  for (const [threshold, score] of thresholds) {
    if (value >= threshold) return score;
  }
  return 20;
}

function getThresholds(profile: ScoringProfile) {
  const m = profile === 'lenient' ? 0.8 : profile === 'strict' ? 1.2 : 1.0;
  return {
    sharpe:       [[1.5 / m, 100], [1.0 / m, 80], [0.5 / m, 60], [0, 40]] as [number, number][],
    sortino:      [[2.0 / m, 100], [1.5 / m, 80], [1.0 / m, 60], [0, 40]] as [number, number][],
    volatility:   [[-0.10 * m, 100], [-0.15 * m, 80], [-0.20 * m, 60], [-0.30 * m, 40]] as [number, number][],
    maxDrawdown:  [[-0.05 * m, 100], [-0.10 * m, 80], [-0.20 * m, 60], [-0.30 * m, 40]] as [number, number][],
    hhi:          [[-0.10 * m, 100], [-0.15 * m, 80], [-0.25 * m, 60], [-0.40 * m, 40]] as [number, number][],
    top3:         [[-0.40 * m, 100], [-0.50 * m, 80], [-0.60 * m, 60], [-0.75 * m, 40]] as [number, number][],
    winRate:      [[0.70 * m, 100], [0.60 * m, 80], [0.50 * m, 60], [0.40 * m, 40]] as [number, number][],
    profitFactor: [[3.0 / m, 100], [2.0 / m, 80], [1.5 / m, 60], [1.0 / m, 40]] as [number, number][],
  };
}

function calcScore(metrics: AnalyticsMetrics, profile: ScoringProfile): AnalyticsScore {
  const t = getThresholds(profile);
  const returnQuality = Math.round((scoreMetric(metrics.sharpe_ratio, t.sharpe) + scoreMetric(metrics.sortino_ratio, t.sortino)) / 2);
  const riskControl = Math.round(
    (scoreMetric(metrics.volatility_annual !== null ? -metrics.volatility_annual : null, t.volatility) +
     scoreMetric(metrics.max_drawdown, t.maxDrawdown)) / 2
  );
  const marketScore = metrics.market_count >= 3 ? 100 : metrics.market_count === 2 ? 70 : 40;
  const diversification = Math.round(
    (scoreMetric(-metrics.concentration_hhi, t.hhi) + marketScore + scoreMetric(-metrics.concentration_top3, t.top3)) / 3
  );
  // When there are no losers (avg_loss_pct is null) but there are winners, profit factor = 100 (max)
  const profitFactorScore = (metrics.avg_loss_pct === null && metrics.avg_win_pct !== null)
    ? 100
    : scoreMetric(
        metrics.avg_loss_pct !== null && metrics.avg_loss_pct !== 0 && metrics.avg_win_pct !== null
          ? metrics.avg_win_pct / Math.abs(metrics.avg_loss_pct)
          : null,
        t.profitFactor
      );
  const winLossQuality = Math.round((scoreMetric(metrics.win_rate, t.winRate) + profitFactorScore) / 2);
  const total = Math.round(returnQuality * 0.30 + riskControl * 0.30 + diversification * 0.25 + winLossQuality * 0.15);
  const level: 'A' | 'B' | 'C' | 'D' = total >= 85 ? 'A' : total >= 70 ? 'B' : total >= 55 ? 'C' : 'D';
  return { total, level, return_quality: returnQuality, risk_control: riskControl, diversification, win_loss_quality: winLossQuality };
}

function buildFlags(metrics: AnalyticsMetrics): AnalyticsFlag[] {
  const flags: AnalyticsFlag[] = [];
  if (metrics.concentration_top3 > 0.60) flags.push({ type: 'warning', message: 'Top 3 holdings exceed 60% of portfolio' });
  if (metrics.market_count === 1) flags.push({ type: 'warning', message: 'All holdings in a single market' });
  if (metrics.max_drawdown !== null && metrics.max_drawdown < -0.25) flags.push({ type: 'warning', message: 'Portfolio has experienced a drawdown > 25%' });
  if (metrics.data_months < 6) flags.push({ type: 'info', message: 'Less than 6 months of price history — some metrics may be less accurate' });
  if (metrics.win_rate !== null && metrics.win_rate < 0.40) flags.push({ type: 'info', message: 'Less than 40% of holdings are profitable' });
  return flags;
}

export const getAnalytics = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<AnalyticsResponse>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const portfolioId = req.params.id;
    const profile: ScoringProfile =
      req.query.profile === 'lenient' ? 'lenient'
      : req.query.profile === 'strict' ? 'strict'
      : 'moderate';

    // Verify ownership
    const { data: portfolio } = await supabaseAdmin
      .from('portfolios')
      .select('id')
      .eq('id', portfolioId)
      .eq('belong_id', ctx.belongId)
      .single();
    if (!portfolio) throw new AppError('Portfolio not found', 404);

    // Fetch trades (same as holding.controller.ts)
    const { data: trades, error: tradesError } = await supabaseAdmin
      .from('trades')
      .select('*')
      .eq('portfolio_id', portfolioId)
      .order('date', { ascending: true });

    if (tradesError) throw new AppError('Failed to fetch trades', 500);

    const tradeList: Trade[] = trades || [];

    if (tradeList.length === 0) {
      const emptyMetrics: AnalyticsMetrics = {
        sharpe_ratio: null, sortino_ratio: null, volatility_annual: null, max_drawdown: null,
        win_rate: null, avg_win_pct: null, avg_loss_pct: null,
        concentration_top3: 0, concentration_hhi: 0, market_count: 0, data_months: 0,
        beta: null, alpha_annual: null, r_squared: null,
      };
      res.json({ success: true, data: { score: calcScore(emptyMetrics, profile), metrics: emptyMetrics, flags: [], scoring_profile: profile } });
      return;
    }

    // Compute positions to get active tickers (same as holding.controller.ts)
    const positions = computePositions(tradeList);
    const activeTickers = Array.from(positions.entries())
      .filter(([, pos]) => pos.shares > 0)
      .map(([ticker]) => ticker);

    // Batch fetch live prices
    const pricesRaw = await fetchStockPrices(activeTickers);
    const priceMap: Record<string, { price: number | null; currency: string }> = {};
    for (const [ticker, stockPrice] of Object.entries(pricesRaw)) {
      priceMap[ticker] = { price: stockPrice.price, currency: stockPrice.currency };
    }

    // Build holdings (same as holding.controller.ts)
    const holdings = buildHoldings(tradeList, priceMap);
    const activeHoldings = holdings.filter(h => h.value !== null && h.value > 0);

    if (activeHoldings.length === 0) {
      const emptyMetrics: AnalyticsMetrics = {
        sharpe_ratio: null, sortino_ratio: null, volatility_annual: null, max_drawdown: null,
        win_rate: null, avg_win_pct: null, avg_loss_pct: null,
        concentration_top3: 0, concentration_hhi: 0, market_count: 0, data_months: 0,
        beta: null, alpha_annual: null, r_squared: null,
      };
      res.json({ success: true, data: { score: calcScore(emptyMetrics, profile), metrics: emptyMetrics, flags: [], scoring_profile: profile } });
      return;
    }

    const totalValue = activeHoldings.reduce((s, h) => s + (h.value ?? 0), 0);

    // Fetch price histories in parallel
    const historiesRaw = await Promise.all(
      activeHoldings.map(async h => ({
        weight: (h.value ?? 0) / totalValue,
        prices: await fetchDailyHistory(h.ticker, h.market),
      }))
    );

    // Re-normalise weights to sum to 1 after excluding holdings with no price data (e.g. commodities).
    // This ensures fixed-weight Sharpe is not deflated by missing-data holdings.
    const coveredWeight = historiesRaw.reduce((s, h) => s + (h.prices.length > 0 ? h.weight : 0), 0);
    const histories = coveredWeight > 0
      ? historiesRaw.map(h => ({ ...h, weight: h.prices.length > 0 ? h.weight / coveredWeight : 0 }))
      : historiesRaw;

    // Fetch SPY first — use its trading calendar as the reference date series
    const spyPrices = await fetchDailyHistory('SPY', 'US');
    const spyDates = spyPrices.filter(p => p.close !== null).map(p => p.date);
    const spyReturns: number[] = [];
    for (let i = 1; i < spyPrices.length; i++) {
      const prev = spyPrices[i - 1];
      const curr = spyPrices[i];
      if (prev.close && curr.close && prev.close > 0) {
        spyReturns.push((curr.close - prev.close) / prev.close);
      }
    }

    // Use SPY date calendar so portfolio returns align with SPY returns for Beta calculation
    const portfolioReturns = computePortfolioReturns(histories, spyDates);
    const { beta, alpha_annual, r_squared } = calcBetaAlpha(portfolioReturns, spyReturns);

    // Concentration metrics
    const sorted = [...activeHoldings].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const top3Weight = sorted.slice(0, 3).reduce((s, h) => s + (h.value ?? 0) / totalValue, 0);
    const hhi = activeHoldings.reduce((s, h) => s + Math.pow((h.value ?? 0) / totalValue, 2), 0);
    const marketCount = new Set(activeHoldings.map(h => h.market)).size;

    // Win/loss from current unrealized P&L
    const withPct = activeHoldings.filter(h => h.unrealized_pl_pct !== null);
    const winners = withPct.filter(h => (h.unrealized_pl_pct ?? 0) > 0);
    const losers = withPct.filter(h => (h.unrealized_pl_pct ?? 0) < 0);
    const winRate = withPct.length > 0 ? winners.length / withPct.length : null;
    const avgWinPct = winners.length > 0 ? winners.reduce((s, h) => s + (h.unrealized_pl_pct ?? 0), 0) / winners.length : null;
    const avgLossPct = losers.length > 0 ? losers.reduce((s, h) => s + (h.unrealized_pl_pct ?? 0), 0) / losers.length : null;

    const metrics: AnalyticsMetrics = {
      sharpe_ratio: calcSharpe(portfolioReturns),
      sortino_ratio: calcSortino(portfolioReturns),
      volatility_annual: calcVolatility(portfolioReturns),
      max_drawdown: calcMaxDrawdown(portfolioReturns),
      win_rate: winRate,
      avg_win_pct: avgWinPct,
      avg_loss_pct: avgLossPct,
      concentration_top3: top3Weight,
      concentration_hhi: hhi,
      market_count: marketCount,
      data_months: portfolioReturns.length > 0 ? Math.round(portfolioReturns.length / 21) : 0,
      beta,
      alpha_annual,
      r_squared,
    };

    res.json({ success: true, data: { score: calcScore(metrics, profile), metrics, flags: buildFlags(metrics), scoring_profile: profile } });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    console.error('getAnalytics error:', err);
    res.status(500).json({ success: false, error: 'Failed to compute analytics' });
  }
};
