# Portfolio Analytics & Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a portfolio analytics panel to the Distribution tab that scores a portfolio A–D across return quality, risk, diversification, and win/loss quality, with a 1-day frontend cache.

**Architecture:** Backend adds `GET /portfolios/:id/analytics?profile=moderate` — fetches 12 months of monthly price history from the findata microservice, computes weighted portfolio return series, calculates metrics (Sharpe, Sortino, volatility, max drawdown, HHI, etc.), and returns a score + flags. Frontend adds a `PortfolioAnalyticsPanel` component that handles its own fetch + localStorage cache, and the Distribution tab splits into treemap (65%) + panel (35%).

**Tech Stack:** TypeScript/Express (backend), Next.js/React (frontend), firewise-findata microservice (yfinance history via `GET /stock/history/{ticker}?period=1y&interval=1mo`), localStorage for 1-day cache.

---

## File Structure

**Backend (firewise-api):**
- Create: `src/controllers/analytics.controller.ts` — all calculation logic + endpoint handler
- Modify: `src/routes/portfolio.routes.ts` — add `GET /:id/analytics`
- Modify: `src/routes/index.ts` — mount analytics route under `/portfolios`

**Frontend (firewise-web):**
- Modify: `src/lib/fire/api.ts` — add `AnalyticsResponse` type + `portfolioAnalyticsApi`
- Create: `src/components/fire/portfolio-analytics-panel.tsx` — panel component with fetch + cache
- Modify: `src/app/(fire)/fire/portfolios/[id]/page.tsx` — split Distribution tab layout

---

## Task 1: Backend — Analytics Controller

**Files:**
- Create: `src/controllers/analytics.controller.ts`

- [ ] **Step 1: Create the file with types and helpers**

```typescript
// src/controllers/analytics.controller.ts
import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { AppError } from '../middleware/error';
import { getViewContext } from '../utils/family-context';

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
```

- [ ] **Step 2: Add the findata history fetch helper**

Append to `src/controllers/analytics.controller.ts`:

```typescript
async function fetchMonthlyHistory(ticker: string, market: string): Promise<MonthlyPrice[]> {
  // Commodities (COMMODITY market) use non-standard tickers — skip them
  if (market === 'COMMODITY') return [];

  // Map market to yfinance suffix
  let yticker = ticker;
  if (market === 'SGX') yticker = `${ticker}.SI`;
  else if (market === 'HK') yticker = `${ticker}.HK`;
  else if (market === 'CN') yticker = `${ticker}.SS`;
  // US market: no suffix

  try {
    const url = `${FINDATA_BASE_URL}/stock/history/${encodeURIComponent(yticker)}?period=1y&interval=1mo`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json() as { prices: { date: string; close: number | null }[] };
    return data.prices ?? [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 3: Add portfolio return series computation**

Append to `src/controllers/analytics.controller.ts`:

```typescript
function computePortfolioReturns(
  histories: { weight: number; prices: MonthlyPrice[] }[]
): number[] {
  if (histories.length === 0) return [];

  // Find common date range — use dates from the first non-empty history
  const reference = histories.find(h => h.prices.length >= 3);
  if (!reference) return [];

  const dates = reference.prices
    .filter(p => p.close !== null)
    .map(p => p.date)
    .slice(-13); // up to 13 months → 12 return periods

  const returns: number[] = [];

  for (let i = 1; i < dates.length; i++) {
    let portfolioReturn = 0;
    let weightUsed = 0;

    for (const { weight, prices } of histories) {
      const prev = prices.find(p => p.date === dates[i - 1]);
      const curr = prices.find(p => p.date === dates[i]);
      if (prev?.close && curr?.close && prev.close > 0) {
        portfolioReturn += weight * ((curr.close - prev.close) / prev.close);
        weightUsed += weight;
      }
    }

    // Normalise by actual weight coverage (handles missing tickers gracefully)
    if (weightUsed > 0.1) {
      returns.push(portfolioReturn / weightUsed);
    }
  }

  return returns;
}
```

- [ ] **Step 4: Add metric calculation functions**

Append to `src/controllers/analytics.controller.ts`:

```typescript
const RISK_FREE_MONTHLY = 0.04 / 12; // 4% annual risk-free rate

function calcSharpe(returns: number[]): number | null {
  if (returns.length < 3) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + Math.pow(r - mean, 2), 0) / returns.length;
  const stddev = Math.sqrt(variance);
  if (stddev === 0) return null;
  return ((mean - RISK_FREE_MONTHLY) / stddev) * Math.sqrt(12); // annualise
}

