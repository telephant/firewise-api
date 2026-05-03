# Commodity Trading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add commodity trading support (gold, silver, platinum, crude oil) to the portfolio module by extending the trades table with `asset_type` and `unit` fields, adding a commodities endpoint, and updating the frontend dialog with a commodity picker.

**Architecture:** Two new DB columns on `trades` (`asset_type`, `unit`) with safe defaults so existing data needs no migration. Backend adds a commodity config constant and a `GET /fire/commodities` endpoint for live prices. Frontend extends `RecordTradeDialog` with an asset type switcher and commodity card picker, and updates holdings display with friendly names and CMDTY badge.

**Tech Stack:** TypeScript, Express, Supabase (PostgreSQL), Next.js 14, React inline styles (fire UI system)

---

## File Map

**Backend — create:**
- `src/config/commodities.ts` — commodity config constant + CommodityUnit type
- `src/controllers/commodity.controller.ts` — GET /fire/commodities handler
- `src/routes/commodity.routes.ts` — express router for commodity routes

**Backend — modify:**
- `supabase/migrations/002_commodity.sql` — new migration file adding asset_type + unit columns
- `src/types/portfolio.ts` — extend Trade interface with asset_type + unit
- `src/controllers/trade.controller.ts` — add commodity validation in createTrade + updateTrade
- `src/routes/index.ts` — register commodity routes

**Frontend — modify:**
- `src/lib/fire/api.ts` — extend Trade, CreateTradeData types + add commodityApi
- `src/components/fire/record-trade-dialog.tsx` — add asset type switcher + commodity picker
- `src/app/(fire)/fire/portfolios/[id]/page.tsx` — update holdings display (CMDTY badge, unit label, friendly name)

---

## Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/002_commodity.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 002_commodity.sql
-- Add asset_type and unit columns to trades table.
-- Existing rows: asset_type defaults to 'stock', unit defaults to NULL (correct for stocks).

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS asset_type TEXT NOT NULL DEFAULT 'stock'
    CHECK (asset_type IN ('stock', 'commodity')),
  ADD COLUMN IF NOT EXISTS unit TEXT
    CHECK (unit IN ('troy_oz', 'barrel', 'gram', 'kg', 'oz', 'pound', 'unit'));

-- Extend market check constraint to include COMMODITY
ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_market_check;
ALTER TABLE trades ADD CONSTRAINT trades_market_check
  CHECK (market IN ('US', 'SGX', 'HK', 'CN', 'COMMODITY'));
```

Save to: `/Users/telephant/projects/firewise/firewise-api/supabase/migrations/002_commodity.sql`

- [ ] **Step 2: Push to Supabase**

```bash
cd /Users/telephant/projects/firewise/firewise-api
npx supabase db push --db-url "postgresql://postgres.ppjuhgxhvlmfobdtdkjt:[PASSWORD]@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres"
```

Expected output: `Applying migration 002_commodity.sql...`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/002_commodity.sql
git commit -m "feat: add asset_type and unit columns to trades table"
```

---

## Task 2: Backend commodity config + types

**Files:**
- Create: `src/config/commodities.ts`
- Modify: `src/types/portfolio.ts`

- [ ] **Step 1: Create commodity config**

Create `/Users/telephant/projects/firewise/firewise-api/src/config/commodities.ts`:

```typescript
export type CommodityUnit = 'troy_oz' | 'barrel' | 'gram' | 'kg' | 'oz' | 'pound' | 'unit';

export interface CommodityConfig {
  name: string;
  unit: CommodityUnit;
  currency: string;
}

export const COMMODITY_CONFIG: Record<string, CommodityConfig> = {
  'GC=F': { name: 'Gold',        unit: 'troy_oz', currency: 'USD' },
  'SI=F': { name: 'Silver',      unit: 'troy_oz', currency: 'USD' },
  'PL=F': { name: 'Platinum',    unit: 'troy_oz', currency: 'USD' },
  'CL=F': { name: 'Crude Oil',   unit: 'barrel',  currency: 'USD' },
};

export const COMMODITY_TICKERS = Object.keys(COMMODITY_CONFIG);

export const UNIT_LABELS: Record<CommodityUnit, string> = {
  troy_oz: 'troy oz',
  barrel:  'barrel',
  gram:    'g',
  kg:      'kg',
  oz:      'oz',
  pound:   'lb',
  unit:    'unit',
};
```

