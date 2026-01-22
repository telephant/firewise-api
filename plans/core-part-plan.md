# FIRE Management - Flow Layer Implementation Plan

## Overview
Create the Flow Layer for FIRE (Financial Independence, Retire Early) management under `/fire` route. Flows represent money movement events (Income, Expense, Transfer) that will later update Asset/Debt layers.

## UI Style: Notion-like (Black/White Sketch)

> **IMPORTANT:** This style is ONLY for the `/fire` routes (core FIRE management).
> DO NOT modify any existing expense feature UI. The expense tracker keeps its current design.

**Design Principles:**
- Clean, minimal black and white aesthetic
- Sketch/line-drawing icons (not filled)
- Light borders, subtle shadows
- Lots of whitespace
- Typography-focused (clear hierarchy)
- Hover states with subtle gray backgrounds
- No heavy colors - monochrome with occasional accent

**Color Palette (for /fire only):**
- Background: `#ffffff` (pure white)
- Text: `#37352f` (Notion dark gray)
- Muted: `#787774` (secondary text)
- Border: `#e3e2e0` (light gray)
- Hover: `#f7f6f5` (very light gray)
- Accent: `#2eaadc` (optional blue for links/actions)

**Separation Strategy:**
All FIRE-related code goes under `/fire` subdirectories:

```
firewise-web/src/
  app/
    (fire)/                    # Route group for /fire pages
  components/
    fire/                      # All fire-specific components
      fire-sidebar.tsx
      add-flow-dialog.tsx
      ...
  hooks/
    fire/                      # Fire-specific hooks
      use-flows.ts
      use-assets.ts
  contexts/
    fire/                      # Fire-specific contexts
      flow-data-context.tsx
  lib/
    fire/                      # Fire-specific utilities
      api.ts                   # flowApi, assetApi
      utils.ts
  types/
    fire.ts                    # Fire type definitions
  styles/
    fire.css                   # Fire-specific global styles (optional)
```

**DO NOT modify:**
- `/components/ui/` (shared UI primitives)
- `/components/expense/`
- `/components/layout/` (dashboard layout)
- `globals.css`

---

## Homepage Layout (from firehomepage.md)

```
┌─────────────────────────────────────────────────────────────────┐
│                        FIRE Dashboard                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ FIRE: 68%    │  │ Passive: 32% │  │ SWR: 3.8%    │  [+Add]   │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
├─────────────────────────────────────────────────────────────────┤
│  Asset Board                              │  Flow Map           │
│  ─────────────                            │  ────────           │
│  💵 Cash: €8,500                          │  Salary ──┬─> Bank  │
│  💹 ETF: €28,000 (+4.8%)                  │           ├─> Expense│
│     └─ Potential: €280/mo                 │           └─> Invest │
│  🏠 Real Estate: €120,000                 │              └─> ETF  │
│     └─ Rent: €600/mo                      │                      │
│  📉 Debt: -€50,000 (Mortgage)             │                      │
├─────────────────────────────────────────────────────────────────┤
│  Story Layer                                                     │
│  "Your salary €5,000 arrived. €2,000 invested in ETF.           │
│   ETF grew to €28,000. Potential flow €280/mo. FIRE: 68%"       │
└─────────────────────────────────────────────────────────────────┘
```

## Architecture

```
Flow Layer (Events)          Asset Layer (States)         Potential Layer
─────────────────           ─────────────────           ─────────────────
Income                  →   Cash, Investments      →   Safe Withdrawal Rate
Expense                 →   (decreases assets)         FIRE Progress %
Transfer                →   ETF, Stocks, etc.
```

---

## Core Concept: Unified Flow Model

> **Every money movement = Flow from A → B**

```
┌─────────────────────────────────────────────────────────────┐
│  Income:    [External] ──────→ [Your Asset]                 │
│  Expense:   [Your Asset] ────→ [External]                   │
│  Transfer:  [Your Asset] ────→ [Your Asset]                 │
└─────────────────────────────────────────────────────────────┘
```

**Examples:**
| Action | From | To | Amount |
|--------|------|-----|--------|
| Salary | External | Chase Checking | $5,000 |
| Groceries | Chase Checking | External | $200 |
| Buy AAPL | Chase Checking | AAPL Stock | $1,000 |
| AAPL Dividend | AAPL Stock | Chase Checking | $50 |
| Sell ETF | VOO ETF | Chase Checking | $500 |

