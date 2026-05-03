# Portfolio Distribution Tab & Holdings Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a squarified treemap Distribution tab (default) to the portfolio detail page and paginate the Holdings tab at 20 rows per page.

**Architecture:** Two tasks — first build the standalone `PortfolioTreemap` SVG component with a squarified treemap algorithm, then wire it into the portfolio page alongside holdings pagination. No backend changes needed; all data is already in the `holdings` array.

**Tech Stack:** Next.js 14, React, TypeScript, inline SVG, fire UI design system (inline styles, `colors` from `@/components/fire/ui`)

---

## File Map

**Create:**
- `src/components/fire/portfolio-treemap.tsx` — pure SVG treemap component; squarify algorithm + tile rendering

**Modify:**
- `src/app/(fire)/fire/portfolios/[id]/page.tsx` — add Distribution tab, add `holdingsPage` state + pagination controls, change `defaultValue` to `"distribution"`, reorder tabs

---

## Task 1: PortfolioTreemap component

**Files:**
- Create: `src/components/fire/portfolio-treemap.tsx`

- [ ] **Step 1: Create the file with the squarify algorithm**

Create `/Users/telephant/projects/firewise/firewise-web/src/components/fire/portfolio-treemap.tsx` with this full content:

```tsx
'use client';

import { colors } from '@/components/fire/ui';
import { displayTicker } from '@/lib/fire/commodities';
import type { Holding } from '@/lib/fire/api';

// ── Squarified treemap ──────────────────────────────────────────────────────

interface TileInput {
  ticker: string;
  market: string;
  value: number;
  weight: number;        // 0–1
  pct: number | null;    // unrealized_pl_pct
}

interface TileRect extends TileInput {
  x: number;
  y: number;
  w: number;
  h: number;
}

function worst(row: number[], w: number, s: number): number {
  const rMin = Math.min(...row);
  const rMax = Math.max(...row);
  const rSum = row.reduce((a, b) => a + b, 0);
  return Math.max((w * w * rMax) / (s * s), (s * s) / (w * w * rMin));
}

function squarify(
  items: TileInput[],
  x: number,
  y: number,
  width: number,
  height: number
): TileRect[] {
  if (items.length === 0) return [];

  const totalArea = width * height;
  const totalValue = items.reduce((s, i) => s + i.value, 0);

  // Normalise values to fill the available area
  const areas = items.map(i => (i.value / totalValue) * totalArea);

  const result: TileRect[] = [];

  function layoutRow(
    row: number[],
    rowItems: TileInput[],
    rx: number,
    ry: number,
    rw: number,
    rh: number,
    horizontal: boolean
  ) {
    const rowSum = row.reduce((a, b) => a + b, 0);
    let offset = 0;
    row.forEach((area, idx) => {
      const frac = area / rowSum;
      let tx: number, ty: number, tw: number, th: number;
      if (horizontal) {
        tw = rw * frac;
        th = rh;
        tx = rx + offset;
        ty = ry;
        offset += tw;
      } else {
        tw = rw;
        th = rh * frac;
        tx = rx;
        ty = ry + offset;
        offset += th;
      }
      result.push({ ...rowItems[idx], x: tx, y: ty, w: tw, h: th });
    });
  }

  function squarifyRecursive(
    remaining: TileInput[],
    remainingAreas: number[],
    rx: number,
    ry: number,
    rw: number,
    rh: number
  ) {
    if (remaining.length === 0) return;
    if (remaining.length === 1) {
      result.push({ ...remaining[0], x: rx, y: ry, w: rw, h: rh });
      return;
    }

    const horizontal = rw >= rh;
    const w = horizontal ? rh : rw;
    let currentRow: number[] = [];
    let currentItems: TileInput[] = [];
    let i = 0;

    while (i < remaining.length) {
      const newRow = [...currentRow, remainingAreas[i]];
      const newSum = newRow.reduce((a, b) => a + b, 0);
      if (
        currentRow.length === 0 ||
        worst(newRow, w, newSum) <= worst(currentRow, w, newRow.reduce((a, b) => a + b, 0) - remainingAreas[i])
      ) {
        currentRow = newRow;
        currentItems = [...currentItems, remaining[i]];
        i++;
      } else {
        break;
      }
    }

    const rowSum = currentRow.reduce((a, b) => a + b, 0);
    const totalRect = rw * rh;
    const rowFrac = rowSum / totalRect;

    let newRx = rx, newRy = ry, newRw = rw, newRh = rh;
    if (horizontal) {
      const rowWidth = rw * rowFrac;
      layoutRow(currentRow, currentItems, rx, ry, rowWidth, rh, false);
      newRx = rx + rowWidth;
      newRw = rw - rowWidth;
    } else {
      const rowHeight = rh * rowFrac;
      layoutRow(currentRow, currentItems, rx, ry, rw, rowHeight, true);
      newRy = ry + rowHeight;
      newRh = rh - rowHeight;
    }

    squarifyRecursive(remaining.slice(i), remainingAreas.slice(i), newRx, newRy, newRw, newRh);
  }

  squarifyRecursive(items, areas, x, y, width, height);
  return result;
}

// ── Component ───────────────────────────────────────────────────────────────

interface Props {
  holdings: Holding[];
  currency: string;
  totalValue: number;
}

const W = 800;
const H = 420;
const GAP = 2;

function fmtValue(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    notation: value >= 1_000_000 ? 'compact' : 'standard',
  }).format(value);
}

export function PortfolioTreemap({ holdings, currency, totalValue }: Props) {
  const filtered = holdings
    .filter(h => h.value !== null && h.value > 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  if (filtered.length === 0 || totalValue <= 0) {
    return (
      <div style={{
        height: H,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: colors.muted,
        fontSize: 14,
      }}>
        No holdings with market value yet.
      </div>
    );
  }

  const inputs: TileInput[] = filtered.map(h => ({
    ticker: h.ticker,
    market: h.market,
    value: h.value!,
    weight: h.value! / totalValue,
    pct: h.unrealized_pl_pct ?? null,
  }));

  const tiles = squarify(inputs, 0, 0, W, H);

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      style={{ display: 'block', borderRadius: 8, overflow: 'hidden' }}
    >
      {tiles.map((tile) => {
        const x = tile.x + GAP / 2;
        const y = tile.y + GAP / 2;
        const w = tile.w - GAP;
        const h = tile.h - GAP;

        const isSmall = w < 40 || h < 40;
        const isTiny = w < 20 || h < 20;

        const pctVal = tile.pct;
        let bg: string;
        let border: string;
        let pctColor: string;
        if (pctVal === null) {
          bg = colors.surfaceLight;
          border = colors.border;
          pctColor = colors.muted;
        } else if (pctVal > 0) {
          bg = `${colors.positive}18`;
          border = `${colors.positive}40`;
          pctColor = colors.positive;
        } else if (pctVal < 0) {
          bg = `${colors.negative}18`;
          border = `${colors.negative}40`;
          pctColor = colors.negative;
        } else {
          bg = colors.surfaceLight;
          border = colors.border;
          pctColor = colors.muted;
        }

        const name = displayTicker(tile.ticker, tile.market);
        const weightStr = `${(tile.weight * 100).toFixed(1)}%`;
        const valueStr = fmtValue(tile.value, currency);
        const pctStr = pctVal !== null
          ? `${pctVal >= 0 ? '+' : ''}${pctVal.toFixed(2)}%`
          : null;

        // Text layout: center vertically in tile
        const lineHeight = 16;
        const lines = isTiny ? [] : isSmall ? 1 : pctStr ? 4 : 3;
        const totalTextH = typeof lines === 'number' ? lines * lineHeight : 0;
        const textStartY = y + h / 2 - totalTextH / 2 + lineHeight * 0.8;

        return (
          <g key={`${tile.ticker}-${tile.market}`}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill={bg}
              stroke={border}
              strokeWidth={1}
              rx={4}
            />
            {!isTiny && (
              <>
                {/* Ticker name */}
                <text
                  x={x + w / 2}
                  y={textStartY}
                  textAnchor="middle"
                  fill={colors.text}
                  fontSize={Math.min(13, w / (name.length * 0.6 + 1))}
                  fontWeight="600"
                  style={{ fontFamily: 'inherit' }}
                >
                  {name.length * 7 > w - 8
                    ? name.slice(0, Math.floor((w - 8) / 7)) + (name.length * 7 > w - 8 ? '…' : '')
                    : name}
                </text>

                {/* Value */}
                {!isSmall && (
                  <text
                    x={x + w / 2}
                    y={textStartY + lineHeight}
                    textAnchor="middle"
                    fill={colors.text}
                    fontSize={11}
                    style={{ fontFamily: 'inherit' }}
                  >
                    {valueStr}
                  </text>
                )}

                {/* Weight % */}
                {!isSmall && (
                  <text
                    x={x + w / 2}
                    y={textStartY + lineHeight * 2}
                    textAnchor="middle"
                    fill={colors.muted}
                    fontSize={11}
                    style={{ fontFamily: 'inherit' }}
                  >
                    {weightStr}
                  </text>
                )}

                {/* P&L % */}
                {!isSmall && pctStr && (
                  <text
                    x={x + w / 2}
                    y={textStartY + lineHeight * 3}
                    textAnchor="middle"
                    fill={pctColor}
                    fontSize={11}
                    fontWeight="500"
                    style={{ fontFamily: 'inherit' }}
                  >
                    {pctStr}
                  </text>
                )}
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/telephant/projects/firewise/firewise-web
git add src/components/fire/portfolio-treemap.tsx
git commit -m "feat: add PortfolioTreemap squarified SVG component"
```