- [ ] **Step 2: Extend Trade type in `src/types/portfolio.ts`**

Change lines 11-23 from:
```typescript
export interface Trade {
  id: string;
  portfolio_id: string;
  ticker: string;
  market: 'US' | 'SGX' | 'HK' | 'CN';
  type: 'buy' | 'sell';
  shares: number;
  price: number;
  currency: string;
  date: string;
  notes: string | null;
  created_at: string;
}
```

To:
```typescript
export interface Trade {
  id: string;
  portfolio_id: string;
  ticker: string;
  market: 'US' | 'SGX' | 'HK' | 'CN' | 'COMMODITY';
  type: 'buy' | 'sell';
  shares: number;
  price: number;
  currency: string;
  date: string;
  notes: string | null;
  created_at: string;
  asset_type: 'stock' | 'commodity';
  unit: string | null;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/config/commodities.ts src/types/portfolio.ts
git commit -m "feat: add commodity config and extend Trade type"
```

---

## Task 3: Backend commodity controller + route

**Files:**
- Create: `src/controllers/commodity.controller.ts`
- Create: `src/routes/commodity.routes.ts`
- Modify: `src/routes/index.ts`

- [ ] **Step 1: Create commodity controller**

Create `/Users/telephant/projects/firewise/firewise-api/src/controllers/commodity.controller.ts`:

```typescript
import { Request, Response } from 'express';
import { COMMODITY_CONFIG, UNIT_LABELS } from '../config/commodities';
import { fetchStockPrices } from '../utils/findata-client';
import { ApiResponse } from '../types';

export interface CommodityInfo {
  ticker: string;
  name: string;
  unit: string;
  unitLabel: string;
  currency: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
}

// GET /fire/commodities
export const listCommodities = async (
  _req: Request,
  res: Response<ApiResponse<CommodityInfo[]>>
): Promise<void> => {
  try {
    const tickers = Object.keys(COMMODITY_CONFIG);
    const prices = await fetchStockPrices(tickers);

    const commodities: CommodityInfo[] = tickers.map(ticker => {
      const config = COMMODITY_CONFIG[ticker];
      const priceData = prices[ticker];
      return {
        ticker,
        name: config.name,
        unit: config.unit,
        unitLabel: UNIT_LABELS[config.unit],
        currency: config.currency,
        price: priceData?.price ?? null,
        change: priceData?.change ?? null,
        changePercent: priceData?.change_percent ?? null,
      };
    });

    res.json({ success: true, data: commodities });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch commodity prices' });
  }
};
```

- [ ] **Step 2: Create commodity routes**

Create `/Users/telephant/projects/firewise/firewise-api/src/routes/commodity.routes.ts`:

```typescript
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { listCommodities } from '../controllers/commodity.controller';

const router = Router();

router.get('/', authMiddleware, listCommodities);

export default router;
```

- [ ] **Step 3: Register route in `src/routes/index.ts`**

Add import after line 42 (`import dcaRoutes from './dca.routes';`):
```typescript
import commodityRoutes from './commodity.routes';
```

Add registration after line 91 (`router.use('/fire/dca', dcaRoutes);`):
```typescript
router.use('/fire/commodities', commodityRoutes);
```

- [ ] **Step 4: Commit**

```bash
git add src/controllers/commodity.controller.ts src/routes/commodity.routes.ts src/routes/index.ts
git commit -m "feat: add GET /fire/commodities endpoint with live prices"
```

---

## Task 4: Backend trade controller — commodity validation

**Files:**
- Modify: `src/controllers/trade.controller.ts`

- [ ] **Step 1: Update createTrade to handle commodity**

In `src/controllers/trade.controller.ts`, replace lines 70-98 (destructure + validation + insert):

