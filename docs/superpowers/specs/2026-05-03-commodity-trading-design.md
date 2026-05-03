# Commodity Trading Design

**Date:** 2026-05-03
**Status:** Approved

---

## Overview

Add commodity trading support (gold, silver, platinum, crude oil) to the portfolio module. Commodities are tracked alongside stocks in the same portfolio — same holdings view, same P&L calculation, same snapshot logic. The only differences are in data entry (commodity picker instead of ticker search, unit-aware quantity) and display (friendly names, CMDTY market badge).

---

## Scope

**Supported commodities (phase 1):**

| Name | Ticker | Price Unit | Currency |
|------|--------|------------|----------|
| Gold | GC=F | troy oz | USD |
| Silver | SI=F | troy oz | USD |
| Platinum | PL=F | troy oz | USD |
| Crude Oil WTI | CL=F | barrel | USD |

Price data comes from the existing findata service (yfinance) — no changes needed to findata.

**Out of scope:** Industrial metals (copper), agricultural commodities, natural gas, unit conversion between user units and exchange units.

---

## Data Model

### `trades` table — two new columns

```sql
ALTER TABLE trades
  ADD COLUMN asset_type TEXT NOT NULL DEFAULT 'stock'
    CHECK (asset_type IN ('stock', 'commodity')),
  ADD COLUMN unit TEXT
    CHECK (unit IN ('troy_oz', 'barrel', 'gram', 'kg', 'oz', 'pound', 'unit'));
```

**Constraints:**
- `unit` is NULL when `asset_type = 'stock'`
- `unit` is NOT NULL when `asset_type = 'commodity'`
- Enforced via DB check constraint and API validation

**`market` field:** Add `'COMMODITY'` to the existing check constraint:
```sql
ALTER TABLE trades DROP CONSTRAINT trades_market_check;
ALTER TABLE trades ADD CONSTRAINT trades_market_check
  CHECK (market IN ('US', 'SGX', 'HK', 'CN', 'COMMODITY'));
```

Commodity trades always use `market = 'COMMODITY'`.

**Existing fields reused as-is:**
- `ticker` — stores `GC=F`, `SI=F`, etc.
- `shares` — stores quantity (in the trade's unit)
- `price` — stores price per unit (matching yfinance's unit for that ticker)
- `currency` — USD for all phase-1 commodities

### Migration

New file: `supabase/migrations/002_commodity.sql`

**Existing data safety:**
- `asset_type DEFAULT 'stock'` — all existing trade rows automatically backfilled to `'stock'`
- `unit` has no default — all existing rows get `NULL`, which is correct for stocks
- `market` constraint expansion is backwards-compatible — existing values (US/SGX/HK/CN) remain valid

```sql
-- Add asset_type and unit columns to trades
ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS asset_type TEXT NOT NULL DEFAULT 'stock'
    CHECK (asset_type IN ('stock', 'commodity')),
  ADD COLUMN IF NOT EXISTS unit TEXT
    CHECK (unit IN ('troy_oz', 'barrel', 'gram', 'kg', 'oz', 'pound', 'unit'));

-- Extend market enum to include COMMODITY
ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_market_check;
ALTER TABLE trades ADD CONSTRAINT trades_market_check
  CHECK (market IN ('US', 'SGX', 'HK', 'CN', 'COMMODITY'));
```

---

## Backend

### Commodity config constant

New file: `src/config/commodities.ts`

```ts
export const COMMODITY_CONFIG: Record<string, {
  name: string;
  unit: 'troy_oz' | 'barrel';
  currency: string;
}> = {
  'GC=F': { name: 'Gold',        unit: 'troy_oz', currency: 'USD' },
  'SI=F': { name: 'Silver',      unit: 'troy_oz', currency: 'USD' },
  'PL=F': { name: 'Platinum',    unit: 'troy_oz', currency: 'USD' },
  'CL=F': { name: 'Crude Oil',   unit: 'barrel',  currency: 'USD' },
};

export type CommodityUnit = 'troy_oz' | 'barrel' | 'gram' | 'kg' | 'oz' | 'pound' | 'unit';
```

### Trade controller changes (`src/controllers/trade.controller.ts`)

**createTrade / updateTrade — add validation:**
- If `asset_type = 'commodity'`: require `unit`, require `ticker` to be in `COMMODITY_CONFIG`, set `market = 'COMMODITY'`
- If `asset_type = 'stock'`: `unit` must be null, `market` must be one of US/SGX/HK/CN

**No changes to holdings, P&L, or snapshot calculation** — `unrealized_pl = shares × current_price - shares × avg_cost` is unit-agnostic. The findata price call already handles commodity tickers (GC=F etc.) identically to stock tickers.

### Type updates (`src/types/index.ts`)

Add to Trade type:
```ts
asset_type: 'stock' | 'commodity';
unit: CommodityUnit | null;
```

### New endpoint: `GET /fire/commodities`

Returns the list of supported commodities with current prices. Used by the frontend commodity picker.

```ts
// Response
[{
  ticker: 'GC=F',
  name: 'Gold',
  unit: 'troy_oz',
  currency: 'USD',
  price: 4644.5,
  change_percent: 0.13,
}]
```

Prices fetched via `fetchStockPrices()` from findata — same call as stocks.

---

## Frontend

### API types (`src/lib/fire/api.ts`)

Extend `Trade` interface:
```ts
asset_type: 'stock' | 'commodity';
unit: string | null;
```

Extend `CreateTradeData`:
```ts
asset_type?: 'stock' | 'commodity';
unit?: string;
```

Add `CommodityInfo` type and `commodityApi.list()` endpoint call.

### `RecordTradeDialog` changes

**Asset type switcher** — two-segment pill at top of form, above Buy/Sell toggle:
```
[Stock]  [Commodity]
```
Default: Stock. Switching resets form fields.

**Stock mode:** unchanged.

**Commodity mode:**
- Ticker input replaced with 2×2 card grid (Gold, Silver, Platinum, Crude Oil)
- Each card shows: name, ticker, real-time price + change% (fetched on dialog open)
- Selected card highlighted with accent border
- Market field hidden
- Quantity field: label "Quantity", right-side unit badge (e.g. "troy oz") auto-populated from selected commodity, not editable
- Price field: label "Price per troy oz" / "Price per barrel", pre-filled with current spot price, user can override
- Currency field: auto-set to USD, hidden

**Commodity card layout:**
```
┌─────────────────────┐
│  Gold               │
│  GC=F               │
│  $4,644.50  +0.13%  │
└─────────────────────┘
```

### Holdings display changes (`holding-trades-panel.tsx`, portfolio holdings table)

- Commodity holdings show ticker as friendly name: "Gold" instead of "GC=F"
- Market badge shows "CMDTY" (accent-colored) instead of "US"/"HK"
- Quantity label shows unit: "2.5 troy oz" instead of "2.5 shares"

### No changes needed

- Portfolio stats calculation
- Portfolio snapshot task
- DCA (commodities not supported in DCA — out of scope)
- Dividend sync (commodities have no dividends)

---

## Unit display mapping

```ts
const UNIT_LABELS: Record<string, string> = {
  troy_oz:  'troy oz',
  barrel:   'barrel',
  gram:     'g',
  kg:       'kg',
  oz:       'oz',
  pound:    'lb',
  unit:     'unit',
};
```

---

## Out of Scope

- Unit conversion (e.g. user buys in grams, price quoted in troy oz) — user must enter price in their chosen unit
- DCA plans for commodities
- Dividend tracking for commodities
- Industrial metals, agricultural commodities, natural gas
- Commodity-specific analytics (cost basis in weight, etc.)
