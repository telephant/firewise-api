# FIRE Planning System - Flow Freedom & Runway

## Overview

Two core features that work together to help users understand their path to financial independence:

| Feature | Question It Answers |
|---------|---------------------|
| **Flow Freedom** | Can I live on passive income alone? When? |
| **Runway** | If not, how long will my money last? |

**Key Principle**: Everything is calculated from actual data — no manual goal setting required.

---

## Core Concepts

### Flow Freedom

**Definition**: When passive income covers 100% of expenses — no need to touch principal.

```
Flow Freedom % = Passive Income / Target Annual Expenses
```

This is smarter than the traditional 4% rule because:
- It calculates **actual** income your assets generate
- Dividends, rent, interest — real money, not theoretical withdrawal
- You never touch principal

### Runway

**Definition**: How long your money lasts when Flow Freedom < 100%.

Combines:
- Passive income (ongoing, sustainable)
- Principal drawdown (selling assets to cover gap)
- Asset growth (stocks appreciate over time)
- Debt payoff (expenses decrease when debts are paid)

---

## 1. Flow Freedom

### What It Shows

```
┌─────────────────────────────────────────────────────────────┐
│  FLOW FREEDOM                                               │
│                                                             │
│  TODAY                                                      │
│  ─────                                                      │
│  Passive Income:     $26,900/year                           │
│  Expenses:           $56,400/year (with debt payments)      │
│  Flow Freedom:       47.7%                                  │
│  ████████████░░░░░░░░░░░░░                                  │
│                                                             │
│  AFTER DEBTS PAID (Year 25)                                 │
│  ──────────────────────────                                 │
│  Expenses:           $30,000/year                           │
│  Flow Freedom:       89.7%                                  │
│  ██████████████████████░░░                                  │
│                                                             │
│  TIME TO 100% FLOW FREEDOM                                  │
│  ─────────────────────────                                  │
│  Based on 8 months data: ~3.2 years                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Data Sources (All Automatic)

| Data | Source | User Input? |
|------|--------|-------------|
| Passive Income | Sum of flows: `dividend`, `rental`, `interest` | ❌ No |
| Expenses | Linked ledger expenses + local `expense` flows | ❌ No |
| Debt Payments | From `debts` table (`monthly_payment × 12`) | ❌ No |
| Historical Trend | Past flows grouped by month | ❌ No |

### Calculations

```typescript
// Flow Freedom %
flowFreedom = passiveIncome / targetExpenses

// Expenses breakdown
totalExpenses = livingExpenses + debtPayments
debtFreeExpenses = livingExpenses  // After debts paid

// Time to Freedom (historical trend)
monthlyData = getPassiveIncomeByMonth(flows)
growthRate = calculateTrend(monthlyData)
timeToFreedom = projectWhenReachesTarget(current, target, growthRate)
```

### Time to Flow Freedom - Cold Start

When user doesn't have 12 months of data:

| Data Available | Strategy |
|----------------|----------|
| < 1 month | Cannot calculate, show "Keep tracking!" |
| 1-3 months | Extrapolate, mark as "Early estimate" |
| 3-6 months | More confident, still show warning |
| 6-12 months | Good estimate |
| 12+ months | Reliable projection |

---

## 2. Runway

### What It Shows

```
┌─────────────────────────────────────────────────────────────┐
│  RUNWAY PROJECTION                                          │
│                                                             │
│  YOUR NUMBERS                                               │
│  ────────────                                               │
│  Net Worth:          $505,000 (Assets - Debts)              │
│  Passive Income:     $26,900/year                           │
│  Expenses:           $56,400/year                           │
│  Annual Gap:         $29,500                                │
│  Portfolio Growth:   6.2% (weighted avg)                    │
│                                                             │
│  ═══════════════════════════════════════════════════════    │
│  YOUR MONEY WILL LAST: 38 years                             │
│  ═══════════════════════════════════════════════════════    │
│                                                             │
│  [Chart showing net worth over time]                        │
│                                                             │
│  Year 0   ████████████████████████████████  $505k           │
│  Year 10  ██████████████████████████████████████  $620k     │
│  Year 25  ████████████████████████  $380k (mortgage done)   │
│  Year 38  ░░  $0                                            │
│                                                             │
│  💡 After mortgage payoff (Year 25), expenses drop          │
│     to $30,000 — extending your runway significantly.       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Data Sources (All Automatic)