```typescript
const { ticker, market, type, shares, price, currency, date, notes, asset_type, unit } = req.body;

const resolvedAssetType: 'stock' | 'commodity' = asset_type === 'commodity' ? 'commodity' : 'stock';

if (!ticker || !type || shares === undefined || price === undefined || !currency || !date) {
  throw new AppError('ticker, type, shares, price, currency, and date are required', 400);
}

if (!['buy', 'sell'].includes(type)) {
  throw new AppError('type must be buy or sell', 400);
}

let resolvedMarket: string;
let resolvedUnit: string | null = null;

if (resolvedAssetType === 'commodity') {
  const { COMMODITY_CONFIG, COMMODITY_TICKERS } = await import('../config/commodities');
  if (!COMMODITY_TICKERS.includes(ticker.toUpperCase())) {
    throw new AppError(`ticker must be one of: ${COMMODITY_TICKERS.join(', ')}`, 400);
  }
  if (!unit) {
    // Auto-assign unit from commodity config
    resolvedUnit = COMMODITY_CONFIG[ticker.toUpperCase()].unit;
  } else {
    const validUnits = ['troy_oz', 'barrel', 'gram', 'kg', 'oz', 'pound', 'unit'];
    if (!validUnits.includes(unit)) {
      throw new AppError(`unit must be one of: ${validUnits.join(', ')}`, 400);
    }
    resolvedUnit = unit;
  }
  resolvedMarket = 'COMMODITY';
} else {
  if (!market || !['US', 'SGX', 'HK', 'CN'].includes(market)) {
    throw new AppError('market must be one of: US, SGX, HK, CN', 400);
  }
  resolvedMarket = market;
}

const { data, error } = await supabaseAdmin
  .from('trades')
  .insert({
    portfolio_id: portfolioId,
    ticker: ticker.toUpperCase(),
    market: resolvedMarket,
    type,
    shares: Number(shares),
    price: Number(price),
    currency,
    date,
    notes: notes || null,
    asset_type: resolvedAssetType,
    unit: resolvedUnit,
  })
  .select()
  .single();
```

- [ ] **Step 2: Update updateTrade to handle commodity**

In `src/controllers/trade.controller.ts`, replace lines 126-144 (destructure + validation + updates object):

```typescript
const { ticker, market, type, shares, price, currency, date, notes, unit } = req.body;

// Fetch existing trade to know its asset_type
const { data: existing } = await supabaseAdmin
  .from('trades')
  .select('asset_type')
  .eq('id', tradeId)
  .eq('portfolio_id', portfolioId)
  .single();

const isCommodity = existing?.asset_type === 'commodity';

if (market && !isCommodity && !['US', 'SGX', 'HK', 'CN'].includes(market)) {
  throw new AppError('market must be one of: US, SGX, HK, CN', 400);
}

if (type && !['buy', 'sell'].includes(type)) {
  throw new AppError('type must be buy or sell', 400);
}

if (unit) {
  const validUnits = ['troy_oz', 'barrel', 'gram', 'kg', 'oz', 'pound', 'unit'];
  if (!validUnits.includes(unit)) {
    throw new AppError(`unit must be one of: ${validUnits.join(', ')}`, 400);
  }
}

const updates: Record<string, unknown> = {};
if (ticker !== undefined) updates.ticker = ticker.toUpperCase();
if (market !== undefined && !isCommodity) updates.market = market;
if (type !== undefined) updates.type = type;
if (shares !== undefined) updates.shares = Number(shares);
if (price !== undefined) updates.price = Number(price);
if (currency !== undefined) updates.currency = currency;
if (date !== undefined) updates.date = date;
if (notes !== undefined) updates.notes = notes;
if (unit !== undefined) updates.unit = unit;
```

- [ ] **Step 3: Commit**

```bash
git add src/controllers/trade.controller.ts
git commit -m "feat: add commodity validation to trade controller"
```

---

## Task 5: Frontend API types + commodityApi

**Files:**
- Modify: `src/lib/fire/api.ts`

- [ ] **Step 1: Extend Trade interface**

In `src/lib/fire/api.ts`, update the `Trade` interface (lines 17-29) to add two fields at the end:

```typescript
export interface Trade {
  id: string;
  portfolio_id: string;
  ticker: string;
  market: string;
  type: 'buy' | 'sell';
  shares: number;
  price: number;
  currency: string;
  date: string;
  notes: string | null;
  created_at: string;
  asset_type: 'stock' | 'commodity';
  unit: string | null;
}
```

- [ ] **Step 2: Extend CreateTradeData interface**

Update `CreateTradeData` (lines 125-134) to add optional commodity fields:

```typescript
export interface CreateTradeData {
  ticker: string;
  market: string;
  type: 'buy' | 'sell';
  shares: number;
  price: number;
  currency: string;
  date: string;
  notes?: string;
  asset_type?: 'stock' | 'commodity';
  unit?: string;
}
```

- [ ] **Step 3: Add CommodityInfo type and commodityApi**