function calcSortino(returns: number[]): number | null {
  if (returns.length < 3) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const downside = returns.filter(r => r < RISK_FREE_MONTHLY);
  if (downside.length === 0) return null;
  const downVariance = downside.reduce((a, r) => a + Math.pow(r - RISK_FREE_MONTHLY, 2), 0) / returns.length;
  const downStd = Math.sqrt(downVariance);
  if (downStd === 0) return null;
  return ((mean - RISK_FREE_MONTHLY) / downStd) * Math.sqrt(12);
}

function calcVolatility(returns: number[]): number | null {
  if (returns.length < 3) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + Math.pow(r - mean, 2), 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(12); // annualise
}

function calcMaxDrawdown(returns: number[]): number | null {
  if (returns.length < 2) return null;
  let peak = 1;
  let value = 1;
  let maxDD = 0;
  for (const r of returns) {
    value *= 1 + r;
    if (value > peak) peak = value;
    const dd = (value - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }
  return maxDD;
}

function scoreMetric(value: number | null, thresholds: [number, number][], nullScore = 50): number {
  if (value === null) return nullScore;
  for (const [threshold, score] of thresholds) {
    if (value >= threshold) return score;
  }
  return thresholds[thresholds.length - 1][1];
}

function getThresholds(profile: ScoringProfile): {
  sharpe: [number, number][];
  sortino: [number, number][];
  volatility: [number, number][];
  maxDrawdown: [number, number][];
  hhi: [number, number][];
  top3: [number, number][];
  winRate: [number, number][];
  profitFactor: [number, number][];
} {
  const m = profile === 'lenient' ? 0.8 : profile === 'strict' ? 1.2 : 1.0;
  return {
    sharpe:       [[1.5 / m, 100], [1.0 / m, 80], [0.5 / m, 60], [0, 40]],
    sortino:      [[2.0 / m, 100], [1.5 / m, 80], [1.0 / m, 60], [0, 40]],
    volatility:   [[-0.10 * m, 100], [-0.15 * m, 80], [-0.20 * m, 60], [-0.30 * m, 40]], // negated for >=
    maxDrawdown:  [[-0.05 * m, 100], [-0.10 * m, 80], [-0.20 * m, 60], [-0.30 * m, 40]],
    hhi:          [[-0.10 * m, 100], [-0.15 * m, 80], [-0.25 * m, 60], [-0.40 * m, 40]],
    top3:         [[-0.40 * m, 100], [-0.50 * m, 80], [-0.60 * m, 60], [-0.75 * m, 40]],
    winRate:      [[0.70 * m, 100], [0.60 * m, 80], [0.50 * m, 60], [0.40 * m, 40]],
    profitFactor: [[3.0 / m, 100], [2.0 / m, 80], [1.5 / m, 60], [1.0 / m, 40]],
  };
}

// Note: volatility, maxDrawdown, hhi, top3 use negated values so scoreMetric works with >= comparisons
function calcScore(metrics: AnalyticsMetrics, profile: ScoringProfile): AnalyticsScore {
  const t = getThresholds(profile);

  const returnQuality = Math.round(
    (scoreMetric(metrics.sharpe_ratio, t.sharpe) + scoreMetric(metrics.sortino_ratio, t.sortino)) / 2
  );

  const riskControl = Math.round(
    (scoreMetric(metrics.volatility_annual !== null ? -metrics.volatility_annual : null, t.volatility) +
     scoreMetric(metrics.max_drawdown, t.maxDrawdown)) / 2
  );

  const marketScore = metrics.market_count >= 3 ? 100 : metrics.market_count === 2 ? 70 : 40;
  const diversification = Math.round(
    (scoreMetric(-metrics.concentration_hhi, t.hhi) +
     marketScore +
     scoreMetric(-metrics.concentration_top3, t.top3)) / 3
  );

  const profitFactor = metrics.avg_loss_pct !== null && metrics.avg_loss_pct !== 0 && metrics.avg_win_pct !== null
    ? metrics.avg_win_pct / Math.abs(metrics.avg_loss_pct)
    : metrics.avg_win_pct !== null ? 3 : null; // no losers → max factor

  const winLossQuality = Math.round(
    (scoreMetric(metrics.win_rate, t.winRate) + scoreMetric(profitFactor, t.profitFactor)) / 2
  );

  const total = Math.round(
    returnQuality * 0.30 +
    riskControl * 0.30 +
    diversification * 0.25 +
    winLossQuality * 0.15
  );

  const level: 'A' | 'B' | 'C' | 'D' =
    total >= 85 ? 'A' : total >= 70 ? 'B' : total >= 55 ? 'C' : 'D';

  return { total, level, return_quality: returnQuality, risk_control: riskControl, diversification, win_loss_quality: winLossQuality };
}

function buildFlags(metrics: AnalyticsMetrics): AnalyticsFlag[] {
  const flags: AnalyticsFlag[] = [];
  if (metrics.concentration_top3 > 0.60) flags.push({ type: 'warning', message: 'Top 3 holdings exceed 60% of portfolio' });
  if (metrics.market_count === 1) flags.push({ type: 'warning', message: 'All holdings in a single market' });
  if (metrics.max_drawdown !== null && metrics.max_drawdown < -0.25) flags.push({ type: 'warning', message: 'Portfolio has experienced a drawdown > 25%' });
  if (metrics.data_months < 6) flags.push({ type: 'info', message: 'Limited price history — some metrics may be less accurate' });
  if (metrics.win_rate !== null && metrics.win_rate < 0.40) flags.push({ type: 'info', message: 'Less than 40% of holdings are profitable' });
  return flags;
}
```

- [ ] **Step 5: Add the main controller export**

Append to `src/controllers/analytics.controller.ts`:

```typescript
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

    // Fetch holdings
    const { data: holdings } = await supabaseAdmin
      .from('holdings_view')
      .select('ticker, market, value, unrealized_pl, unrealized_pl_pct')
      .eq('portfolio_id', portfolioId);

    const activeHoldings = (holdings ?? []).filter(h => h.value !== null && h.value > 0);

    if (activeHoldings.length === 0) {
      const emptyMetrics: AnalyticsMetrics = {
        sharpe_ratio: null, sortino_ratio: null, volatility_annual: null, max_drawdown: null,
        win_rate: null, avg_win_pct: null, avg_loss_pct: null,
        concentration_top3: 0, concentration_hhi: 0, market_count: 0, data_months: 0,
      };
      res.json({ success: true, data: {
        score: calcScore(emptyMetrics, profile),
        metrics: emptyMetrics,
        flags: [],
        scoring_profile: profile,
      }});
      return;
    }

    const totalValue = activeHoldings.reduce((s, h) => s + (h.value ?? 0), 0);

    // Fetch price histories in parallel
    const histories = await Promise.all(
      activeHoldings.map(async h => ({
        weight: (h.value ?? 0) / totalValue,
        prices: await fetchMonthlyHistory(h.ticker, h.market),
      }))
    );

    const portfolioReturns = computePortfolioReturns(histories);

    // Concentration metrics (use all holdings including commodities)
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
      data_months: portfolioReturns.length,
    };

    const score = calcScore(metrics, profile);
    const flags = buildFlags(metrics);

    res.json({ success: true, data: { score, metrics, flags, scoring_profile: profile } });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    console.error('getAnalytics error:', err);
    res.status(500).json({ success: false, error: 'Failed to compute analytics' });
  }
};
```

- [ ] **Step 6: Check what view/table holdings come from**

The controller uses `holdings_view`. Verify it exists:

```bash
cd /Users/telephant/projects/firewise/firewise-api
grep -r "holdings_view\|from('holdings'" src/controllers/ | head -20
```

If the existing holdings controller uses a different table name, update the `from(...)` call in Step 5 to match.

- [ ] **Step 7: Commit**

```bash
cd /Users/telephant/projects/firewise/firewise-api
git add src/controllers/analytics.controller.ts
git commit -m "feat: portfolio analytics controller with scoring"
```

---

## Task 2: Backend — Wire Route

**Files:**
- Modify: `src/routes/portfolio.routes.ts`
- Modify: `src/routes/index.ts`

- [ ] **Step 1: Add route to portfolio.routes.ts**

```typescript
// src/routes/portfolio.routes.ts
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  listPortfolios,
  createPortfolio,
  getPortfolio,
  updatePortfolio,
  deletePortfolio,
} from '../controllers/portfolio.controller';
import { getAnalytics } from '../controllers/analytics.controller';