**Key Principle:** Flows auto-create assets. No need to set up accounts first.

---

## Phase 1: Database Migration

### Table 1: Assets (auto-created from flows)

**File:** `firewise-api/supabase/migrations/013_create_flows_table.sql`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | ✅ | Primary key |
| user_id | UUID | ✅ | Owner |
| name | string | ✅ | "Chase Checking", "AAPL", "My Apartment" |
| type | enum | ✅ | `cash` `stock` `etf` `bond` `real_estate` `crypto` `debt` `other` |
| ticker | string | ⛔ | Stock/ETF ticker symbol |
| currency | string | ✅ | USD, CNY, EUR |
| market | string | ⛔ | US / CN / HK / RE |
| metadata | jsonb | ⛔ | { shares, cost_basis, etc. } |
| created_at | timestamptz | ✅ | Auto |
| updated_at | timestamptz | ✅ | Auto |

### Table 2: Flows (all transactions)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | ✅ | Primary key |
| user_id | UUID | ✅ | Owner |
| type | enum | ✅ | `income` `expense` `transfer` |
| amount | decimal | ✅ | Flow amount |
| currency | string | ✅ | USD, CNY, EUR |
| from_asset_id | UUID | ⛔ | Source asset (null = external/income) |
| to_asset_id | UUID | ⛔ | Destination asset (null = external/expense) |
| category | string | ⛔ | salary, dividend, groceries, investment... |
| date | date | ✅ | Transaction date |
| description | text | ⛔ | Notes |
| tax_withheld | decimal | ⛔ | For dividends/income |
| metadata | jsonb | ⛔ | Type-specific data |
| created_at | timestamptz | ✅ | Auto |
| updated_at | timestamptz | ✅ | Auto |

```sql
-- Asset type enum
CREATE TYPE asset_type AS ENUM (
  'cash', 'stock', 'etf', 'bond', 'real_estate', 'crypto', 'debt', 'other'
);

-- Flow type enum
CREATE TYPE flow_type AS ENUM ('income', 'expense', 'transfer');

-- Assets table (auto-created from flows)
CREATE TABLE assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type asset_type NOT NULL,
  ticker VARCHAR(20),
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  market VARCHAR(10),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- Flows table (all transactions)
CREATE TABLE flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type flow_type NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  from_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
  to_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
  category VARCHAR(100),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT,
  tax_withheld DECIMAL(12, 2),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Validation: income has to_asset, expense has from_asset, transfer has both
  CONSTRAINT valid_flow CHECK (
    (type = 'income' AND from_asset_id IS NULL AND to_asset_id IS NOT NULL) OR
    (type = 'expense' AND from_asset_id IS NOT NULL AND to_asset_id IS NULL) OR
    (type = 'transfer' AND from_asset_id IS NOT NULL AND to_asset_id IS NOT NULL)
  )
);

-- Indexes + RLS policies
```

### Asset Balance Calculation

Asset balances are calculated from flows (not stored):
```sql
SELECT
  a.id,
  a.name,
  COALESCE(SUM(CASE WHEN f.to_asset_id = a.id THEN f.amount ELSE 0 END), 0) -
  COALESCE(SUM(CASE WHEN f.from_asset_id = a.id THEN f.amount ELSE 0 END), 0) AS balance
FROM assets a
LEFT JOIN flows f ON f.to_asset_id = a.id OR f.from_asset_id = a.id
WHERE a.user_id = $1
GROUP BY a.id;
```

---

## Phase 2: Backend API

### New Files
| File | Purpose |
|------|---------|
| `firewise-api/src/routes/flow.routes.ts` | Flow route definitions |
| `firewise-api/src/routes/asset.routes.ts` | Asset route definitions |
| `firewise-api/src/controllers/flow.controller.ts` | Flow business logic |
| `firewise-api/src/controllers/asset.controller.ts` | Asset business logic |

### Flow Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/flows` | List user's flows (with filters) |
| POST | `/api/flows` | Create flow (auto-creates asset if needed) |
| GET | `/api/flows/:id` | Get single flow |
| PUT | `/api/flows/:id` | Update flow |
| DELETE | `/api/flows/:id` | Delete flow |
| GET | `/api/flows/stats` | Flow statistics |