After the `stockPriceApi` block, add:

```typescript
// ── Commodity ──────────────────────────────────────────────────────────────

export interface CommodityInfo {
  ticker: string;
  name: string;
  unit: string;
  unitLabel: string;
  currency: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
}

export const commodityApi = {
  list: () => fetchApi<CommodityInfo[]>('/fire/commodities'),
};
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/fire/api.ts
git commit -m "feat: extend Trade type and add commodityApi"
```

---

## Task 6: Frontend RecordTradeDialog — commodity mode

**Files:**
- Modify: `src/components/fire/record-trade-dialog.tsx`

- [ ] **Step 1: Add asset type state + commodity data fetching**

Replace the existing imports and state at the top of the component. Full updated file:

```typescript
'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  Button,
  Input,
  Label,
  Select,
  colors,
  CurrencyCombobox,
  DateInput,
} from '@/components/fire/ui';
import { tradeApi, commodityApi, type Trade, type CommodityInfo } from '@/lib/fire/api';
import { StockTickerInput } from '@/components/fire/stock-ticker-input';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  portfolioId: string;
  defaultCurrency?: string;
  onSuccess: (trade: Trade) => void;
  editTrade?: Trade;
}

export function RecordTradeDialog({
  open,
  onOpenChange,
  portfolioId,
  defaultCurrency = 'USD',
  onSuccess,
  editTrade,
}: Props) {
  const isEdit = !!editTrade;
  const [assetType, setAssetType] = useState<'stock' | 'commodity'>('stock');
  const [type, setType] = useState<'buy' | 'sell'>('buy');
  const [ticker, setTicker] = useState('');
  const [tickerName, setTickerName] = useState('');
  const [market, setMarket] = useState('US');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [shares, setShares] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commodities, setCommodities] = useState<CommodityInfo[]>([]);
  const [selectedCommodity, setSelectedCommodity] = useState<CommodityInfo | null>(null);

  // Load commodity prices when dialog opens in commodity mode
  useEffect(() => {
    if (!open) return;
    commodityApi.list().then(res => {
      if (res.success && res.data) setCommodities(res.data);
    });
  }, [open]);

  // When commodity selected, auto-fill price and currency
  useEffect(() => {
    if (selectedCommodity) {
      if (selectedCommodity.price != null) setPrice(String(selectedCommodity.price));
      setCurrency(selectedCommodity.currency);
      setTicker(selectedCommodity.ticker);
    }
  }, [selectedCommodity]);

  useEffect(() => {
    if (open && editTrade) {
      setAssetType(editTrade.asset_type ?? 'stock');
      setType(editTrade.type);
      setTicker(editTrade.ticker);
      setTickerName('');
      setMarket(editTrade.market);
      setDate(editTrade.date);
      setShares(String(editTrade.shares));
      setPrice(String(editTrade.price));
      setCurrency(editTrade.currency);
      setNotes(editTrade.notes || '');
      setError(null);
    } else if (!open) {
      setAssetType('stock');
      setTicker('');
      setTickerName('');
      setMarket('US');
      setDate(new Date().toISOString().split('T')[0]);
      setShares('');
      setPrice('');
      setCurrency(defaultCurrency);
      setNotes('');
      setError(null);
      setSelectedCommodity(null);
    }
  }, [open, editTrade, defaultCurrency]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const data = {
      ticker: ticker.toUpperCase(),
      market: assetType === 'commodity' ? 'COMMODITY' : market,
      type,
      shares: parseFloat(shares),
      price: parseFloat(price),
      currency,
      date,
      notes: notes || undefined,
      asset_type: assetType,
      unit: assetType === 'commodity' ? (selectedCommodity?.unit ?? editTrade?.unit ?? undefined) : undefined,
    };
    const result = isEdit
      ? await tradeApi.update(portfolioId, editTrade!.id, data)
      : await tradeApi.create(portfolioId, data);
    setLoading(false);
    if (result.success && result.data) {
      if (!isEdit) {
        setTicker('');
        setShares('');
        setPrice('');
        setNotes('');
        setSelectedCommodity(null);
      }
      onSuccess(result.data);
    } else {
      setError(result.error || (isEdit ? 'Failed to update trade' : 'Failed to record trade'));
    }
  };

  // ── Commodity card grid ──────────────────────────────────────────────────

  function CommodityGrid() {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {commodities.map(c => {
          const isSelected = selectedCommodity?.ticker === c.ticker;
          const changeColor = (c.changePercent ?? 0) >= 0 ? colors.positive : colors.negative;
          return (
            <button
              key={c.ticker}
              type="button"
              onClick={() => setSelectedCommodity(c)}
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: `1px solid ${isSelected ? colors.accent : colors.border}`,
                backgroundColor: isSelected ? `${colors.accent}15` : colors.surfaceLight,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'border-color 0.15s, background-color 0.15s',
              }}
            >
              <div style={{ color: colors.text, fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                {c.name}
              </div>
              <div style={{ color: colors.muted, fontSize: 11, marginBottom: 6 }}>
                {c.ticker} · {c.unitLabel}
              </div>
              {c.price != null ? (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ color: colors.text, fontSize: 12, fontWeight: 500 }}>
                    ${c.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  {c.changePercent != null && (
                    <span style={{ color: changeColor, fontSize: 11 }}>
                      {c.changePercent >= 0 ? '+' : ''}{c.changePercent.toFixed(2)}%
                    </span>
                  )}
                </div>
              ) : (
                <div style={{ color: colors.muted, fontSize: 11 }}>—</div>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Trade' : 'Record Trade'}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {error && <p style={{ fontSize: 13, color: colors.negative, margin: 0 }}>{error}</p>}

            {/* Asset type switcher — hidden in edit mode */}
            {!isEdit && (
              <div style={{ display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden', border: `1px solid ${colors.border}` }}>
                {(['stock', 'commodity'] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => { setAssetType(t); setTicker(''); setSelectedCommodity(null); setPrice(''); }}
                    style={{
                      flex: 1,
                      padding: '7px 0',
                      border: 'none',
                      backgroundColor: assetType === t ? colors.accent : 'transparent',
                      color: assetType === t ? '#fff' : colors.muted,
                      fontSize: 13,
                      fontWeight: assetType === t ? 600 : 400,
                      cursor: 'pointer',
                      textTransform: 'capitalize',
                      transition: 'background-color 0.15s, color 0.15s',
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}

            {/* Buy / Sell toggle */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Label>Type</Label>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button type="button" variant={type === 'buy' ? 'primary' : 'outline'} style={{ flex: 1 }} onClick={() => setType('buy')}>Buy</Button>
                <Button type="button" variant={type === 'sell' ? 'danger' : 'outline'} style={{ flex: 1 }} onClick={() => setType('sell')}>Sell</Button>
              </div>
            </div>

            {/* Stock fields */}
            {assetType === 'stock' && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <StockTickerInput
                    label="Ticker"
                    value={ticker}
                    selectedName={tickerName}
                    onChange={(t, name) => { setTicker(t); setTickerName(name); }}
                    region={market || 'US'}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <Label>Market</Label>
                  <Select
                    value={market}
                    onChange={(e) => setMarket(e.target.value)}
                    options={[
                      { value: 'US', label: 'US' },
                      { value: 'SGX', label: 'SGX' },
                      { value: 'HK', label: 'HK' },
                      { value: 'CN', label: 'CN' },
                    ]}
                  />
                </div>
              </>
            )}

            {/* Commodity picker */}
            {assetType === 'commodity' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Label>Commodity</Label>
                <CommodityGrid />
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <DateInput value={date} onChange={(v) => setDate(v)} label="Date" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Label>{assetType === 'commodity' && selectedCommodity ? `Quantity (${selectedCommodity.unitLabel})` : 'Shares'}</Label>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={shares}
                  onChange={(e) => setShares(e.target.value)}
                  required
                  placeholder={assetType === 'commodity' ? '1.0' : '100'}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Label>{assetType === 'commodity' && selectedCommodity ? `Price per ${selectedCommodity.unitLabel}` : 'Price per Share'}</Label>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  required
                  placeholder="0.00"
                />
              </div>
            </div>

            {assetType === 'stock' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <CurrencyCombobox value={currency} onChange={setCurrency} label="Currency" />
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Label>Notes (optional)</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
            </div>

            <Button
              type="submit"
              disabled={loading || (assetType === 'commodity' && !selectedCommodity && !isEdit)}
              style={{ width: '100%' }}
            >
              {loading ? (isEdit ? 'Saving...' : 'Recording...') : (isEdit ? 'Save Changes' : 'Record Trade')}
            </Button>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/fire/record-trade-dialog.tsx
git commit -m "feat: add commodity mode to RecordTradeDialog with card picker"
```

