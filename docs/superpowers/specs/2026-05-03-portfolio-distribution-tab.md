# Portfolio Distribution Tab & Holdings Pagination Design

**Date:** 2026-05-03
**Status:** Approved

---

## Overview

Add a Distribution tab as the default tab on the portfolio detail page, showing a treemap of holdings sized by portfolio weight and colored by P&L direction. Also add client-side pagination to the Holdings tab (20 rows per page).

---

## Scope

**In scope:**
- New "Distribution" tab — treemap visualization, becomes default tab
- Holdings tab — client-side pagination, 20 rows per page

**Out of scope:**
- Backend changes (all data already available via `holdings` array)
- Drill-down / click interaction on treemap tiles
- Animated transitions

---

## Distribution Tab

### Treemap Layout

Pure SVG treemap — no external library. Uses a squarified treemap algorithm to divide a fixed container (width: full container, height: 420px) into rectangles proportional to each holding's `value` (market value in portfolio currency).

**Input data:** `holdings` array, filtered to `h.value !== null && h.value > 0`, sorted descending by value.

**Tile content (centered, ellipsis on overflow):**
```
AAPL          ← ticker (friendly name for commodities)
$12,450       ← value formatted in portfolio currency
34.2%         ← weight % of total portfolio value
+12.3%        ← unrealized_pl_pct (colored positive/negative)
```

**Tile color:**
- `unrealized_pl_pct > 0` → green tint: background `${colors.positive}18`, border `${colors.positive}40`
- `unrealized_pl_pct < 0` → red tint: background `${colors.negative}18`, border `${colors.negative}40`
- `unrealized_pl_pct === 0` or null → neutral: background `${colors.surfaceLight}`, border `${colors.border}`

**Text color:** Always `colors.text` for name/value/weight; `colors.positive` / `colors.negative` / `colors.muted` for the P&L % line.

**Minimum tile size:** Tiles smaller than 40×40px show only the ticker name (no value/weight/pct lines).

**Empty state:** If no holdings with value > 0, show centered muted text "No holdings with market value yet."

### Squarified Treemap Algorithm

Implement `squarify(items, x, y, width, height)` — standard squarified algorithm that minimizes aspect ratio. Returns `{ ticker, x, y, w, h, weight, value, pct }[]`.

### Component

New file: `src/components/fire/portfolio-treemap.tsx`

```tsx
interface Props {
  holdings: Holding[];
  currency: string;
  totalValue: number;  // stats.total_value for weight calculation
}
```

Renders an SVG with `width="100%"` and fixed `viewBox="0 0 800 420"`. Each tile is a `<g>` containing a `<rect>` and `<text>` elements.

---

## Holdings Tab — Pagination

Client-side. State: `holdingsPage` (number, default 0). Page size: 20.

Controls rendered below the table:
```
← Prev    Page 1 of 3    Next →
```

- "Prev" disabled on page 0
- "Next" disabled on last page
- Reset `holdingsPage` to 0 when `holdings` changes

No backend changes — all holdings are already loaded.

---

## Tab Order & Default

New tab order: **Distribution** · Holdings · Dividends · P&L · Stats · DCA

`defaultValue="distribution"` on the `<Tabs>` component.

---

## File Changes

**Create:**
- `src/components/fire/portfolio-treemap.tsx` — treemap SVG component

**Modify:**
- `src/app/(fire)/fire/portfolios/[id]/page.tsx` — add Distribution tab, pagination state, reorder tabs