### Asset Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/assets` | List user's assets with balances |
| POST | `/api/assets` | Create asset manually |
| GET | `/api/assets/:id` | Get single asset with balance |
| PUT | `/api/assets/:id` | Update asset |
| DELETE | `/api/assets/:id` | Delete asset (if no flows) |

### Register in `firewise-api/src/routes/index.ts`
```typescript
import flowRoutes from './flow.routes';
import assetRoutes from './asset.routes';
router.use('/flows', flowRoutes);
router.use('/assets', assetRoutes);
```

### Types to add in `firewise-api/src/types/index.ts`
```typescript
export type AssetType = 'cash' | 'stock' | 'etf' | 'bond' | 'real_estate' | 'crypto' | 'debt' | 'other';
export type FlowType = 'income' | 'expense' | 'transfer';

export interface Asset { ... }
export interface AssetWithBalance extends Asset { balance: number; }
export interface Flow { ... }
export interface FlowWithDetails extends Flow { from_asset?, to_asset? }
export interface FlowFilters { type?, start_date?, end_date?, asset_id?, page?, limit? }
```

---

## Phase 3: Frontend Structure

> **IMPORTANT:** All core FIRE code is isolated under `(fire)` route group.
> This keeps it completely separate from the expense tracker at `(dashboard)`.

### New Route Group: `(fire)`
```
firewise-web/src/app/
  (dashboard)/              # EXISTING - DO NOT MODIFY
    layout.tsx
    dashboard/...

  (fire)/                   # NEW - All core FIRE management
    layout.tsx              # Notion-style layout (separate from dashboard)
    fire/
      page.tsx              # Main FIRE dashboard at /fire
      flows/
        page.tsx            # Flow list view at /fire/flows
      assets/
        page.tsx            # Asset list view at /fire/assets
```

### URL Structure
- `/fire` → FIRE Dashboard (homepage with metrics, assets, flow map)
- `/fire/flows` → Flow list view
- `/fire/assets` → Asset list view
- `/dashboard` → Expense tracker (unchanged)

### Layout Pattern (follow dashboard layout)
```typescript
// firewise-web/src/app/(fire)/layout.tsx
<SidebarProvider>
  <FireSidebar />
  <SidebarInset>{children}</SidebarInset>
  <Toaster />
</SidebarProvider>
```

### New Components
```
firewise-web/src/components/fire/
  # Layout
  fire-sidebar.tsx          # Navigation for FIRE section
  fire-header.tsx           # Top bar with FIRE metrics + Add button

  # Homepage Sections
  fire-metrics.tsx          # FIRE %, Passive Income %, SWR cards
  asset-board.tsx           # Cash, ETF, Real Estate, Debt display
  flow-map.tsx              # Visual flow diagram (Salary → Investments)
  story-layer.tsx           # AI-generated financial narrative

  # Add Flow Dialog
  add-flow-dialog.tsx       # Tabbed dialog (Income/Expense/Transfer)
  income-flow-form.tsx      # Income form fields
  expense-flow-form.tsx     # Expense form fields
  transfer-flow-form.tsx    # Transfer form fields

  # Flow List
  flow-list.tsx             # Display all flows
  flow-card.tsx             # Individual flow item

  # Asset List
  asset-list.tsx            # Display all assets
  asset-card.tsx            # Individual asset item
```

### Context & Hooks
```
firewise-web/src/contexts/fire/flow-data-context.tsx
firewise-web/src/hooks/fire/use-flows.ts
firewise-web/src/hooks/fire/use-assets.ts
firewise-web/src/lib/fire/api.ts
firewise-web/src/types/fire.ts
```

---

## Phase 4: Add Flow Dialog Design

```
┌─────────────────────────────────────────┐
│  + Add Flow                             │
├─────────────────────────────────────────┤
│  What happened?                         │
│                                         │
│  ┌─────────┐ ┌─────────┐ ┌──────────┐  │
│  │ 💰      │ │ 💸      │ │ 🔄       │  │
│  │ Income  │ │ Expense │ │ Transfer │  │
│  └─────────┘ └─────────┘ └──────────┘  │
│                                         │
│  [Form changes based on selection]      │
└─────────────────────────────────────────┘
```