---

## Task 7: Frontend holdings display

**Files:**
- Modify: `src/app/(fire)/fire/portfolios/[id]/page.tsx`

The holdings table currently shows `ticker` and `market` columns. Commodity holdings need:
- Ticker displayed as friendly name ("Gold" instead of "GC=F")
- Market badge showing "CMDTY" instead of "US"/"HK"
- Quantity column showing "2.50 troy oz" instead of "2.50 shares"

- [ ] **Step 1: Add COMMODITY_CONFIG import and helper**

At the top of `src/app/(fire)/fire/portfolios/[id]/page.tsx`, the `Holding` type from the API already has `market` field. Add a helper to detect commodity holdings and get friendly names.

After the existing imports, add:

```typescript
// Commodity display helpers
const COMMODITY_NAMES: Record<string, string> = {
  'GC=F': 'Gold',
  'SI=F': 'Silver',
  'PL=F': 'Platinum',
  'CL=F': 'Crude Oil',
};

const COMMODITY_UNIT_LABELS: Record<string, string> = {
  'GC=F': 'troy oz',
  'SI=F': 'troy oz',
  'PL=F': 'troy oz',
  'CL=F': 'barrel',
};

function isCommodity(market: string) {
  return market === 'COMMODITY';
}

function displayTicker(ticker: string, market: string) {
  return isCommodity(market) ? (COMMODITY_NAMES[ticker] ?? ticker) : ticker;
}

function displayUnit(ticker: string, market: string) {
  return isCommodity(market) ? (COMMODITY_UNIT_LABELS[ticker] ?? 'unit') : 'shares';
}
```

