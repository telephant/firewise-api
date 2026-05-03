# Portfolio Analytics & Scoring Design

**Date:** 2026-05-03
**Status:** Approved

---

## Overview

Add a portfolio analytics panel to the Distribution tab. The panel shows a comprehensive score (A/B/C/D) and quantitative metrics to help long-term investors understand their portfolio's health — covering return quality, risk, diversification, and win/loss quality. Users can switch between scoring profiles (lenient / moderate / strict).

---

## Scope

**In scope:**
- New backend endpoint: `GET /api/portfolios/:id/analytics?profile=moderate`
- Frontend analytics panel on the right side of the Distribution tab
- Scoring profile selector (lenient / moderate / strict)
- Front-end 1-day cache keyed by `portfolioId + date`
- Warning flags for actionable issues

**Out of scope:**
- Persisting analytics to the database
- Historical score tracking over time
- Per-holding drill-down analytics
- Benchmark comparison (e.g., vs S&P 500)

---

## Backend

### Endpoint

```
GET /api/portfolios/:id/analytics?profile=moderate
```

Authentication: same as other portfolio endpoints (belong_id check).

### Calculation Method

1. Fetch all holdings for the portfolio
2. For each holding ticker, fetch 12 months of monthly closing prices via yfinance
3. Compute monthly return series for each ticker
4. Compute weighted portfolio return series (weight = holding value / total value)
5. Calculate all metrics from the portfolio return series + current holdings snapshot

**Handling missing price data:** If a ticker has no yfinance data (e.g., commodities with non-standard tickers), exclude it from return-based metrics but still include it in concentration metrics. If fewer than 3 months of data are available across all holdings, return `data_months: 0` and skip Sharpe/Sortino/volatility/max_drawdown (set to `null`).

### Response Shape

```typescript
interface AnalyticsResponse {
  score: {
    total: number;        // 0–100
    level: 'A' | 'B' | 'C' | 'D';
    return_quality: number;    // 0–100 sub-score
    risk_control: number;      // 0–100 sub-score
    diversification: number;   // 0–100 sub-score
    win_loss_quality: number;  // 0–100 sub-score
  };
  metrics: {
    sharpe_ratio: number | null;
    sortino_ratio: number | null;
    volatility_annual: number | null;   // annualised stddev of monthly returns
    max_drawdown: number | null;        // negative number, e.g. -0.143
    win_rate: number | null;            // fraction of holdings with unrealized_pl > 0
    avg_win_pct: number | null;         // average unrealized_pl_pct of winners
    avg_loss_pct: number | null;        // average unrealized_pl_pct of losers
    concentration_top3: number;         // top 3 holdings weight fraction
    concentration_hhi: number;          // Herfindahl–Hirschman Index 0–1
    market_count: number;               // number of distinct markets
    data_months: number;                // months of price history available
  };
  flags: Array<{
    type: 'warning' | 'info';
    message: string;
  }>;
  scoring_profile: 'lenient' | 'moderate' | 'strict';
}
```

### Scoring Logic

**Scoring profiles** adjust thresholds — the same metric scores differently under each profile.

**Return Quality (30% weight):**
- Sharpe ≥ 1.5 → 100, ≥ 1.0 → 80, ≥ 0.5 → 60, ≥ 0 → 40, < 0 → 20
- Sortino ≥ 2.0 → 100, ≥ 1.5 → 80, ≥ 1.0 → 60, ≥ 0 → 40, < 0 → 20
- Average of both. If null (insufficient data), use 50 as neutral placeholder.

**Risk Control (30% weight):**
- Volatility (annual): ≤ 10% → 100, ≤ 15% → 80, ≤ 20% → 60, ≤ 30% → 40, > 30% → 20
- Max Drawdown: ≥ -5% → 100, ≥ -10% → 80, ≥ -20% → 60, ≥ -30% → 40, < -30% → 20
- Average of both. If null, use 50.

**Diversification (25% weight):**
- HHI: ≤ 0.10 → 100, ≤ 0.15 → 80, ≤ 0.25 → 60, ≤ 0.40 → 40, > 0.40 → 20
- Market count: ≥ 3 → 100, = 2 → 70, = 1 → 40
- Top3 weight: ≤ 40% → 100, ≤ 50% → 80, ≤ 60% → 60, ≤ 75% → 40, > 75% → 20
- Average of three.

