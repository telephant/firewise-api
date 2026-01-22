# US Stock Dividend Auto-Creation Task

## Overview
Create a scheduled task that checks for dividend payment dates and automatically creates dividend income flows for US stocks the user holds.

## Requirements
1. Add `needs_review` field to flows table for auto-created flows
2. Allow income flows to optionally have `from_asset_id` (for linking dividend to stock)
3. Tax is stored per-flow in existing `tax_withheld` field (no global setting needed)
4. Daily task to check dividend payment dates via Yahoo Finance API
5. Review UI: dedicated page + notification badge
6. Duplicate check: asset_id + payment_date to avoid creating duplicate dividends

---

## Implementation Plan

### 1. Database Migration (API)
**File:** `supabase/migrations/025_add_dividend_support.sql`

```sql
-- Add needs_review field to flows
ALTER TABLE flows ADD COLUMN needs_review BOOLEAN DEFAULT FALSE;
CREATE INDEX idx_flows_needs_review ON flows(user_id, needs_review) WHERE needs_review = TRUE;

-- Modify flow constraint to allow income with optional from_asset_id (for dividends)
ALTER TABLE flows DROP CONSTRAINT valid_flow;
ALTER TABLE flows ADD CONSTRAINT valid_flow CHECK (
  (type = 'income' AND to_asset_id IS NOT NULL) OR
  (type = 'expense' AND from_asset_id IS NOT NULL AND to_asset_id IS NULL) OR
  (type = 'transfer' AND from_asset_id IS NOT NULL AND to_asset_id IS NOT NULL)
);
```

### 2. Update Flow Controller (API)
**File:** `src/controllers/flow.controller.ts`

- Remove validation that blocks `from_asset_id` on income flows
- Add `needs_review` to create/update flow
- Add filter support: `GET /api/fire/flows?needs_review=true`
- Add endpoint to mark flow as reviewed: `PATCH /api/fire/flows/:id/review`

### 3. Update Flow Types (API)
**File:** `src/types/index.ts`

```typescript
interface Flow {
  // ... existing fields
  needs_review?: boolean;
}
```

### 4. Create Dividend Task (API)
**File:** `tasks/check-dividends.task.ts`

**Logic:**
1. Get all users with US stock holdings (assets where type='stock' and market='US')
2. For each unique stock ticker, fetch dividend data from Yahoo Finance API
3. Check if today is a payment date for any dividend
4. For each matching dividend:
   - **Duplicate check**: Query if flow exists with same `from_asset_id` + `date` + `category='dividend'`
   - If not duplicate:
     - Calculate gross amount: `shares × dividend_per_share`
     - Create income flow with:
       - `type: 'income'`
       - `amount: gross_amount` (user can adjust on review)
       - `from_asset_id: stock_asset_id` (link to stock)
       - `to_asset_id: user's primary cash account`
       - `category: 'dividend'`
       - `tax_withheld: null` (user fills in on review)
       - `needs_review: true`
       - `metadata: { dividend_per_share, ex_date, payment_date }`

**Yahoo Finance API:**
```
https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?events=div&interval=1wk&period1=${start}&period2=${end}
```

Response structure:
```json
{
  "chart": {
    "result": [{
      "events": {
        "dividends": {
          "1609459200": { "amount": 0.205, "date": 1609545600 }
        }
      }
    }]
  }
}
```

### 5. Register Task in Task Runner (API)
**File:** `tasks/index.ts`

Add `check-dividends` task alongside `update-currency`

**File:** `package.json`

Add script: `"task:check-dividends": "ts-node tasks/index.ts check-dividends"`

### 6. Frontend - Flow Types Update
**File:** `firewise-web/src/types/fire.ts`

```typescript
interface Flow {
  // ... existing
  needs_review?: boolean;
}
```

### 7. Frontend - Review Page
**File:** `firewise-web/src/app/(dashboard)/fire/review/page.tsx`

- List all flows with `needs_review: true`
- For each flow, show:
  - Stock name (from linked asset), dividend amount (gross)
  - Input field for `tax_withheld` (user enters actual tax withheld)
  - Approve button → sets `needs_review: false`
  - Edit button → opens full flow edit dialog
  - Delete button → removes flow
- Empty state when no flows to review

### 8. Frontend - Notification Badge
**File:** `firewise-web/src/components/fire/fire-nav.tsx` (or sidebar)

- Fetch count of flows needing review
- Show badge with count next to "Review" nav item

---

## Key Files to Modify

### API (firewise-api)
| File | Action |
|------|--------|
| `supabase/migrations/025_add_dividend_support.sql` | New |
| `tasks/check-dividends.task.ts` | New |
| `tasks/index.ts` | Modify |
| `src/controllers/flow.controller.ts` | Modify |
| `src/types/index.ts` | Modify |
| `package.json` | Modify |

### Web (firewise-web)
| File | Action |
|------|--------|
| `src/types/fire.ts` | Modify |
| `src/app/(dashboard)/fire/review/page.tsx` | New |
| `src/components/fire/fire-nav.tsx` | Modify |
| `src/lib/api.ts` | Modify (add review endpoints) |

---

## Task Execution Flow

```
Daily Cron (check-dividends)
    │
    ▼
Get all users with US stocks (type='stock', market='US')
    │
    ▼
For each user's stock:
    │
    ├─► Fetch dividend data from Yahoo Finance
    │       (events=div, period covering today)
    │
    ├─► Check if today = payment_date
    │       │
    │       ▼ (if yes)
    │   Check duplicate: from_asset_id + date + category='dividend'
    │       │
    │       ▼ (if not duplicate)
    │   Calculate: shares × dividend_amount
    │       │
    │       ▼
    │   Create income flow:
    │     - from_asset_id = stock
    │     - to_asset_id = primary cash account
    │     - needs_review = true
    │     - category = 'dividend'
    │     - tax_withheld = null (user fills)
    │
    └─► Next stock
```

---

## Notes

- Dividends are modeled as **income** with optional `from_asset_id` linking to the stock
- The `needs_review` flag allows auto-created flows to be verified by user
- Tax is per-flow (not global) since different investments have different tax situations
- Task is idempotent - checks for existing dividend flow before creating
- User reviews and fills in `tax_withheld` based on their broker statement