| Data | Source | User Input? |
|------|--------|-------------|
| Assets | `assets` table (sum of all values) | ❌ No |
| Debts | `debts` table (sum of `current_balance`) | ❌ No |
| Growth Rate | Yahoo Finance API for stocks/ETFs, defaults for others | ❌ No |
| Debt Payoff Schedule | Calculate from balance, rate, payment | ❌ No |

### Calculations

```typescript
function calculateRunway(
  assets: Asset[],
  debts: Debt[],
  passiveIncome: number,
  annualExpenses: number
) {
  let netWorth = sumAssets(assets) - sumDebts(debts);
  let expenses = annualExpenses;
  let income = passiveIncome;
  let year = 0;

  const projection = [];

  while (netWorth > 0 && year < 100) {
    // Calculate gap
    const gap = Math.max(0, expenses - income);

    // Withdraw gap from net worth
    netWorth -= gap;

    // Apply growth (weighted by asset types)
    const growthRate = calculateWeightedGrowth(assets);
    netWorth *= (1 + growthRate);

    // Check if any debts paid off this year
    debts = updateDebtBalances(debts);
    const paidOffPayments = getPaidOffDebtPayments(debts);
    expenses -= paidOffPayments;

    // Passive income may change (fewer assets = less dividends)
    income = recalculatePassiveIncome(netWorth, assets);

    projection.push({ year, netWorth, expenses, income, gap });
    year++;
  }

  return { yearsUntilZero: year, projection };
}
```

---

## 3. Growth Rates

### Source by Asset Type

| Asset Type | Source | Default |
|------------|--------|---------|
| Stocks/ETFs | Yahoo Finance API | 7% |
| Real Estate | User input or default | 3% |
| Cash/Deposits | 0% (interest is passive income) | 0% |
| Bonds | User input or default | 2% |
| Crypto | User input | 0% |

### Yahoo Finance API

Fetch 5-year historical growth for stocks/ETFs:

```typescript
async function getHistoricalGrowth(ticker: string, years: number = 5) {
  const endDate = Math.floor(Date.now() / 1000);
  const startDate = endDate - (years * 365 * 24 * 60 * 60);

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${startDate}&period2=${endDate}&interval=1mo`;

  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const data = await response.json();

  const result = data.chart.result[0];
  const closes = result.indicators.quote[0].close;
  const currentPrice = result.meta.regularMarketPrice;
  const firstPrice = closes[0];

  // Annualized return
  return Math.pow(currentPrice / firstPrice, 1 / years) - 1;
}

// Example results:
// AAPL: 27.4% annualized
// VTI:  ~12% annualized
// BND:  ~0% annualized
```

**Important**: Use `interval=1mo` and `indicators.quote[0].close` for accurate prices.

---

## 4. Debt Amortization

### Why It Matters

Debt payments are temporary expenses. When calculated correctly:
- Shows when debts will be paid off
- Projects how expenses decrease over time
- Makes runway projection more accurate

### Standard Amortization Formula

Works for most mortgages, car loans, personal loans:

```typescript
function calculateDebtSchedule(debt: Debt) {
  const { current_balance, interest_rate, monthly_payment } = debt;
  const monthlyRate = interest_rate / 12;

  let balance = current_balance;
  let month = 0;
  const schedule = [];

  while (balance > 0) {
    const interest = balance * monthlyRate;
    const principal = Math.min(monthly_payment - interest, balance);
    balance -= principal;

    schedule.push({
      month: ++month,
      interest,
      principal,
      balance
    });
  }

  return {
    monthsRemaining: month,
    payoffDate: addMonths(new Date(), month),
    schedule
  };
}
```

### Example Output

```
Mortgage: $280,000 @ 6% rate, $1,800/month payment

Month | Payment | Interest | Principal | Balance
──────┼─────────┼──────────┼───────────┼──────────
1     | $1,800  | $1,400   | $400      | $279,600
2     | $1,800  | $1,398   | $402      | $279,198
...
120   | $1,800  | $980     | $820      | $195,000
...
300   | $1,800  | $9       | $1,791    | $0