**Win/Loss Quality (15% weight):**
- Win rate: ≥ 70% → 100, ≥ 60% → 80, ≥ 50% → 60, ≥ 40% → 40, < 40% → 20
- Profit factor (avg_win / |avg_loss|): ≥ 3x → 100, ≥ 2x → 80, ≥ 1.5x → 60, ≥ 1x → 40, < 1x → 20
- Average of both. If no losers, profit factor = 100.

**Profile multipliers on thresholds:**
- `lenient`: thresholds relaxed by ~20% (e.g., Sharpe ≥ 0.8 scores 100 instead of 1.5)
- `strict`: thresholds tightened by ~20% (e.g., Sharpe ≥ 2.0 scores 100)

**Score levels:**
- A: 85–100
- B: 70–84
- C: 55–69
- D: 0–54

### Flag Rules (profile-independent)

- `warning` if `concentration_top3 > 0.60`: "Top 3 holdings exceed 60% of portfolio"
- `warning` if `market_count === 1`: "All holdings in a single market"
- `warning` if `max_drawdown !== null && max_drawdown < -0.25`: "Portfolio has experienced a drawdown > 25%"
- `info` if `data_months < 6`: "Limited price history — some metrics may be less accurate"
- `info` if `win_rate !== null && win_rate < 0.40`: "Less than 40% of holdings are profitable"

---

## Frontend

### Layout: Distribution Tab

Split into left (treemap) and right (analytics panel) columns:

```
┌──────────────────────────┬─────────────────┐
│                          │                 │
│   Treemap (65% width)    │  Analytics      │
│                          │  Panel (35%)    │
│                          │                 │
└──────────────────────────┴─────────────────┘
```

Both columns fill the full available height (no scroll on distribution tab).

### Analytics Panel

**Header row:** Score badge (A/B/C/D with color) + numeric score + profile selector dropdown (lenient / moderate / strict) aligned right.

Score badge colors:
- A → `colors.positive`
- B → `colors.info`
- C → `colors.warning`
- D → `colors.negative`

**Metric groups** (separated by subtle dividers):

```
Return Quality          [sub-score /100]
  Sharpe Ratio          1.24
  Sortino Ratio         1.61

Risk Control            [sub-score /100]
  Annual Volatility     18.2%
  Max Drawdown         -14.3%

Diversification         [sub-score /100]
  Concentration (Top3)  61%  ⚠
  HHI                   0.18
  Markets               2

Win/Loss Quality        [sub-score /100]
  Win Rate              67%
  Profit Factor         2.2x
```

**Flags section** at bottom: each flag on its own line, warning in `colors.warning`, info in `colors.muted`.

**Loading state:** Show `<Loader size="sm" variant="dots" />` while fetching.

**Null metrics:** Show `—` when a metric is null (insufficient data).

### Front-end Cache

```typescript
// Key: `analytics-${portfolioId}-${YYYY-MM-DD}`
// Storage: localStorage
// TTL: expires at end of calendar day (compare stored date to today)
```

On tab load:
1. Check localStorage for key matching today's date
2. If found, use cached data — no API call
3. If not found, fetch from API, store result with today's date as key
4. On profile change, re-fetch (profile is passed as query param, not part of cache key — cache is per-profile, key includes profile: `analytics-${portfolioId}-${profile}-${date}`)

### New Component

`src/components/fire/portfolio-analytics-panel.tsx`

```tsx
interface Props {
  portfolioId: string;
}
```

Handles its own data fetching and caching internally. Exported and used directly in the Distribution tab.

---

## File Changes

**Backend (firewise-api):**
- Create: `src/controllers/analytics.controller.ts`
- Modify: `src/routes/portfolio.routes.ts` — add `GET /:id/analytics`

**Frontend (firewise-web):**
- Create: `src/components/fire/portfolio-analytics-panel.tsx`
- Create: `src/lib/fire/analytics-cache.ts` — localStorage cache helpers
- Modify: `src/lib/fire/api.ts` — add `portfolioAnalyticsApi.get(id, profile)`
- Modify: `src/app/(fire)/fire/portfolios/[id]/page.tsx` — split Distribution tab into left/right layout