const router = Router();

router.use(authMiddleware);

router.get('/', listPortfolios);
router.post('/', createPortfolio);
router.get('/:id', getPortfolio);
router.put('/:id', updatePortfolio);
router.delete('/:id', deletePortfolio);
router.get('/:id/analytics', getAnalytics);

export default router;
```

- [ ] **Step 2: Verify route is already mounted in index.ts**

Check `src/routes/index.ts` — line `router.use('/portfolios', portfolioRoutes);` already exists (line 94). No change needed to index.ts.

- [ ] **Step 3: Test the endpoint manually**

Start the API server:
```bash
cd /Users/telephant/projects/firewise/firewise-api
npm run dev
```

In another terminal, get an auth token from the running frontend session (check localStorage `sb-*` key for access_token) and test:
```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3001/api/portfolios/<portfolio-id>/analytics?profile=moderate"
```

Expected: `{ "success": true, "data": { "score": {...}, "metrics": {...}, "flags": [...], "scoring_profile": "moderate" } }`

- [ ] **Step 4: Commit**

```bash
cd /Users/telephant/projects/firewise/firewise-api
git add src/routes/portfolio.routes.ts
git commit -m "feat: wire GET /portfolios/:id/analytics route"
```

---

## Task 3: Frontend — API Type + Client

**Files:**
- Modify: `src/lib/fire/api.ts`

- [ ] **Step 1: Add AnalyticsResponse type to api.ts**

After the `PortfolioStats` interface (around line 92), add:

```typescript
export type ScoringProfile = 'lenient' | 'moderate' | 'strict';