Payoff: 25 years (300 months)
```

---

## Data Model

### Asset Enhancement (Optional)

```sql
ALTER TABLE assets ADD COLUMN custom_growth_rate DECIMAL(5,4);
-- NULL = auto-fetch from Yahoo Finance (for stocks/ETFs with ticker)
-- NULL = use default by asset type (for real estate, etc.)
-- Value = user override
```

---

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/fire/flow-freedom` | Flow Freedom %, breakdown, time projection |
| GET | `/api/fire/runway` | Runway projection with yearly data |
| GET | `/api/fire/debt-schedule/:id` | Amortization schedule for a debt |
| GET | `/api/fire/growth-rate/:ticker` | Get historical growth rate from Yahoo |

### Response Examples

**GET /api/fire/flow-freedom**
```json
{
  "passiveIncome": 26900,
  "expenses": {
    "total": 56400,
    "living": 30000,
    "debtPayments": 26400
  },
  "flowFreedom": 0.477,
  "flowFreedomDebtFree": 0.897,
  "timeToFreedom": {
    "years": 3.2,
    "confidence": "medium",
    "dataMonths": 8
  }
}
```

**GET /api/fire/runway**
```json
{
  "netWorth": 505000,
  "passiveIncome": 26900,
  "expenses": 56400,
  "annualGap": 29500,
  "weightedGrowthRate": 0.062,
  "yearsUntilZero": 38,
  "projection": [
    { "year": 0, "netWorth": 505000, "expenses": 56400, "gap": 29500 },
    { "year": 1, "netWorth": 507000, "expenses": 56400, "gap": 29500 },
    // ...
    { "year": 25, "netWorth": 380000, "expenses": 30000, "gap": 3100 },
    // ...
    { "year": 38, "netWorth": 0, "expenses": 30000, "gap": 3100 }
  ]
}
```

---

## Implementation Phases

### Phase 1: Flow Freedom
- [ ] Calculate passive income from flows (dividend, rental, interest)
- [ ] Calculate expenses from flows + linked ledgers
- [ ] Flow Freedom % calculation
- [ ] API endpoint: `GET /api/fire/flow-freedom`
- [ ] Display component with progress bar

### Phase 2: Time to Freedom
- [ ] Historical passive income by month
- [ ] Trend calculation
- [ ] Projection to target
- [ ] Confidence indicator based on data available

### Phase 3: Debt Amortization
- [ ] Standard amortization calculation
- [ ] Debt schedule API endpoint: `GET /api/fire/debt-schedule/:id`
- [ ] Interest vs principal breakdown
- [ ] Payoff date projection

### Phase 4: Growth Rates
- [ ] Yahoo Finance API integration: `GET /api/fire/growth-rate/:ticker`
- [ ] Cache growth rates (daily refresh)
- [ ] Default rates by asset type
- [ ] Optional: user override via `custom_growth_rate` field

### Phase 5: Runway Projection
- [ ] Net worth calculation (assets - debts)
- [ ] Weighted growth rate calculation
- [ ] Year-by-year projection with debt payoff events
- [ ] API endpoint: `GET /api/fire/runway`
- [ ] Chart visualization
- [ ] Runway display component

---

## Key Insights

1. **No Manual Input Required**: Everything calculated from actual data (flows, assets, debts). User just uses the app and sees results.

2. **Flow Freedom > 4% Rule**: Based on actual passive income, not theoretical withdrawal.

3. **Debt Payoff = Hidden Freedom**: Paying off mortgage doesn't just reduce debt — it reduces target expenses, making Flow Freedom easier to reach.

4. **Two Paths to Freedom**:
   - Increase passive income (dividends, rent)
   - Decrease expenses (pay off debt)

5. **Growth Matters for Runway**: Even at 50% Flow Freedom, portfolio growth can extend runway to 30+ years.

6. **Real Data > Assumptions**: Using Yahoo Finance for actual stock growth, actual expense flows, actual debt terms — not theoretical numbers.

---

## Future Enhancements (Optional)

If users want to customize:
- Custom target expenses (different from actual spending)
- Retirement vs current spending scenarios
- Manual growth rate overrides

These can be added later via a `fire_goals` table, but are not required for MVP.