- [ ] **Step 2: Update the market badge in the holdings table**

Find the cell that renders the market badge. It will look something like:
```tsx
<span style={{ ... }}>{holding.market}</span>
```

Replace with:
```tsx
<span style={{
  display: 'inline-block',
  padding: '1px 6px',
  borderRadius: 4,
  fontSize: 10,
  fontWeight: 600,
  backgroundColor: isCommodity(holding.market) ? `${colors.warning}20` : `${colors.accent}20`,
  color: isCommodity(holding.market) ? colors.warning : colors.accent,
  border: `1px solid ${isCommodity(holding.market) ? `${colors.warning}40` : `${colors.accent}40`}`,
}}>
  {isCommodity(holding.market) ? 'CMDTY' : holding.market}
</span>
```

- [ ] **Step 3: Update ticker display and shares label**

Where ticker is rendered in the holdings table, change to use `displayTicker()`:
```tsx
{displayTicker(holding.ticker, holding.market)}
```

Where shares/quantity is shown, change the label or value to use `displayUnit()`:
```tsx
{holding.shares} {displayUnit(holding.ticker, holding.market)}
```

- [ ] **Step 4: Commit**

```bash
git add "src/app/(fire)/fire/portfolios/[id]/page.tsx"
git commit -m "feat: show commodity holdings with friendly names and CMDTY badge"
```

---

## Self-Review

**Spec coverage:**
- ✅ Task 1: DB migration — `asset_type`, `unit` columns, market constraint extension
- ✅ Task 2: Commodity config constant + Trade type extension
- ✅ Task 3: `GET /fire/commodities` endpoint with live prices
- ✅ Task 4: Trade controller validation for commodity create/update
- ✅ Task 5: Frontend Trade type, CreateTradeData, commodityApi
- ✅ Task 6: RecordTradeDialog — asset type switcher, commodity card picker, unit-aware labels, auto-fill price
- ✅ Task 7: Holdings display — CMDTY badge, friendly name, unit label
- ✅ Existing stock trades unaffected (asset_type defaults to 'stock')
- ✅ No changes to P&L / holdings calculation (unit-agnostic)

**Type consistency check:**
- `CommodityInfo` defined in Task 3 (backend) and Task 5 (frontend) — field names match
- `asset_type: 'stock' | 'commodity'` used consistently in Tasks 2, 4, 5, 6
- `unit` field is `string | null` in Trade, `string | undefined` in CreateTradeData — consistent
- `COMMODITY_CONFIG` defined in Task 2, used in Task 3 and Task 4 — keys match (`GC=F` etc.)