export interface AnalyticsScore {
  total: number;
  level: 'A' | 'B' | 'C' | 'D';
  return_quality: number;
  risk_control: number;
  diversification: number;
  win_loss_quality: number;
}

export interface AnalyticsMetrics {
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
}

export interface AnalyticsFlag {
  type: 'warning' | 'info';
  message: string;
}

export interface PortfolioAnalytics {
  score: AnalyticsScore;
  metrics: AnalyticsMetrics;
  flags: AnalyticsFlag[];
  scoring_profile: ScoringProfile;
}
```

- [ ] **Step 2: Add portfolioAnalyticsApi to api.ts**

After the `portfolioApi` block, add:

```typescript
export const portfolioAnalyticsApi = {
  get: (id: string, profile: ScoringProfile = 'moderate') =>
    fetchApi<PortfolioAnalytics>(`/portfolios/${id}/analytics?profile=${profile}`),
};
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/telephant/projects/firewise/firewise-web
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/telephant/projects/firewise/firewise-web
git add src/lib/fire/api.ts
git commit -m "feat: add PortfolioAnalytics types and portfolioAnalyticsApi"
```

---

## Task 4: Frontend — Analytics Cache Helper

**Files:**
- Create: `src/lib/fire/analytics-cache.ts`

- [ ] **Step 1: Create the cache module**

```typescript
// src/lib/fire/analytics-cache.ts
import type { PortfolioAnalytics, ScoringProfile } from './api';

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function cacheKey(portfolioId: string, profile: ScoringProfile): string {
  return `analytics-${portfolioId}-${profile}-${todayKey()}`;
}

export function getCachedAnalytics(portfolioId: string, profile: ScoringProfile): PortfolioAnalytics | null {
  try {
    const raw = localStorage.getItem(cacheKey(portfolioId, profile));
    if (!raw) return null;
    return JSON.parse(raw) as PortfolioAnalytics;
  } catch {
    return null;
  }
}

