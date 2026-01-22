# Real Estate & Mortgage Management Plan

## Overview

Enhance real estate asset management with integrated mortgage tracking, allowing users to view, add, edit, and manage mortgages directly from their property assets.

---

## Current State

- Real estate assets stored in `assets` table with `type = 'real_estate'`
- Mortgages stored in `debts` table with `debt_type = 'mortgage'`
- Link via `debts.property_asset_id` → `assets.id`
- Mortgage can be added during property creation (Add Asset dialog)

### Gaps

1. Cannot add mortgage to existing property
2. Cannot view/edit mortgage from asset view
3. No refinance workflow
4. No payoff tracking
5. Net equity not prominently displayed

---

## Design Goals

1. **Unified View** - See property and mortgage together
2. **Simple Actions** - Add, edit, pay off mortgage from one place
3. **Net Equity Focus** - Always show property value minus debt
4. **Payment Tracking** - Link mortgage payments to the debt

---

## UI Design

### 1. Asset Card (Dashboard)

Show mortgage info inline with property:

```
┌─────────────────────────────────────────────┐
│ 🏠 Primary Home                    $450,000 │
│    Mortgage: $320,000 remaining             │
│    Net Equity: $130,000                     │
│    LTV: 71%                                 │
└─────────────────────────────────────────────┘
```

For properties without mortgage:
```
┌─────────────────────────────────────────────┐
│ 🏠 Rental Property                 $280,000 │
│    No mortgage (owned outright)             │
└─────────────────────────────────────────────┘
```

### 2. Real Estate Edit Dialog

Add "Mortgage" section/tab:

```
┌─────────────────────────────────────────────┐
│ Edit Property                          ✕    │
├─────────────────────────────────────────────┤
│ [Details] [Mortgage]                        │
│                                             │
│ ─── MORTGAGE TAB ───                        │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ Status: Active                          │ │
│ │ Current Balance: $320,000               │ │
│ │ Interest Rate: 6.5%                     │ │
│ │ Monthly Payment: $2,023                 │ │
│ │ Remaining: 26 years 4 months            │ │
│ │                                         │ │
│ │ [Edit Terms]  [Mark Paid Off]           │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ Payment History                             │
│ ├─ Jan 2026: $2,023 ($1,733 int / $290 pr) │
│ ├─ Dec 2025: $2,023 ($1,735 int / $288 pr) │
│ └─ View all...                              │
└─────────────────────────────────────────────┘
```

For properties without mortgage:
```
│ ─── MORTGAGE TAB ───                        │
│                                             │
│ No mortgage on this property.               │
│                                             │
│ [+ Add Mortgage]                            │
```

---

## Key Actions

### 1. Add Mortgage (to existing property)

**Use Case:** User bought property with cash, later takes out HELOC or mortgage.

**Flow:**
1. User opens property edit dialog
2. Goes to "Mortgage" tab
3. Clicks "Add Mortgage"
4. Fills in: Name, Principal, Current Balance, Rate, Term, Start Date
5. Creates new debt record linked to property

### 2. Edit Mortgage Terms

**Use Case:** Refinance, rate adjustment, or correction.

**Flow:**
1. User clicks "Edit Terms" on existing mortgage
2. Opens form with current values pre-filled
3. User updates fields (rate, term, balance, etc.)
4. Updates debt record

**Note:** For refinance, consider whether to:
- Update existing debt record (simpler)
- Close old debt + create new (better history tracking)

### 3. Mark Paid Off

**Use Case:** Mortgage fully paid.

**Flow:**
1. User clicks "Mark Paid Off"
2. Confirmation dialog: "Mark mortgage as paid off? Balance will be set to $0."
3. Updates debt: `current_balance = 0`, `status = 'paid_off'`
4. Property shows "Owned outright"

### 4. View Payment History

**Use Case:** See all payments made toward mortgage.

**Implementation:**
- Query flows where `debt_id = mortgage.id`
- Show date, total payment, interest portion, principal portion
- Calculate from amortization or store in flow metadata

---

## Data Model Changes

### Option A: Add status to debts (Recommended)

```sql
ALTER TABLE debts ADD COLUMN status VARCHAR(20) DEFAULT 'active';
-- Values: 'active', 'paid_off', 'refinanced'
```

### Option B: Use current_balance = 0 for paid off

No schema change, just convention.

---

## API Endpoints

Existing endpoints should suffice:

| Action | Endpoint | Notes |
|--------|----------|-------|
| Add mortgage | `POST /api/debts` | With `property_asset_id` |
| Edit mortgage | `PUT /api/debts/:id` | Update terms |
| Pay off | `PUT /api/debts/:id` | Set balance to 0 |
| Get property mortgage | `GET /api/debts?property_asset_id=xxx` | Filter by property |
| Payment history | `GET /api/flows?debt_id=xxx` | Flows linked to debt |

---

## Implementation Phases

### Phase 1: View Integration
- [ ] Show mortgage info on real estate asset card
- [ ] Calculate and display net equity
- [ ] Show LTV (Loan-to-Value) ratio

### Phase 2: Mortgage Tab in Edit Dialog ✅ COMPLETED
- [x] Add tab navigation to real estate edit dialog
- [x] Display mortgage details with status (active/paid off)
- [x] Show "No mortgage" state with add button
- [x] Display key info: balance, rate, monthly payment, remaining term

### Phase 3: Mortgage Actions ✅ COMPLETED
- [x] Add Mortgage form (to existing property)
- [x] Edit Terms form
- [x] Mark Paid Off action
- [x] Multiple mortgages per property support

### Phase 4: Payment Tracking
- [ ] List payment history in mortgage tab
- [ ] Link "Pay Debt" flows to mortgage
- [ ] Show interest vs principal breakdown

### Phase 5: Advanced (Future)
- [ ] Refinance workflow with history
- [ ] Amortization schedule view
- [ ] Payoff projection calculator

---

## Notes

- Keep Phase 1-2 simple, get user feedback before Phase 3+
- Consider mobile layout for mortgage tab
- LTV calculation: `mortgage_balance / property_value * 100`
- Net equity: `property_value - mortgage_balance`