---

## Task 2: Wire into portfolio page — Distribution tab + pagination

**Files:**
- Modify: `src/app/(fire)/fire/portfolios/[id]/page.tsx`

- [ ] **Step 1: Read the current page to understand existing state and tab structure**

Read `/Users/telephant/projects/firewise/firewise-web/src/app/(fire)/fire/portfolios/[id]/page.tsx` (already at ~550 lines). Note:
- Tabs component at line 165: `<Tabs defaultValue="holdings" ...>`
- TabsTrigger order: holdings, dividends, pl, stats, dca
- Holdings table starts around line 175

- [ ] **Step 2: Add import + holdingsPage state**

At the top of the file, add the import for `PortfolioTreemap`:

```tsx
import { PortfolioTreemap } from '@/components/fire/portfolio-treemap';
```

Inside the component, after the existing state declarations, add:

```tsx
const [holdingsPage, setHoldingsPage] = useState(0);
const HOLDINGS_PAGE_SIZE = 20;
```

Also add a `useEffect` to reset page when holdings change (add after the existing data-fetch `useEffect`):

```tsx
useEffect(() => {
  setHoldingsPage(0);
}, [holdings]);
```

- [ ] **Step 3: Change defaultValue and add Distribution tab trigger**

Find:
```tsx
<Tabs defaultValue="holdings" onValueChange={(v) => { if (v === 'pl') handlePlTabActivate(); }}>
  <TabsList>
    <TabsTrigger value="holdings">Holdings</TabsTrigger>
    <TabsTrigger value="dividends">Dividends</TabsTrigger>
    <TabsTrigger value="pl">P&amp;L</TabsTrigger>
    <TabsTrigger value="stats">Stats</TabsTrigger>
    <TabsTrigger value="dca">DCA {dcaPending.length > 0 && `(${dcaPending.length})`}</TabsTrigger>
  </TabsList>
```