### Tab 1: Income (External → Asset)
**Required:**
- Amount & Currency
- To Account: [Select or + New] (auto-creates asset)
- Category: salary / bonus / dividend / interest / rental / other
- Date

**Optional:**
- Description
- Tax Withheld (for dividends)

### Tab 2: Expense (Asset → External)
**Required:**
- Amount & Currency
- From Account: [Select existing asset]
- Category: food / housing / transport / utilities / other
- Date

**Optional:**
- Description

### Tab 3: Transfer (Asset → Asset)
**Required:**
- Amount & Currency
- From: [Select existing asset]
- To: [Select or + New] (for buying stocks, etc.)
- Date

**Optional:**
- Description
- For stock purchases: shares, price per share (in metadata)

### Auto-Create Asset Flow
When user types a new asset name:
1. Show "Create new asset" option
2. Ask for asset type (cash/stock/etf/etc.)
3. If stock/etf: ask for ticker
4. Create asset, then complete the flow

---

## Phase 5: Ledger Integration (Future)

When creating an Expense flow with ledger sync enabled:
1. Create the flow record
2. Also create an expense in the linked ledger
3. Store reference for sync
4. On update/delete, sync changes

---

## Implementation Checklist

### Backend
- [ ] Update migration `013_create_flows_table.sql` with unified model
- [ ] Add Asset & Flow types to `types/index.ts`
- [ ] Create `asset.controller.ts`
- [ ] Create `asset.routes.ts`
- [ ] Create `flow.controller.ts`
- [ ] Create `flow.routes.ts`
- [ ] Register in `routes/index.ts`

### Frontend Foundation
- [ ] Add `types/fire.ts`
- [ ] Add `lib/fire/api.ts` (flowApi, assetApi)
- [ ] Create `hooks/fire/use-flows.ts`
- [ ] Create `hooks/fire/use-assets.ts`
- [ ] Create `contexts/fire/flow-data-context.tsx`

### Route Structure
- [ ] Create `(fire)/layout.tsx`
- [ ] Create `(fire)/fire/page.tsx`
- [ ] Create `components/fire/fire-sidebar.tsx`
- [ ] Create `components/fire/fire-header.tsx`

### Homepage Sections
- [ ] Create `fire-metrics.tsx`
- [ ] Create `asset-board.tsx`
- [ ] Create `flow-map.tsx`
- [ ] Create `story-layer.tsx`

### Add Flow Dialog
- [ ] Create `add-flow-dialog.tsx` with tabs
- [ ] Create `income-flow-form.tsx`
- [ ] Create `expense-flow-form.tsx`
- [ ] Create `transfer-flow-form.tsx`

### List Views
- [ ] Create `flow-list.tsx` and `flow-card.tsx`
- [ ] Create `asset-list.tsx` and `asset-card.tsx`

### Integration
- [ ] Add FIRE link to main sidebar

---

## Critical Reference Files
- `firewise-api/src/controllers/expense.controller.ts` - Controller pattern
- `firewise-web/src/components/expense/add-expense-dialog.tsx` - Dialog pattern
- `firewise-web/src/contexts/expense-data-context.tsx` - Context pattern
- `firewise-web/src/app/(dashboard)/layout.tsx` - Layout pattern

---

## US Stock Data Resources

### Symbol List
- **File:** `firewise-api/data/us-stock/symbols.json`
- **Format:** `[{ "symbol": "AAPL", "security_name": "Apple Inc. - Common Stock" }, ...]`
- **Source:** NASDAQ trader list

### Yahoo Finance APIs
**Reference:** `firewise-api/docs/us_finance_api.md`

1. **Dividend/Events API**
```
https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?events=capitalGain%7Cdiv%7Csplit&formatted=true&includeAdjustedClose=true&interval=1wk&period1=${startTimestamp}&period2=${endTimestamp}&symbol=${symbol}
```
- Returns: dividends, capital gains, stock splits

2. **Stock Price API**
```
https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${startTimestamp}&period2=${endTimestamp}&interval=1m&includePrePost=true&events=div%7Csplit%7Cearn
```
- Returns: real-time/historical price data

### Use Cases
- Auto-complete stock ticker when creating stock/ETF assets
- Fetch current price for asset valuation
- Track dividend income automatically
- Calculate portfolio performance

---

## Expense Flow Feature - Two Modes Design

### Overview

Expense flows track money leaving your assets. Two ways to record:

1. **Manual Mode** - Create expense directly in FIRE with custom categories
2. **Linked Mode** - Import from existing ledger expenses (avoid double-entry)

### System Relationship

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  FIRE System (Personal Finance)     Ledger System (Shared)      │
│  ─────────────────────────────     ────────────────────────     │
│                                                                  │
│  ┌─────────────┐                   ┌─────────────┐              │
│  │ Manual      │                   │ Family      │              │
│  │ Expenses    │◄──── Link ───────│ Ledger      │              │
│  │ (FIRE only) │                   │ Expenses    │              │
│  └─────────────┘                   └─────────────┘              │
│        │                                  │                      │
│        ▼                                  ▼                      │
│  ┌─────────────┐                   ┌─────────────┐              │
│  │ FIRE        │                   │ Shared      │              │
│  │ Categories  │                   │ Categories  │              │
│  │ (Food, etc) │                   │ (per ledger)│              │
│  └─────────────┘                   └─────────────┘              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Why Two Modes?**
- **Manual**: Quick personal expenses, no need to create in ledger first
- **Linked**: Already tracked in shared ledger, just import to FIRE for net worth calculation

### User Flow

```
User clicks "Add Expense Flow"
        │
        ▼
┌───────────────────────────┐
│  Choose mode:             │
│  ○ Manual Entry           │
│  ○ Link from Ledger       │
└───────────────────────────┘
        │
        ├──── Manual ────► Select FIRE category → Enter amount → Done
        │
        └──── Linked ────► Browse ledger expenses → Select one → Auto-fill → Done
```

### Data Storage

- **Manual expenses**: Reference to FIRE expense categories table
- **Linked expenses**: Snapshot stored in flow metadata (ledger info, expense name, amount)

---

### UI Mockup: Expense Flow Dialog

```
┌─────────────────────────────────────────────────────────────────┐
│  + Add Flow                                              _ □ ×  │
├─────────────────────────────────────────────────────────────────┤
│  Category: [💸 Expense] ✓                                       │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  How do you want to record this expense?                        │
│  ┌────────────────────┐ ┌────────────────────┐                  │
│  │ ● Manual Entry     │ │ ○ Link from Ledger │                  │
│  │   Create new       │ │   Import existing  │                  │
│  └────────────────────┘ └────────────────────┘                  │
│                                                                  │
│  ───── MANUAL MODE ─────                                        │
│                                                                  │
│  Expense Category: [🍔 Food ▼]  [+ Add new]                     │
│  FROM: [Chase Checking ▼]                                        │
│  Amount: $______                                                 │
│  Date: [Jan 5, 2026]                                             │
│  Description: [___________________]                              │
│                                                                  │
│                              [Create Flow]                       │
└─────────────────────────────────────────────────────────────────┘

───── OR LINKED MODE ─────

│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  Select expense from your ledgers:                               │
│  Search: [🔍 _______________]                                    │
│                                                                  │
│  📒 Family Expenses                                              │
│  ├─ ○ Grocery shopping        $150.00   Jan 3                   │
│  ├─ ○ Electric bill           $85.00    Jan 2                   │
│  └─ ○ Internet                $60.00    Jan 1                   │
│  📒 Personal                                                     │
│  ├─ ● Coffee (selected)       $5.00     Jan 5                   │
│  └─ ○ Uber ride               $15.00    Jan 4                   │
│                                                                  │
│  FROM: [Chase Checking ▼]                                        │
│  Amount: $5.00 (from linked)   Date: Jan 5, 2026                │
│                                                                  │
│                              [Create Flow]                       │
└─────────────────────────────────────────────────────────────────┘
```

---

### Default FIRE Expense Categories

| Category | Icon |
|----------|------|
| Food | 🍔 |
| Housing | 🏠 |
| Transport | 🚗 |
| Utilities | ⚡ |
| Shopping | 🛍️ |
| Health | 💊 |
| Entertainment | 🎬 |
| Other | 📦 |

Users can customize and add their own categories.

---

### Future Enhancements
- Sync updates between flow and linked ledger expense
- Bulk import: convert multiple ledger expenses to flows
- Budget tracking per expense category

---

## Future Phases (Not in Scope)

### Potential Layer
- Safe Withdrawal Rate calculation
- FIRE progress percentage
- Sustainable cash flow projections