export function setCachedAnalytics(portfolioId: string, profile: ScoringProfile, data: PortfolioAnalytics): void {
  try {
    // Prune stale entries for this portfolio (different dates or profiles)
    const prefix = `analytics-${portfolioId}-`;
    const today = todayKey();
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(prefix) && !key.endsWith(today)) {
        localStorage.removeItem(key);
      }
    }
    localStorage.setItem(cacheKey(portfolioId, profile), JSON.stringify(data));
  } catch {
    // localStorage unavailable (SSR or quota) — silently skip
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/telephant/projects/firewise/firewise-web
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/telephant/projects/firewise/firewise-web
git add src/lib/fire/analytics-cache.ts
git commit -m "feat: analytics localStorage cache with 1-day TTL"
```

---

## Task 5: Frontend — Analytics Panel Component

**Files:**
- Create: `src/components/fire/portfolio-analytics-panel.tsx`

- [ ] **Step 1: Create the component**

```typescript
// src/components/fire/portfolio-analytics-panel.tsx
'use client';

import { useState, useEffect } from 'react';
import { colors, Loader } from '@/components/fire/ui';
import { portfolioAnalyticsApi } from '@/lib/fire/api';
import type { PortfolioAnalytics, ScoringProfile } from '@/lib/fire/api';
import { getCachedAnalytics, setCachedAnalytics } from '@/lib/fire/analytics-cache';

interface Props {
  portfolioId: string;
}

const SCORE_COLORS: Record<string, string> = {
  A: colors.positive,
  B: colors.info,
  C: colors.warning,
  D: colors.negative,
};

function fmt(value: number | null, decimals = 2): string {
  if (value === null) return '—';
  return value.toFixed(decimals);
}

function fmtPct(value: number | null): string {
  if (value === null) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function fmtPctSigned(value: number | null): string {
  if (value === null) return '—';
  const p = (value * 100).toFixed(1);
  return value >= 0 ? `+${p}%` : `${p}%`;
}

function SubScore({ label, score }: { label: string; score: number }) {
  const color = score >= 70 ? colors.positive : score >= 55 ? colors.warning : colors.negative;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
      <span style={{ color: colors.text, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </span>
      <span style={{ color, fontSize: 11, fontWeight: 600 }}>{score}</span>
    </div>
  );
}

function MetricRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
      <span style={{ color: colors.muted, fontSize: 11 }}>{label}</span>
      <span style={{ color: valueColor ?? colors.text, fontSize: 12, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, backgroundColor: colors.border, margin: '8px 0' }} />;
}

export function PortfolioAnalyticsPanel({ portfolioId }: Props) {
  const [analytics, setAnalytics] = useState<PortfolioAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ScoringProfile>('moderate');

  useEffect(() => {
    setLoading(true);
    const cached = getCachedAnalytics(portfolioId, profile);
    if (cached) {
      setAnalytics(cached);
      setLoading(false);
      return;
    }
    portfolioAnalyticsApi.get(portfolioId, profile).then(res => {
      if (res.success && res.data) {
        setCachedAnalytics(portfolioId, profile, res.data);
        setAnalytics(res.data);
      }
      setLoading(false);
    });
  }, [portfolioId, profile]);

  return (
    <div style={{
      width: '100%',
      height: '100%',
      backgroundColor: colors.surface,
      borderRadius: 8,
      border: `1px solid ${colors.border}`,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'auto',
    }}>
      {/* Header: score badge + profile selector */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexShrink: 0 }}>
        {loading || !analytics ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Loader size="sm" variant="dots" />
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              backgroundColor: `${SCORE_COLORS[analytics.score.level]}20`,
              border: `1px solid ${SCORE_COLORS[analytics.score.level]}50`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: SCORE_COLORS[analytics.score.level],
              fontSize: 18, fontWeight: 700,
            }}>
              {analytics.score.level}
            </div>
            <div>
              <div style={{ color: colors.text, fontSize: 20, fontWeight: 700, lineHeight: 1 }}>
                {analytics.score.total}
              </div>
              <div style={{ color: colors.muted, fontSize: 10, marginTop: 2 }}>/ 100</div>
            </div>
          </div>
        )}

        {/* Profile selector */}
        <select
          value={profile}
          onChange={e => setProfile(e.target.value as ScoringProfile)}
          style={{
            backgroundColor: colors.surfaceLight,
            color: colors.muted,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            padding: '4px 8px',
            fontSize: 11,
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          <option value="lenient">Lenient</option>
          <option value="moderate">Moderate</option>
          <option value="strict">Strict</option>
        </select>
      </div>

      {loading && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Loader size="md" variant="bar" />
        </div>
      )}

      {!loading && analytics && (
        <>
          {/* Return Quality */}
          <SubScore label="Return Quality" score={analytics.score.return_quality} />
          <MetricRow label="Sharpe Ratio" value={fmt(analytics.metrics.sharpe_ratio)} />
          <MetricRow label="Sortino Ratio" value={fmt(analytics.metrics.sortino_ratio)} />

          <Divider />

          {/* Risk Control */}
          <SubScore label="Risk Control" score={analytics.score.risk_control} />
          <MetricRow label="Annual Volatility" value={fmtPct(analytics.metrics.volatility_annual)} />
          <MetricRow
            label="Max Drawdown"
            value={fmtPctSigned(analytics.metrics.max_drawdown)}
            valueColor={analytics.metrics.max_drawdown !== null && analytics.metrics.max_drawdown < -0.15 ? colors.negative : undefined}
          />

          <Divider />

          {/* Diversification */}
          <SubScore label="Diversification" score={analytics.score.diversification} />
          <MetricRow
            label="Top 3 Concentration"
            value={fmtPct(analytics.metrics.concentration_top3)}
            valueColor={analytics.metrics.concentration_top3 > 0.60 ? colors.warning : undefined}
          />
          <MetricRow label="HHI" value={fmt(analytics.metrics.concentration_hhi)} />
          <MetricRow label="Markets" value={String(analytics.metrics.market_count)} />

          <Divider />

          {/* Win/Loss Quality */}
          <SubScore label="Win/Loss Quality" score={analytics.score.win_loss_quality} />
          <MetricRow
            label="Win Rate"
            value={analytics.metrics.win_rate !== null ? `${(analytics.metrics.win_rate * 100).toFixed(0)}%` : '—'}
          />
          <MetricRow
            label="Avg Win"
            value={analytics.metrics.avg_win_pct !== null ? `+${analytics.metrics.avg_win_pct.toFixed(1)}%` : '—'}
            valueColor={colors.positive}
          />
          <MetricRow
            label="Avg Loss"
            value={analytics.metrics.avg_loss_pct !== null ? `${analytics.metrics.avg_loss_pct.toFixed(1)}%` : '—'}
            valueColor={analytics.metrics.avg_loss_pct !== null ? colors.negative : undefined}
          />

          {/* Flags */}
          {analytics.flags.length > 0 && (
            <>
              <Divider />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {analytics.flags.map((flag, i) => (
                  <div key={i} style={{
                    fontSize: 11,
                    color: flag.type === 'warning' ? colors.warning : colors.muted,
                    display: 'flex', alignItems: 'flex-start', gap: 5,
                  }}>
                    <span style={{ flexShrink: 0 }}>{flag.type === 'warning' ? '⚠' : 'ℹ'}</span>
                    <span>{flag.message}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Data footnote */}
          {analytics.metrics.data_months > 0 && (
            <div style={{ marginTop: 'auto', paddingTop: 10, color: colors.muted, fontSize: 10 }}>
              Based on {analytics.metrics.data_months} months of data
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/telephant/projects/firewise/firewise-web
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/telephant/projects/firewise/firewise-web
git add src/components/fire/portfolio-analytics-panel.tsx
git commit -m "feat: PortfolioAnalyticsPanel component with score, metrics, flags"
```

---

## Task 6: Frontend — Split Distribution Tab Layout

**Files:**
- Modify: `src/app/(fire)/fire/portfolios/[id]/page.tsx`

- [ ] **Step 1: Add import for PortfolioAnalyticsPanel**

Near the top of the file, after the existing imports, add:

```typescript
import { PortfolioAnalyticsPanel } from '@/components/fire/portfolio-analytics-panel';
```

- [ ] **Step 2: Replace the Distribution TabsContent**

Find the current Distribution tab content:

```typescript
{/* Distribution Tab — fills height, no scroll */}
<TabsContent value="distribution" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', marginTop: 16 }}>
  <PortfolioTreemap
    holdings={holdings}
    currency={currency}
    totalValue={stats?.total_value ?? 0}
  />
</TabsContent>
```

Replace with:

```typescript
{/* Distribution Tab — fills height, no scroll */}
<TabsContent value="distribution" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'row', gap: 12, marginTop: 16 }}>
  {/* Treemap — 65% width */}
  <div style={{ flex: '0 0 65%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
    <PortfolioTreemap
      holdings={holdings}
      currency={currency}
      totalValue={stats?.total_value ?? 0}
    />
  </div>
  {/* Analytics panel — 35% width */}
  <div style={{ flex: '0 0 calc(35% - 12px)', overflow: 'hidden' }}>
    {portfolio && <PortfolioAnalyticsPanel portfolioId={portfolio.id} />}
  </div>
</TabsContent>
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/telephant/projects/firewise/firewise-web
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Visual check**

Open the portfolio detail page in the browser. Verify:
- Distribution tab shows treemap on left (65%) and analytics panel on right (35%)
- Analytics panel shows loading state then score + metrics
- Profile selector works (changing it triggers a re-fetch)
- Switching away and back to Distribution tab uses cache (no loading flash the second time)

- [ ] **Step 5: Commit**

```bash
cd /Users/telephant/projects/firewise/firewise-web
git add src/app/\(fire\)/fire/portfolios/\[id\]/page.tsx
git commit -m "feat: split Distribution tab — treemap 65% + analytics panel 35%"
```