Replace with:
```tsx
<Tabs defaultValue="distribution" onValueChange={(v) => { if (v === 'pl') handlePlTabActivate(); }}>
  <TabsList>
    <TabsTrigger value="distribution">Distribution</TabsTrigger>
    <TabsTrigger value="holdings">Holdings</TabsTrigger>
    <TabsTrigger value="dividends">Dividends</TabsTrigger>
    <TabsTrigger value="pl">P&amp;L</TabsTrigger>
    <TabsTrigger value="stats">Stats</TabsTrigger>
    <TabsTrigger value="dca">DCA {dcaPending.length > 0 && `(${dcaPending.length})`}</TabsTrigger>
  </TabsList>
```

- [ ] **Step 4: Add Distribution TabsContent before the Holdings TabsContent**

Find the line:
```tsx
        {/* Holdings Tab */}
        <TabsContent value="holdings">
```

Insert before it:

```tsx
        {/* Distribution Tab */}
        <TabsContent value="distribution">
          <div style={{ marginTop: 16 }}>
            <PortfolioTreemap
              holdings={holdings}
              currency={currency}
              totalValue={stats?.total_value ?? 0}
            />
          </div>
        </TabsContent>

```

- [ ] **Step 5: Add pagination to the Holdings tab**

Find inside the Holdings TabsContent the closing `</div>` that wraps the `<table>` (after `</table>` around line 240). The structure looks like:

```tsx
              <div style={{ overflowX: 'auto' }}>
                <table ...>
                  ...
                </table>
              </div>
```

Replace the entire holdings table section (from `{holdings.length === 0 ? (` to the matching closing paren `)}`) with:

```tsx
            {holdings.length === 0 ? (
              <p style={{ textAlign: 'center', padding: '48px 0', color: colors.muted, fontSize: 14 }}>
                No holdings yet. Record a buy trade to get started.
              </p>
            ) : (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                        {['Ticker', 'Qty', 'Avg Cost', 'Current Price', 'Value', 'Unrealized P&L', ''].map(h => (
                          <th key={h} style={{ paddingBottom: 8, paddingRight: 16, textAlign: 'left', color: colors.muted, fontWeight: 500, fontSize: 12 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {holdings
                        .slice(holdingsPage * HOLDINGS_PAGE_SIZE, (holdingsPage + 1) * HOLDINGS_PAGE_SIZE)
                        .map((h) => {
                          const plPositive = h.unrealized_pl !== null ? h.unrealized_pl >= 0 : null;
                          return (
                            <tr key={`${h.ticker}-${h.market}`} style={{ borderBottom: `1px solid ${colors.border}` }}>
                              <td style={{ padding: '12px 16px 12px 0', fontWeight: 600, color: colors.text }}>
                                {displayTicker(h.ticker, h.market)}
                                <span style={{
                                  display: 'inline-block',
                                  marginLeft: 6,
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  backgroundColor: isCommodity(h.market) ? `${colors.warning}20` : `${colors.accent}20`,
                                  color: isCommodity(h.market) ? colors.warning : colors.accent,
                                  border: `1px solid ${isCommodity(h.market) ? `${colors.warning}40` : `${colors.accent}40`}`,
                                }}>
                                  {isCommodity(h.market) ? 'CMDTY' : h.market}
                                </span>
                              </td>
                              <td style={{ padding: '12px 16px 12px 0', color: colors.text }}>{isCommodity(h.market) ? h.shares.toFixed(4) : h.shares} {displayUnit(h.ticker, h.market)}</td>
                              <td style={{ padding: '12px 16px 12px 0', color: colors.text }}>{fmt(h.avg_cost, h.currency)}</td>
                              <td style={{ padding: '12px 16px 12px 0', color: colors.text }}>
                                {h.current_price !== null ? fmt(h.current_price, h.currency) : '—'}
                              </td>
                              <td style={{ padding: '12px 16px 12px 0', color: colors.text }}>
                                {h.value !== null ? fmt(h.value, h.currency) : '—'}
                              </td>
                              <td style={{ padding: '12px 16px 12px 0', fontWeight: 600, color: plPositive === true ? colors.positive : plPositive === false ? colors.negative : colors.text }}>
                                {h.unrealized_pl !== null ? fmt(h.unrealized_pl, h.currency) : '—'}
                                {h.unrealized_pl_pct !== null && (
                                  <span style={{ marginLeft: 4, fontSize: 11 }}>({pct(h.unrealized_pl_pct)})</span>
                                )}
                              </td>
                              <td style={{ padding: '12px 0' }}>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setSelectedHolding(h)}
                                >
                                  Trades
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                {/* Pagination controls */}
                {holdings.length > HOLDINGS_PAGE_SIZE && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 16 }}>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={holdingsPage === 0}
                      onClick={() => setHoldingsPage(p => p - 1)}
                    >
                      ← Prev
                    </Button>
                    <span style={{ fontSize: 12, color: colors.muted }}>
                      Page {holdingsPage + 1} of {Math.ceil(holdings.length / HOLDINGS_PAGE_SIZE)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={(holdingsPage + 1) * HOLDINGS_PAGE_SIZE >= holdings.length}
                      onClick={() => setHoldingsPage(p => p + 1)}
                    >
                      Next →
                    </Button>
                  </div>
                )}
              </>
            )}
```

- [ ] **Step 6: Commit**

```bash
cd /Users/telephant/projects/firewise/firewise-web
git add "src/app/(fire)/fire/portfolios/[id]/page.tsx"
git commit -m "feat: add Distribution treemap tab as default, paginate Holdings tab"
```

---

## Self-Review

**Spec coverage:**
- ✅ Distribution tab as default (`defaultValue="distribution"`)
- ✅ Squarified treemap algorithm in `portfolio-treemap.tsx`
- ✅ Tiles sized by `h.value`, colored by `unrealized_pl_pct`
- ✅ Tile content: name, value, weight%, P&L%
- ✅ Small tile fallback (<40px shows name only)
- ✅ Tiny tile fallback (<20px shows nothing)
- ✅ Empty state message
- ✅ Commodity display via `displayTicker`
- ✅ Holdings pagination — 20 per page, prev/next, page counter
- ✅ Pagination hidden when ≤20 holdings
- ✅ `holdingsPage` resets to 0 when `holdings` changes
- ✅ Tab order: Distribution · Holdings · Dividends · P&L · Stats · DCA

**Placeholder scan:** None found — all code is complete.

**Type consistency:**
- `PortfolioTreemap` props: `holdings: Holding[]`, `currency: string`, `totalValue: number` — used consistently in Task 2
- `TileInput.pct` is `number | null` — handled in both the color logic and the pctStr rendering
- `displayTicker(tile.ticker, tile.market)` — matches the signature exported from `@/lib/fire/commodities`
