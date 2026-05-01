# DCA Recurring Investment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a DCA (定投) feature to the Portfolio module — users define recurring investment plans, the backend generates pending confirmation records when plans come due, and users confirm with actual price/shares to create real trades.

**Architecture:** Two new DB tables (`dca_plans`, `dca_pending`) with RLS via portfolio join. Backend controller + routes for CRUD and confirm/skip. A daily cron task generates pending records with suggested prices. Frontend has a standalone DCA page, a portfolio tab, and a sidebar badge for pending count.

**Tech Stack:** TypeScript, Express, Supabase (supabaseAdmin), Next.js 15, Fire UI (inline styles, colors object), existing `fetchStockPrices` from `src/utils/findata-client`

---

## File Map

**Backend (firewise-api):**
- Delete: `src/controllers/recurring-schedule.controller.ts`
- Delete: `src/routes/recurring-schedule.routes.ts`
- Delete: `tasks/process-recurring.task.ts`
- Modify: `src/routes/index.ts` — remove recurring import/route, add dca route
- Modify: `src/controllers/debt.controller.ts` — remove recurring_frequency block (lines ~735–795)
- Modify: `src/controllers/family.controller.ts` — remove recurring_schedules migrate block (lines ~1139–1146)
- Modify: `src/types/index.ts` — remove RecurringSchedule-related types
- Modify: `tasks/index.ts` — remove ProcessRecurringTask, add ProcessDcaTask
- Modify: `tasks/tasks.config.json` — replace process-recurring with process-dca
- Modify: `supabase/migrations/001_migration.sql` — append dca_plans + dca_pending tables + RLS
- Create: `src/controllers/dca.controller.ts`
- Create: `src/routes/dca.routes.ts`
- Create: `tasks/process-dca.task.ts`

**Frontend (firewise-web):**
- Modify: `src/lib/fire/api.ts` — add DcaPlan, DcaPending interfaces + dcaApi
- Modify: `src/components/fire/portfolio-sidebar.tsx` — add DCA nav item with pending badge
- Modify: `src/app/(fire)/fire/portfolios/[id]/page.tsx` — add DCA tab
- Create: `src/components/fire/dca-plan-dialog.tsx`
- Create: `src/components/fire/dca-pending-card.tsx`
- Create: `src/app/(fire)/fire/dca/page.tsx`

---

### Task 1: Clean up dead recurring-schedule code (backend)

**Files:**
- Delete: `src/controllers/recurring-schedule.controller.ts`
- Delete: `src/routes/recurring-schedule.routes.ts`
- Delete: `tasks/process-recurring.task.ts`
- Modify: `src/routes/index.ts`
- Modify: `src/controllers/debt.controller.ts`
- Modify: `src/controllers/family.controller.ts`
- Modify: `src/types/index.ts`
- Modify: `tasks/index.ts`
- Modify: `tasks/tasks.config.json`

- [ ] **Step 1: Delete the three dead files**

```bash
rm /Users/telephant/projects/firewise/firewise-api/src/controllers/recurring-schedule.controller.ts
rm /Users/telephant/projects/firewise/firewise-api/src/routes/recurring-schedule.routes.ts
rm /Users/telephant/projects/firewise/firewise-api/tasks/process-recurring.task.ts
```

- [ ] **Step 2: Remove recurring route from `src/routes/index.ts`**

Remove these two lines from `src/routes/index.ts`:
```typescript
// DELETE this import (line 22):
import recurringScheduleRoutes from './recurring-schedule.routes';

// DELETE this route registration (line 73):
router.use('/fire/recurring-schedules', recurringScheduleRoutes);
```

- [ ] **Step 3: Remove recurring block from `src/controllers/debt.controller.ts`**

In `src/controllers/debt.controller.ts`, find and remove the entire block from `// Create recurring schedule if frequency is set` through the closing `}` of the if block (approximately lines 735–795). Also remove `recurring_frequency` from the destructure at the top of `createDebtTransaction` (it's in the `req.body` destructure around line 498) and from the `DebtTransactionRequest` interface field (line ~459). Also remove `schedule_id` from `DebtTransactionResult` interface and from the response object.

After editing, the `createDebtTransaction` pay branch should end with:
```typescript
res.status(201).json({
  success: true,
  data: {
    transaction_id: transaction.id,
    debt: updatedDebt,
    from_asset: fromAsset,
  },
});
```

- [ ] **Step 4: Remove recurring migrate block from `src/controllers/family.controller.ts`**

Find and remove just these lines (~1139–1146):
```typescript
  // Migrate recurring schedules
  const { data: schedulesData, error: schedulesError } = await supabaseAdmin
    .from('recurring_schedules')
    .update({ belong_id: familyId })
    .eq('belong_id', userId)
    .select('id');
  if (schedulesError) console.error('[Family] Schedules migration error:', schedulesError);
  results.schedules = schedulesData?.length || 0;
```

Also remove `schedules` from the `results` object type if it exists there.

- [ ] **Step 5: Remove RecurringSchedule types from `src/types/index.ts`**

Find and remove these type definitions (approximately lines 289–327):
```typescript
// DELETE from:
// Recurring Schedule types
export type ScheduleFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

export interface TransactionTemplate { ... }

export interface RecurringSchedule { ... }

export interface RecurringScheduleFilters extends PaginationParams { ... }

export interface ProcessRecurringResult { ... }
// DELETE to here (end of ProcessRecurringResult)
```

- [ ] **Step 6: Remove ProcessRecurringTask from `tasks/index.ts`**

Remove:
```typescript
// DELETE this import:
import { ProcessRecurringTask } from './process-recurring.task';

// DELETE from TASK_FACTORY:
'process-recurring': () => new ProcessRecurringTask(),

// DELETE from TASKS registry:
'process-recurring': () => new ProcessRecurringTask().run(),
```

Also update the header comment to remove the `- process-recurring: ...` line.

- [ ] **Step 7: Update `tasks/tasks.config.json`**

Replace `process-recurring` with `process-dca` in the dailyTasks array:
```json
{
  "dailyTasks": [
    "update-currency",
    "process-dca",
    "check-dividends",
    "update-growth-rates",
    "generate-monthly-snapshot"
  ]
}
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
cd /Users/telephant/projects/firewise/firewise-api && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors (or only errors about process-dca not existing yet — that's OK, we'll fix in Task 2).

- [ ] **Step 9: Commit**

```bash
cd /Users/telephant/projects/firewise/firewise-api
git add -A
git commit -m "chore: remove dead recurring-schedule code"
```

---

### Task 2: Add DB migration for dca_plans and dca_pending

**Files:**
- Modify: `supabase/migrations/001_migration.sql`

- [ ] **Step 1: Append the two new tables + RLS to `supabase/migrations/001_migration.sql`**

Add at the very end of the file:

```sql
-- ── DCA Plans ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dca_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id    UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  ticker          TEXT NOT NULL,
  market          TEXT NOT NULL CHECK (market IN ('US', 'SGX', 'HK', 'CN')),
  currency        TEXT NOT NULL,
  frequency       TEXT NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
  mode            TEXT NOT NULL CHECK (mode IN ('amount', 'shares')),
  amount          DECIMAL(18,8),
  shares          DECIMAL(18,8),
  next_run_date   DATE NOT NULL,
  last_run_date   DATE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE dca_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dca_plans_access" ON dca_plans
  USING (portfolio_id IN (
    SELECT id FROM portfolios
    WHERE belong_id = auth.uid()
       OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  ));

-- ── DCA Pending ────────────────────────────────────────────────────────��──

CREATE TABLE IF NOT EXISTS dca_pending (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dca_plan_id       UUID NOT NULL REFERENCES dca_plans(id) ON DELETE CASCADE,
  portfolio_id      UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  ticker            TEXT NOT NULL,
  market            TEXT NOT NULL,
  currency          TEXT NOT NULL,
  scheduled_date    DATE NOT NULL,
  mode              TEXT NOT NULL CHECK (mode IN ('amount', 'shares')),
  amount            DECIMAL(18,8),
  shares            DECIMAL(18,8),
  suggested_price   DECIMAL(18,8),
  suggested_shares  DECIMAL(18,8),
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'skipped')),
  confirmed_price   DECIMAL(18,8),
  confirmed_shares  DECIMAL(18,8),
  trade_id          UUID REFERENCES trades(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE dca_pending ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dca_pending_access" ON dca_pending
  USING (portfolio_id IN (
    SELECT id FROM portfolios
    WHERE belong_id = auth.uid()
       OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  ));
```

- [ ] **Step 2: Run migration against Supabase**

```bash
cd /Users/telephant/projects/firewise/firewise-api
supabase db push --linked
```

Expected: migration applied successfully. If it says tables already exist (IF NOT EXISTS), that's fine.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/001_migration.sql
git commit -m "feat: add dca_plans and dca_pending tables to migration"
```

---

### Task 3: Backend DCA controller and routes

**Files:**
- Create: `src/controllers/dca.controller.ts`
- Create: `src/routes/dca.routes.ts`
- Modify: `src/routes/index.ts`

- [ ] **Step 1: Create `src/controllers/dca.controller.ts`**

```typescript
import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { AppError } from '../middleware/error';
import { getViewContext } from '../utils/family-context';

export interface DcaPlan {
  id: string;
  portfolio_id: string;
  ticker: string;
  market: string;
  currency: string;
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
  mode: 'amount' | 'shares';
  amount: number | null;
  shares: number | null;
  next_run_date: string;
  last_run_date: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DcaPending {
  id: string;
  dca_plan_id: string;
  portfolio_id: string;
  ticker: string;
  market: string;
  currency: string;
  scheduled_date: string;
  mode: 'amount' | 'shares';
  amount: number | null;
  shares: number | null;
  suggested_price: number | null;
  suggested_shares: number | null;
  status: 'pending' | 'confirmed' | 'skipped';
  confirmed_price: number | null;
  confirmed_shares: number | null;
  trade_id: string | null;
  created_at: string;
}

/** Returns belong_ids for the current context to filter portfolios */
async function getPortfolioIds(belongId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('portfolios')
    .select('id')
    .eq('belong_id', belongId);
  return (data || []).map((p: { id: string }) => p.id);
}

function advanceDate(date: string, frequency: DcaPlan['frequency']): string {
  const d = new Date(date);
  switch (frequency) {
    case 'weekly':    d.setDate(d.getDate() + 7); break;
    case 'biweekly':  d.setDate(d.getDate() + 14); break;
    case 'monthly':   d.setMonth(d.getMonth() + 1); break;
    case 'quarterly': d.setMonth(d.getMonth() + 3); break;
    case 'yearly':    d.setFullYear(d.getFullYear() + 1); break;
  }
  return d.toISOString().split('T')[0];
}

// GET /fire/dca/plans
export const listPlans = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<DcaPlan[]>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const portfolioIds = await getPortfolioIds(ctx.belongId);

    const { data, error } = await supabaseAdmin
      .from('dca_plans')
      .select('*')
      .in('portfolio_id', portfolioIds.length ? portfolioIds : [''])
      .order('created_at', { ascending: false });

    if (error) throw new AppError('Failed to fetch DCA plans', 500);
    res.json({ success: true, data: data || [] });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch DCA plans' });
  }
};

// POST /fire/dca/plans
export const createPlan = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<DcaPlan>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const { portfolio_id, ticker, market, currency, frequency, mode, amount, shares, start_date, notes } = req.body;

    if (!portfolio_id || !ticker || !market || !currency || !frequency || !mode || !start_date) {
      throw new AppError('portfolio_id, ticker, market, currency, frequency, mode, and start_date are required', 400);
    }
    if (!['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'].includes(frequency)) {
      throw new AppError('frequency must be weekly, biweekly, monthly, quarterly, or yearly', 400);
    }
    if (!['amount', 'shares'].includes(mode)) {
      throw new AppError('mode must be amount or shares', 400);
    }
    if (mode === 'amount' && (amount === undefined || amount === null)) {
      throw new AppError('amount is required when mode is amount', 400);
    }
    if (mode === 'shares' && (shares === undefined || shares === null)) {
      throw new AppError('shares is required when mode is shares', 400);
    }

    // Verify portfolio belongs to current context
    const { data: portfolio } = await supabaseAdmin
      .from('portfolios')
      .select('id')
      .eq('id', portfolio_id)
      .eq('belong_id', ctx.belongId)
      .single();
    if (!portfolio) throw new AppError('Portfolio not found', 404);

    const { data, error } = await supabaseAdmin
      .from('dca_plans')
      .insert({
        portfolio_id,
        ticker: ticker.toUpperCase(),
        market,
        currency,
        frequency,
        mode,
        amount: mode === 'amount' ? Number(amount) : null,
        shares: mode === 'shares' ? Number(shares) : null,
        next_run_date: start_date,
        notes: notes || null,
      })
      .select()
      .single();

    if (error || !data) throw new AppError('Failed to create DCA plan', 500);
    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to create DCA plan' });
  }
};

// PUT /fire/dca/plans/:id
export const updatePlan = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<DcaPlan>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const planId = req.params.id;
    const portfolioIds = await getPortfolioIds(ctx.belongId);

    // Verify ownership
    const { data: existing } = await supabaseAdmin
      .from('dca_plans')
      .select('id')
      .eq('id', planId)
      .in('portfolio_id', portfolioIds.length ? portfolioIds : [''])
      .single();
    if (!existing) throw new AppError('DCA plan not found', 404);

    const { frequency, mode, amount, shares, next_run_date, is_active, notes } = req.body;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (frequency !== undefined) updates.frequency = frequency;
    if (mode !== undefined) updates.mode = mode;
    if (amount !== undefined) updates.amount = amount !== null ? Number(amount) : null;
    if (shares !== undefined) updates.shares = shares !== null ? Number(shares) : null;
    if (next_run_date !== undefined) updates.next_run_date = next_run_date;
    if (is_active !== undefined) updates.is_active = is_active;
    if (notes !== undefined) updates.notes = notes;

    const { data, error } = await supabaseAdmin
      .from('dca_plans')
      .update(updates)
      .eq('id', planId)
      .select()
      .single();

    if (error || !data) throw new AppError('Failed to update DCA plan', 500);
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to update DCA plan' });
  }
};

// DELETE /fire/dca/plans/:id
export const deletePlan = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<null>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const planId = req.params.id;
    const portfolioIds = await getPortfolioIds(ctx.belongId);

    const { data: existing } = await supabaseAdmin
      .from('dca_plans')
      .select('id')
      .eq('id', planId)
      .in('portfolio_id', portfolioIds.length ? portfolioIds : [''])
      .single();
    if (!existing) throw new AppError('DCA plan not found', 404);

    const { error } = await supabaseAdmin
      .from('dca_plans')
      .delete()
      .eq('id', planId);

    if (error) throw new AppError('Failed to delete DCA plan', 500);
    res.json({ success: true, data: null });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to delete DCA plan' });
  }
};

// GET /fire/dca/pending
export const listPending = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<DcaPending[]>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const { portfolio_id } = req.query;
    const portfolioIds = await getPortfolioIds(ctx.belongId);

    let query = supabaseAdmin
      .from('dca_pending')
      .select('*')
      .eq('status', 'pending')
      .in('portfolio_id', portfolioIds.length ? portfolioIds : [''])
      .order('scheduled_date', { ascending: true });

    if (portfolio_id) {
      query = query.eq('portfolio_id', portfolio_id as string);
    }

    const { data, error } = await query;
    if (error) throw new AppError('Failed to fetch pending DCA records', 500);
    res.json({ success: true, data: data || [] });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch pending DCA records' });
  }
};

// POST /fire/dca/pending/:id/confirm
export const confirmPending = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<DcaPending>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const pendingId = req.params.id;
    const { confirmed_price, confirmed_shares } = req.body;

    if (confirmed_price === undefined || confirmed_shares === undefined) {
      throw new AppError('confirmed_price and confirmed_shares are required', 400);
    }
    if (Number(confirmed_price) <= 0 || Number(confirmed_shares) <= 0) {
      throw new AppError('confirmed_price and confirmed_shares must be positive', 400);
    }

    // Fetch pending record + verify ownership
    const portfolioIds = await getPortfolioIds(ctx.belongId);
    const { data: pending } = await supabaseAdmin
      .from('dca_pending')
      .select('*')
      .eq('id', pendingId)
      .eq('status', 'pending')
      .in('portfolio_id', portfolioIds.length ? portfolioIds : [''])
      .single();

    if (!pending) throw new AppError('Pending DCA record not found', 404);

    // Create the trade
    const { data: trade, error: tradeError } = await supabaseAdmin
      .from('trades')
      .insert({
        portfolio_id: pending.portfolio_id,
        ticker: pending.ticker,
        market: pending.market,
        type: 'buy',
        shares: Number(confirmed_shares),
        price: Number(confirmed_price),
        currency: pending.currency,
        date: pending.scheduled_date,
        notes: `DCA`,
      })
      .select()
      .single();

    if (tradeError || !trade) throw new AppError('Failed to create trade', 500);

    // Update pending record
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('dca_pending')
      .update({
        status: 'confirmed',
        confirmed_price: Number(confirmed_price),
        confirmed_shares: Number(confirmed_shares),
        trade_id: trade.id,
      })
      .eq('id', pendingId)
      .select()
      .single();

    if (updateError || !updated) throw new AppError('Failed to update pending record', 500);
    res.json({ success: true, data: updated });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to confirm DCA pending' });
  }
};

// POST /fire/dca/pending/:id/skip
export const skipPending = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<DcaPending>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const pendingId = req.params.id;
    const portfolioIds = await getPortfolioIds(ctx.belongId);

    const { data: existing } = await supabaseAdmin
      .from('dca_pending')
      .select('id')
      .eq('id', pendingId)
      .eq('status', 'pending')
      .in('portfolio_id', portfolioIds.length ? portfolioIds : [''])
      .single();

    if (!existing) throw new AppError('Pending DCA record not found', 404);

    const { data, error } = await supabaseAdmin
      .from('dca_pending')
      .update({ status: 'skipped' })
      .eq('id', pendingId)
      .select()
      .single();

    if (error || !data) throw new AppError('Failed to skip pending record', 500);
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to skip DCA pending' });
  }
};

// POST /fire/dca/process  (manual trigger for testing)
export const processDca = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ processed: number }>>
): Promise<void> => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const { data: duePlans, error } = await supabaseAdmin
      .from('dca_plans')
      .select('*')
      .eq('is_active', true)
      .lte('next_run_date', today);

    if (error) throw new AppError('Failed to fetch due plans', 500);
    if (!duePlans || duePlans.length === 0) {
      res.json({ success: true, data: { processed: 0 } });
      return;
    }

    const { fetchStockPrices } = await import('../utils/findata-client');
    const tickers = [...new Set(duePlans.map((p: DcaPlan) => `${p.ticker}.${p.market}`))];
    const prices = await fetchStockPrices(tickers);

    let processed = 0;
    for (const plan of duePlans as DcaPlan[]) {
      const priceKey = `${plan.ticker}.${plan.market}`;
      const priceData = prices[priceKey] || prices[plan.ticker];
      const suggestedPrice = priceData?.price ?? null;
      const suggestedShares =
        plan.mode === 'amount' && suggestedPrice && plan.amount
          ? Math.round((plan.amount / suggestedPrice) * 1e6) / 1e6
          : null;

      const { error: insertError } = await supabaseAdmin.from('dca_pending').insert({
        dca_plan_id: plan.id,
        portfolio_id: plan.portfolio_id,
        ticker: plan.ticker,
        market: plan.market,
        currency: plan.currency,
        scheduled_date: plan.next_run_date,
        mode: plan.mode,
        amount: plan.amount,
        shares: plan.shares,
        suggested_price: suggestedPrice,
        suggested_shares: suggestedShares,
      });

      if (insertError) {
        console.error(`Failed to insert pending for plan ${plan.id}:`, insertError);
        continue;
      }

      const nextDate = advanceDate(plan.next_run_date, plan.frequency);
      await supabaseAdmin
        .from('dca_plans')
        .update({ last_run_date: plan.next_run_date, next_run_date: nextDate, updated_at: new Date().toISOString() })
        .eq('id', plan.id);

      processed++;
    }

    res.json({ success: true, data: { processed } });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to process DCA' });
  }
};
```

- [ ] **Step 2: Create `src/routes/dca.routes.ts`**

```typescript
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  listPlans,
  createPlan,
  updatePlan,
  deletePlan,
  listPending,
  confirmPending,
  skipPending,
  processDca,
} from '../controllers/dca.controller';

const router = Router();

router.get('/plans', authMiddleware, listPlans);
router.post('/plans', authMiddleware, createPlan);
router.put('/plans/:id', authMiddleware, updatePlan);
router.delete('/plans/:id', authMiddleware, deletePlan);

router.get('/pending', authMiddleware, listPending);
router.post('/pending/:id/confirm', authMiddleware, confirmPending);
router.post('/pending/:id/skip', authMiddleware, skipPending);

router.post('/process', authMiddleware, processDca);

export default router;
```

- [ ] **Step 3: Register DCA routes in `src/routes/index.ts`**

Add import at the top with other imports:
```typescript
import dcaRoutes from './dca.routes';
```

Add route registration in the Portfolio tracker section:
```typescript
router.use('/fire/dca', dcaRoutes);
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/telephant/projects/firewise/firewise-api && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/telephant/projects/firewise/firewise-api
git add src/controllers/dca.controller.ts src/routes/dca.routes.ts src/routes/index.ts
git commit -m "feat: add DCA controller and routes"
```

---

### Task 4: DCA cron task

**Files:**
- Create: `tasks/process-dca.task.ts`
- Modify: `tasks/index.ts`

- [ ] **Step 1: Create `tasks/process-dca.task.ts`**

```typescript
/**
 * Process DCA Task
 *
 * Generates pending confirmation records for DCA plans that are due today.
 * Fetches suggested prices from findata. Advances next_run_date.
 *
 * Usage: npx ts-node tasks/index.ts process-dca
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as findata from '../src/utils/findata-client';

dotenv.config();

interface DcaPlan {
  id: string;
  portfolio_id: string;
  ticker: string;
  market: string;
  currency: string;
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
  mode: 'amount' | 'shares';
  amount: number | null;
  shares: number | null;
  next_run_date: string;
}

function advanceDate(date: string, frequency: DcaPlan['frequency']): string {
  const d = new Date(date);
  switch (frequency) {
    case 'weekly':    d.setDate(d.getDate() + 7); break;
    case 'biweekly':  d.setDate(d.getDate() + 14); break;
    case 'monthly':   d.setMonth(d.getMonth() + 1); break;
    case 'quarterly': d.setMonth(d.getMonth() + 3); break;
    case 'yearly':    d.setFullYear(d.getFullYear() + 1); break;
  }
  return d.toISOString().split('T')[0];
}

export class ProcessDcaTask {
  private supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  async run(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    console.log(`[ProcessDca] Running for date: ${today}`);

    const { data: duePlans, error } = await this.supabase
      .from('dca_plans')
      .select('*')
      .eq('is_active', true)
      .lte('next_run_date', today);

    if (error) {
      console.error('[ProcessDca] Failed to fetch due plans:', error);
      return;
    }

    if (!duePlans || duePlans.length === 0) {
      console.log('[ProcessDca] No plans due today.');
      return;
    }

    console.log(`[ProcessDca] Found ${duePlans.length} due plans.`);

    // Batch fetch prices
    const tickers = [...new Set(duePlans.map((p: DcaPlan) => `${p.ticker}.${p.market}`))];
    let prices: Record<string, { price: number | null; currency: string }> = {};
    try {
      prices = await findata.fetchStockPrices(tickers);
    } catch (e) {
      console.error('[ProcessDca] Failed to fetch prices, continuing with null prices:', e);
    }

    let processed = 0;
    let failed = 0;

    for (const plan of duePlans as DcaPlan[]) {
      const priceKey = `${plan.ticker}.${plan.market}`;
      const priceData = prices[priceKey] || prices[plan.ticker] || null;
      const suggestedPrice = priceData?.price ?? null;
      const suggestedShares =
        plan.mode === 'amount' && suggestedPrice && plan.amount
          ? Math.round((plan.amount / suggestedPrice) * 1e6) / 1e6
          : null;

      const { error: insertError } = await this.supabase.from('dca_pending').insert({
        dca_plan_id: plan.id,
        portfolio_id: plan.portfolio_id,
        ticker: plan.ticker,
        market: plan.market,
        currency: plan.currency,
        scheduled_date: plan.next_run_date,
        mode: plan.mode,
        amount: plan.amount,
        shares: plan.shares,
        suggested_price: suggestedPrice,
        suggested_shares: suggestedShares,
      });

      if (insertError) {
        console.error(`[ProcessDca] Failed to insert pending for plan ${plan.id}:`, insertError);
        failed++;
        continue;
      }

      const nextDate = advanceDate(plan.next_run_date, plan.frequency);
      const { error: updateError } = await this.supabase
        .from('dca_plans')
        .update({
          last_run_date: plan.next_run_date,
          next_run_date: nextDate,
          updated_at: new Date().toISOString(),
        })
        .eq('id', plan.id);

      if (updateError) {
        console.error(`[ProcessDca] Failed to advance plan ${plan.id}:`, updateError);
      }

      console.log(`[ProcessDca] Plan ${plan.id} (${plan.ticker}): pending created, next_run=${nextDate}`);
      processed++;
    }

    console.log(`[ProcessDca] Done. processed=${processed}, failed=${failed}`);
  }
}
```

- [ ] **Step 2: Register ProcessDcaTask in `tasks/index.ts`**

Add import:
```typescript
import { ProcessDcaTask } from './process-dca.task';
```

Add to TASK_FACTORY:
```typescript
'process-dca': () => new ProcessDcaTask(),
```

Add to TASKS registry:
```typescript
'process-dca': () => new ProcessDcaTask().run(),
```

Update the header comment to add:
```
 * - process-dca: Generate pending DCA confirmation records for due plans
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/telephant/projects/firewise/firewise-api && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/telephant/projects/firewise/firewise-api
git add tasks/process-dca.task.ts tasks/index.ts tasks/tasks.config.json
git commit -m "feat: add process-dca task for generating pending DCA records"
```

---

### Task 5: Frontend API types and dcaApi

**Files:**
- Modify: `src/lib/fire/api.ts`

- [ ] **Step 1: Add DCA types and dcaApi to `src/lib/fire/api.ts`**

Append at the end of the file:

```typescript
// ── DCA ────────────────────────────────────────────────────────────────────

export type DcaFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
export type DcaMode = 'amount' | 'shares';

export interface DcaPlan {
  id: string;
  portfolio_id: string;
  ticker: string;
  market: string;
  currency: string;
  frequency: DcaFrequency;
  mode: DcaMode;
  amount: number | null;
  shares: number | null;
  next_run_date: string;
  last_run_date: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DcaPending {
  id: string;
  dca_plan_id: string;
  portfolio_id: string;
  ticker: string;
  market: string;
  currency: string;
  scheduled_date: string;
  mode: DcaMode;
  amount: number | null;
  shares: number | null;
  suggested_price: number | null;
  suggested_shares: number | null;
  status: 'pending' | 'confirmed' | 'skipped';
  confirmed_price: number | null;
  confirmed_shares: number | null;
  trade_id: string | null;
  created_at: string;
}

export interface CreateDcaPlanData {
  portfolio_id: string;
  ticker: string;
  market: string;
  currency: string;
  frequency: DcaFrequency;
  mode: DcaMode;
  amount?: number;
  shares?: number;
  start_date: string;
  notes?: string;
}

export const dcaApi = {
  listPlans: () => fetchApi<DcaPlan[]>('/fire/dca/plans'),
  createPlan: (data: CreateDcaPlanData) =>
    fetchApi<DcaPlan>('/fire/dca/plans', { method: 'POST', body: JSON.stringify(data) }),
  updatePlan: (id: string, data: Partial<CreateDcaPlanData & { is_active: boolean; next_run_date: string }>) =>
    fetchApi<DcaPlan>(`/fire/dca/plans/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePlan: (id: string) =>
    fetchApi(`/fire/dca/plans/${id}`, { method: 'DELETE' }),
  listPending: (portfolioId?: string) => {
    const q = portfolioId ? `?portfolio_id=${portfolioId}` : '';
    return fetchApi<DcaPending[]>(`/fire/dca/pending${q}`);
  },
  confirmPending: (id: string, data: { confirmed_price: number; confirmed_shares: number }) =>
    fetchApi<DcaPending>(`/fire/dca/pending/${id}/confirm`, { method: 'POST', body: JSON.stringify(data) }),
  skipPending: (id: string) =>
    fetchApi<DcaPending>(`/fire/dca/pending/${id}/skip`, { method: 'POST' }),
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/telephant/projects/firewise/firewise-web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/telephant/projects/firewise/firewise-web
git add src/lib/fire/api.ts
git commit -m "feat: add DcaPlan/DcaPending types and dcaApi"
```

---

### Task 6: DCA Plan Dialog component

**Files:**
- Create: `src/components/fire/dca-plan-dialog.tsx`

- [ ] **Step 1: Create `src/components/fire/dca-plan-dialog.tsx`**

```tsx
'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody,
  Button, Input, Label, Select, colors, CurrencyCombobox, DateInput,
} from '@/components/fire/ui';
import { dcaApi, DcaPlan, CreateDcaPlanData, DcaFrequency, DcaMode } from '@/lib/fire/api';
import { StockTickerInput } from '@/components/fire/stock-ticker-input';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  portfolioId: string;
  defaultCurrency?: string;
  editPlan?: DcaPlan;
  onSuccess: (plan: DcaPlan) => void;
}

const FREQUENCY_OPTIONS: { value: DcaFrequency; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

export function DcaPlanDialog({ open, onOpenChange, portfolioId, defaultCurrency = 'USD', editPlan, onSuccess }: Props) {
  const isEdit = !!editPlan;
  const [ticker, setTicker] = useState('');
  const [tickerName, setTickerName] = useState('');
  const [market, setMarket] = useState('US');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [frequency, setFrequency] = useState<DcaFrequency>('monthly');
  const [mode, setMode] = useState<DcaMode>('amount');
  const [amount, setAmount] = useState('');
  const [shares, setShares] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && editPlan) {
      setTicker(editPlan.ticker);
      setMarket(editPlan.market);
      setCurrency(editPlan.currency);
      setFrequency(editPlan.frequency);
      setMode(editPlan.mode);
      setAmount(editPlan.amount !== null ? String(editPlan.amount) : '');
      setShares(editPlan.shares !== null ? String(editPlan.shares) : '');
      setStartDate(editPlan.next_run_date);
      setNotes(editPlan.notes || '');
      setError(null);
    } else if (!open) {
      setTicker(''); setTickerName(''); setMarket('US'); setCurrency(defaultCurrency);
      setFrequency('monthly'); setMode('amount'); setAmount(''); setShares('');
      setStartDate(new Date().toISOString().split('T')[0]); setNotes(''); setError(null);
    }
  }, [open, editPlan, defaultCurrency]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const data: CreateDcaPlanData = {
      portfolio_id: portfolioId,
      ticker: ticker.toUpperCase(),
      market,
      currency,
      frequency,
      mode,
      start_date: startDate,
      notes: notes || undefined,
      ...(mode === 'amount' ? { amount: parseFloat(amount) } : { shares: parseFloat(shares) }),
    };

    const result = isEdit
      ? await dcaApi.updatePlan(editPlan!.id, { ...data, next_run_date: startDate })
      : await dcaApi.createPlan(data);

    setLoading(false);
    if (result.success && result.data) {
      onSuccess(result.data);
    } else {
      setError(result.error || 'Failed to save DCA plan');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit DCA Plan' : 'New DCA Plan'}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {error && <p style={{ fontSize: 13, color: colors.negative, margin: 0 }}>{error}</p>}

            <StockTickerInput
              label="Ticker"
              value={ticker}
              selectedName={tickerName}
              onChange={(t, name) => { setTicker(t); setTickerName(name); }}
              region={market}
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Label>Market</Label>
              <Select value={market} onChange={(e) => setMarket(e.target.value)}
                options={[
                  { value: 'US', label: 'US' }, { value: 'SGX', label: 'SGX' },
                  { value: 'HK', label: 'HK' }, { value: 'CN', label: 'CN' },
                ]}
              />
            </div>

            <CurrencyCombobox value={currency} onChange={setCurrency} label="Currency" />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Label>Frequency</Label>
              <Select value={frequency} onChange={(e) => setFrequency(e.target.value as DcaFrequency)}
                options={FREQUENCY_OPTIONS}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Label>Investment Mode</Label>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button type="button" variant={mode === 'amount' ? 'primary' : 'outline'}
                  style={{ flex: 1 }} onClick={() => setMode('amount')}>
                  Fixed Amount
                </Button>
                <Button type="button" variant={mode === 'shares' ? 'primary' : 'outline'}
                  style={{ flex: 1 }} onClick={() => setMode('shares')}>
                  Fixed Shares
                </Button>
              </div>
            </div>

            {mode === 'amount' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Label>Amount per period</Label>
                <Input type="number" min="0" step="any" value={amount}
                  onChange={(e) => setAmount(e.target.value)} required placeholder="500" />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Label>Shares per period</Label>
                <Input type="number" min="0" step="any" value={shares}
                  onChange={(e) => setShares(e.target.value)} required placeholder="1" />
              </div>
            )}

            <DateInput value={startDate} onChange={setStartDate} label={isEdit ? 'Next Run Date' : 'First Run Date'} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Label>Notes (optional)</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
            </div>

            <Button type="submit" disabled={loading} style={{ width: '100%' }}>
              {loading ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Plan'}
            </Button>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/telephant/projects/firewise/firewise-web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/telephant/projects/firewise/firewise-web
git add src/components/fire/dca-plan-dialog.tsx
git commit -m "feat: add DcaPlanDialog component"
```

---

### Task 7: DCA Pending Card component

**Files:**
- Create: `src/components/fire/dca-pending-card.tsx`

- [ ] **Step 1: Create `src/components/fire/dca-pending-card.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { colors, Button, Input, Label } from '@/components/fire/ui';
import { dcaApi, DcaPending } from '@/lib/fire/api';

interface Props {
  pending: DcaPending;
  onConfirmed: (id: string) => void;
  onSkipped: (id: string) => void;
}

export function DcaPendingCard({ pending, onConfirmed, onSkipped }: Props) {
  const [price, setPrice] = useState(
    pending.suggested_price !== null ? String(pending.suggested_price) : ''
  );
  const [shares, setShares] = useState(
    pending.mode === 'shares'
      ? String(pending.shares ?? '')
      : pending.suggested_shares !== null
      ? String(pending.suggested_shares)
      : ''
  );
  const [confirming, setConfirming] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!price || !shares) {
      setError('Price and shares are required');
      return;
    }
    setConfirming(true);
    setError(null);
    const result = await dcaApi.confirmPending(pending.id, {
      confirmed_price: parseFloat(price),
      confirmed_shares: parseFloat(shares),
    });
    setConfirming(false);
    if (result.success) {
      onConfirmed(pending.id);
    } else {
      setError(result.error || 'Failed to confirm');
    }
  };

  const handleSkip = async () => {
    setSkipping(true);
    await dcaApi.skipPending(pending.id);
    setSkipping(false);
    onSkipped(pending.id);
  };

  return (
    <div style={{
      backgroundColor: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 8,
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <span style={{ fontSize: 15, fontWeight: 700, color: colors.text }}>{pending.ticker}</span>
          <span style={{
            marginLeft: 8, fontSize: 11, fontWeight: 500,
            padding: '2px 6px', borderRadius: 4,
            backgroundColor: 'rgba(255,255,255,0.06)',
            color: colors.muted, border: `1px solid ${colors.border}`,
          }}>{pending.market}</span>
        </div>
        <span style={{ fontSize: 12, color: colors.muted }}>{pending.scheduled_date}</span>
      </div>

      {/* Plan info */}
      <div style={{ fontSize: 12, color: colors.muted }}>
        {pending.mode === 'amount'
          ? `Fixed amount: ${pending.currency} ${pending.amount}`
          : `Fixed shares: ${pending.shares}`}
        {pending.suggested_price && (
          <span style={{ marginLeft: 8, color: colors.info }}>
            Est. price: {pending.currency} {pending.suggested_price}
          </span>
        )}
      </div>

      {error && <p style={{ fontSize: 12, color: colors.negative, margin: 0 }}>{error}</p>}

      {/* Input fields */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Label>Price</Label>
          <Input
            type="number" min="0" step="any"
            value={price} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPrice(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Label>Shares</Label>
          <Input
            type="number" min="0" step="any"
            value={shares} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setShares(e.target.value)}
            placeholder="0"
          />
        </div>
      </div>

      {/* Total preview */}
      {price && shares && (
        <div style={{ fontSize: 12, color: colors.muted }}>
          Total: {pending.currency} {(parseFloat(price) * parseFloat(shares)).toFixed(2)}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={handleConfirm} disabled={confirming || skipping} style={{ flex: 1 }}>
          {confirming ? 'Confirming...' : 'Confirm'}
        </Button>
        <Button variant="ghost" onClick={handleSkip} disabled={confirming || skipping}
          style={{ color: colors.muted }}>
          {skipping ? '...' : 'Skip'}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/telephant/projects/firewise/firewise-web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/telephant/projects/firewise/firewise-web
git add src/components/fire/dca-pending-card.tsx
git commit -m "feat: add DcaPendingCard component"
```

---

### Task 8: Standalone DCA page + sidebar nav item

**Files:**
- Create: `src/app/(fire)/fire/dca/page.tsx`
- Modify: `src/components/fire/portfolio-sidebar.tsx`

- [ ] **Step 1: Create `src/app/(fire)/fire/dca/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { colors, Button, Loader } from '@/components/fire/ui';
import { dcaApi, DcaPlan, DcaPending } from '@/lib/fire/api';
import { portfolioApi, Portfolio } from '@/lib/fire/api';
import { DcaPlanDialog } from '@/components/fire/dca-plan-dialog';
import { DcaPendingCard } from '@/components/fire/dca-pending-card';

const FREQ_LABEL: Record<string, string> = {
  weekly: 'Weekly', biweekly: 'Bi-weekly', monthly: 'Monthly',
  quarterly: 'Quarterly', yearly: 'Yearly',
};

export default function DcaPage() {
  const [plans, setPlans] = useState<DcaPlan[]>([]);
  const [pending, setPending] = useState<DcaPending[]>([]);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editPlan, setEditPlan] = useState<DcaPlan | undefined>(undefined);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      dcaApi.listPlans(),
      dcaApi.listPending(),
      portfolioApi.list(),
    ]).then(([plansRes, pendingRes, portfoliosRes]) => {
      if (plansRes.success && plansRes.data) setPlans(plansRes.data);
      if (pendingRes.success && pendingRes.data) setPending(pendingRes.data);
      if (portfoliosRes.success && portfoliosRes.data) setPortfolios(portfoliosRes.data);
      setLoading(false);
    });
  }, []);

  function getPortfolioName(portfolioId: string): string {
    return portfolios.find(p => p.id === portfolioId)?.name || portfolioId.slice(0, 8);
  }

  const handlePlanSuccess = (plan: DcaPlan) => {
    setPlans(prev => {
      const idx = prev.findIndex(p => p.id === plan.id);
      return idx >= 0 ? prev.map(p => p.id === plan.id ? plan : p) : [plan, ...prev];
    });
    setDialogOpen(false);
    setEditPlan(undefined);
  };

  const handleDelete = async (planId: string) => {
    if (!confirm('Delete this DCA plan? Pending records will also be removed.')) return;
    setDeletingId(planId);
    const result = await dcaApi.deletePlan(planId);
    setDeletingId(null);
    if (result.success) {
      setPlans(prev => prev.filter(p => p.id !== planId));
      setPending(prev => prev.filter(p => p.dca_plan_id !== planId));
    }
  };

  const handleToggleActive = async (plan: DcaPlan) => {
    setTogglingId(plan.id);
    const result = await dcaApi.updatePlan(plan.id, { is_active: !plan.is_active });
    setTogglingId(null);
    if (result.success && result.data) {
      setPlans(prev => prev.map(p => p.id === plan.id ? result.data! : p));
    }
  };

  const activePlans = plans.filter(p => p.is_active);
  const pausedPlans = plans.filter(p => !p.is_active);

  // Pick a default portfolio for new plan dialog (first available)
  const defaultPortfolioId = portfolios[0]?.id || '';
  const defaultCurrency = portfolios[0]?.currency || 'USD';

  if (loading) {
    return (
      <div style={{ padding: 24, backgroundColor: colors.bg, minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Loader size="md" variant="bar" />
      </div>
    );
  }

  return (
    <div style={{ padding: 24, backgroundColor: colors.bg, minHeight: '100vh' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h1 style={{ color: colors.text, fontSize: 22, fontWeight: 700, margin: 0 }}>DCA Plans</h1>
          <Button onClick={() => { setEditPlan(undefined); setDialogOpen(true); }}>+ New Plan</Button>
        </div>

        {/* Pending Confirmations */}
        <div style={{ marginBottom: 32 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: colors.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
            Pending Confirmations {pending.length > 0 && (
              <span style={{ marginLeft: 6, backgroundColor: colors.accent, color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 11 }}>
                {pending.length}
              </span>
            )}
          </p>
          {pending.length === 0 ? (
            <p style={{ color: colors.muted, fontSize: 13 }}>No pending confirmations.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {pending.map(p => (
                <DcaPendingCard
                  key={p.id}
                  pending={p}
                  onConfirmed={(id) => setPending(prev => prev.filter(x => x.id !== id))}
                  onSkipped={(id) => setPending(prev => prev.filter(x => x.id !== id))}
                />
              ))}
            </div>
          )}
        </div>

        {/* Active Plans */}
        <div style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: colors.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
            Active Plans
          </p>
          {activePlans.length === 0 ? (
            <p style={{ color: colors.muted, fontSize: 13 }}>No active plans. Create one to get started.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                    {['Ticker', 'Portfolio', 'Frequency', 'Mode', 'Amount / Shares', 'Next Run', ''].map(h => (
                      <th key={h} style={{ paddingBottom: 8, paddingRight: 16, textAlign: 'left', color: colors.muted, fontWeight: 500, fontSize: 12 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activePlans.map(plan => (
                    <tr key={plan.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <td style={{ padding: '12px 16px 12px 0', fontWeight: 600, color: colors.text }}>
                        {plan.ticker}
                        <span style={{ marginLeft: 6, fontSize: 11, color: colors.muted }}>{plan.market}</span>
                      </td>
                      <td style={{ padding: '12px 16px 12px 0', color: colors.muted }}>{getPortfolioName(plan.portfolio_id)}</td>
                      <td style={{ padding: '12px 16px 12px 0', color: colors.text }}>{FREQ_LABEL[plan.frequency]}</td>
                      <td style={{ padding: '12px 16px 12px 0', color: colors.text }}>{plan.mode === 'amount' ? 'Amount' : 'Shares'}</td>
                      <td style={{ padding: '12px 16px 12px 0', color: colors.info }}>
                        {plan.mode === 'amount' ? `${plan.currency} ${plan.amount}` : `${plan.shares} shares`}
                      </td>
                      <td style={{ padding: '12px 16px 12px 0', color: colors.text }}>{plan.next_run_date}</td>
                      <td style={{ padding: '12px 0', display: 'flex', gap: 4 }}>
                        <Button variant="ghost" size="sm" onClick={() => { setEditPlan(plan); setDialogOpen(true); }}>Edit</Button>
                        <Button variant="ghost" size="sm" onClick={() => handleToggleActive(plan)} disabled={togglingId === plan.id} style={{ color: colors.muted }}>
                          {togglingId === plan.id ? '...' : 'Pause'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(plan.id)} disabled={deletingId === plan.id} style={{ color: colors.negative }}>
                          {deletingId === plan.id ? '...' : 'Delete'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Paused Plans */}
        {pausedPlans.length > 0 && (
          <div>
            <p style={{ fontSize: 12, fontWeight: 600, color: colors.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
              Paused Plans
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                    {['Ticker', 'Portfolio', 'Frequency', 'Mode', 'Amount / Shares', ''].map(h => (
                      <th key={h} style={{ paddingBottom: 8, paddingRight: 16, textAlign: 'left', color: colors.muted, fontWeight: 500, fontSize: 12 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pausedPlans.map(plan => (
                    <tr key={plan.id} style={{ borderBottom: `1px solid ${colors.border}`, opacity: 0.6 }}>
                      <td style={{ padding: '12px 16px 12px 0', fontWeight: 600, color: colors.text }}>
                        {plan.ticker}
                        <span style={{ marginLeft: 6, fontSize: 11, color: colors.muted }}>{plan.market}</span>
                      </td>
                      <td style={{ padding: '12px 16px 12px 0', color: colors.muted }}>{getPortfolioName(plan.portfolio_id)}</td>
                      <td style={{ padding: '12px 16px 12px 0', color: colors.text }}>{FREQ_LABEL[plan.frequency]}</td>
                      <td style={{ padding: '12px 16px 12px 0', color: colors.text }}>{plan.mode === 'amount' ? 'Amount' : 'Shares'}</td>
                      <td style={{ padding: '12px 16px 12px 0', color: colors.info }}>
                        {plan.mode === 'amount' ? `${plan.currency} ${plan.amount}` : `${plan.shares} shares`}
                      </td>
                      <td style={{ padding: '12px 0', display: 'flex', gap: 4 }}>
                        <Button variant="ghost" size="sm" onClick={() => handleToggleActive(plan)} disabled={togglingId === plan.id} style={{ color: colors.positive }}>
                          {togglingId === plan.id ? '...' : 'Resume'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(plan.id)} disabled={deletingId === plan.id} style={{ color: colors.negative }}>
                          {deletingId === plan.id ? '...' : 'Delete'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <DcaPlanDialog
        open={dialogOpen}
        onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditPlan(undefined); }}
        portfolioId={editPlan?.portfolio_id || defaultPortfolioId}
        defaultCurrency={editPlan?.currency || defaultCurrency}
        editPlan={editPlan}
        onSuccess={handlePlanSuccess}
      />
    </div>
  );
}
```

- [ ] **Step 2: Add DCA nav item with pending badge to `src/components/fire/portfolio-sidebar.tsx`**

Read the current sidebar file. Add the DCA nav item to the `navItems` array:

```typescript
// Add to navItems array after the Family item:
{
  label: 'DCA',
  href: '/fire/dca',
  icon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
},
```

Then add pending badge logic to `PortfolioSidebar`. Import `dcaApi` and add a `pendingCount` state:

```typescript
import { dcaApi } from '@/lib/fire/api';
// inside PortfolioSidebar():
const [pendingCount, setPendingCount] = useState(0);
useEffect(() => {
  dcaApi.listPending().then(res => {
    if (res.success && res.data) setPendingCount(res.data.length);
  });
}, []);
```

In the nav item render, add badge when rendering the DCA item:

```tsx
// Inside the navItems.map, after the label text, add:
{item.href === '/fire/dca' && pendingCount > 0 && (
  <span style={{
    marginLeft: 'auto',
    backgroundColor: colors.accent,
    color: '#fff',
    borderRadius: 10,
    padding: '1px 6px',
    fontSize: 10,
    fontWeight: 600,
    minWidth: 16,
    textAlign: 'center',
  }}>
    {pendingCount}
  </span>
)}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/telephant/projects/firewise/firewise-web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/telephant/projects/firewise/firewise-web
git add src/app/(fire)/fire/dca/page.tsx src/components/fire/portfolio-sidebar.tsx
git commit -m "feat: add standalone DCA page and sidebar nav with pending badge"
```

---

### Task 9: Add DCA tab to portfolio detail page

**Files:**
- Modify: `src/app/(fire)/fire/portfolios/[id]/page.tsx`

- [ ] **Step 1: Read the current file**

Read `src/app/(fire)/fire/portfolios/[id]/page.tsx` to see the current Tabs and imports.

- [ ] **Step 2: Add DCA imports**

Add to the existing imports:
```typescript
import { dcaApi, DcaPlan, DcaPending } from '@/lib/fire/api';
import { DcaPlanDialog } from '@/components/fire/dca-plan-dialog';
import { DcaPendingCard } from '@/components/fire/dca-pending-card';
```

- [ ] **Step 3: Add DCA state**

Inside `PortfolioDetail()`, after the existing state declarations, add:
```typescript
const [dcaPlans, setDcaPlans] = useState<DcaPlan[]>([]);
const [dcaPending, setDcaPending] = useState<DcaPending[]>([]);
const [dcaDialogOpen, setDcaDialogOpen] = useState(false);
const [editDcaPlan, setEditDcaPlan] = useState<DcaPlan | undefined>(undefined);
const [deletingDcaId, setDeletingDcaId] = useState<string | null>(null);
```

- [ ] **Step 4: Load DCA data in the existing useEffect**

In the `Promise.all` inside `useEffect`, add two more calls:
```typescript
Promise.all([
  portfolioApi.get(id),
  holdingApi.list(id),
  dividendApi.list(id),
  portfolioStatsApi.getStats(id),
  portfolioStatsApi.getSnapshots(id),
  dcaApi.listPlans(),        // add
  dcaApi.listPending(id),    // add
]).then(([portfolioRes, holdingsRes, dividendsRes, statsRes, snapshotsRes, dcaPlansRes, dcaPendingRes]) => {
  // existing handlers...
  if (dcaPlansRes.success && dcaPlansRes.data) setDcaPlans(dcaPlansRes.data.filter(p => p.portfolio_id === id));
  if (dcaPendingRes.success && dcaPendingRes.data) setDcaPending(dcaPendingRes.data);
  setLoading(false);
});
```

- [ ] **Step 5: Add DCA tab trigger to TabsList**

In the `<TabsList>`, add:
```tsx
<TabsTrigger value="dca">DCA {dcaPending.length > 0 && `(${dcaPending.length})`}</TabsTrigger>
```

Add the onValueChange handler for 'dca' (no lazy load needed — data already fetched).

- [ ] **Step 6: Add DCA TabsContent**

After the Stats TabsContent, add:
```tsx
{/* DCA Tab */}
<TabsContent value="dca">
  <div style={{ marginTop: 16 }}>
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
      <Button variant="outline" onClick={() => { setEditDcaPlan(undefined); setDcaDialogOpen(true); }}>
        + New Plan
      </Button>
    </div>

    {/* Pending */}
    {dcaPending.length > 0 && (
      <div style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 12, fontWeight: 600, color: colors.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
          Pending Confirmations
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {dcaPending.map(p => (
            <DcaPendingCard
              key={p.id}
              pending={p}
              onConfirmed={(pendingId) => setDcaPending(prev => prev.filter(x => x.id !== pendingId))}
              onSkipped={(pendingId) => setDcaPending(prev => prev.filter(x => x.id !== pendingId))}
            />
          ))}
        </div>
      </div>
    )}

    {/* Plans list */}
    {dcaPlans.length === 0 ? (
      <p style={{ textAlign: 'center', padding: '48px 0', color: colors.muted, fontSize: 14 }}>
        No DCA plans yet. Create one to start recurring investments.
      </p>
    ) : (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              {['Ticker', 'Frequency', 'Mode', 'Amount / Shares', 'Next Run', 'Status', ''].map(h => (
                <th key={h} style={{ paddingBottom: 8, paddingRight: 16, textAlign: 'left', color: colors.muted, fontWeight: 500, fontSize: 12 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dcaPlans.map(plan => (
              <tr key={plan.id} style={{ borderBottom: `1px solid ${colors.border}`, opacity: plan.is_active ? 1 : 0.5 }}>
                <td style={{ padding: '12px 16px 12px 0', fontWeight: 600, color: colors.text }}>
                  {plan.ticker}
                  <span style={{ marginLeft: 6, fontSize: 11, color: colors.muted }}>{plan.market}</span>
                </td>
                <td style={{ padding: '12px 16px 12px 0', color: colors.text }}>
                  {{ weekly: 'Weekly', biweekly: 'Bi-weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' }[plan.frequency]}
                </td>
                <td style={{ padding: '12px 16px 12px 0', color: colors.text }}>{plan.mode === 'amount' ? 'Amount' : 'Shares'}</td>
                <td style={{ padding: '12px 16px 12px 0', color: colors.info }}>
                  {plan.mode === 'amount' ? `${plan.currency} ${plan.amount}` : `${plan.shares} shares`}
                </td>
                <td style={{ padding: '12px 16px 12px 0', color: colors.text }}>{plan.next_run_date}</td>
                <td style={{ padding: '12px 16px 12px 0' }}>
                  <span style={{ fontSize: 11, color: plan.is_active ? colors.positive : colors.muted }}>
                    {plan.is_active ? 'Active' : 'Paused'}
                  </span>
                </td>
                <td style={{ padding: '12px 0', display: 'flex', gap: 4 }}>
                  <Button variant="ghost" size="sm" onClick={() => { setEditDcaPlan(plan); setDcaDialogOpen(true); }}>Edit</Button>
                  <Button variant="ghost" size="sm"
                    onClick={async () => {
                      if (!confirm('Delete this DCA plan?')) return;
                      setDeletingDcaId(plan.id);
                      await dcaApi.deletePlan(plan.id);
                      setDeletingDcaId(null);
                      setDcaPlans(prev => prev.filter(p => p.id !== plan.id));
                      setDcaPending(prev => prev.filter(p => p.dca_plan_id !== plan.id));
                    }}
                    disabled={deletingDcaId === plan.id}
                    style={{ color: colors.negative }}
                  >
                    {deletingDcaId === plan.id ? '...' : 'Delete'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
</TabsContent>
```

- [ ] **Step 7: Add DcaPlanDialog to the page**

After the existing `<AddDividendDialog>` and `<HoldingTradesPanel>`, add:
```tsx
<DcaPlanDialog
  open={dcaDialogOpen}
  onOpenChange={(o) => { setDcaDialogOpen(o); if (!o) setEditDcaPlan(undefined); }}
  portfolioId={id}
  defaultCurrency={currency}
  editPlan={editDcaPlan}
  onSuccess={(plan) => {
    setDcaPlans(prev => {
      const idx = prev.findIndex(p => p.id === plan.id);
      return idx >= 0 ? prev.map(p => p.id === plan.id ? plan : p) : [plan, ...prev];
    });
    setDcaDialogOpen(false);
    setEditDcaPlan(undefined);
  }}
/>
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
cd /Users/telephant/projects/firewise/firewise-web && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
cd /Users/telephant/projects/firewise/firewise-web
git add src/app/(fire)/fire/portfolios/[id]/page.tsx
git commit -m "feat: add DCA tab to portfolio detail page"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| Remove dead recurring code | Task 1 |
| dca_plans + dca_pending tables + RLS | Task 2 |
| Backend CRUD + confirm/skip endpoints | Task 3 |
| Daily cron task with price fetch | Task 4 |
| Frontend dcaApi types | Task 5 |
| DcaPlanDialog (create/edit) | Task 6 |
| DcaPendingCard with editable price/shares | Task 7 |
| Standalone DCA page with active/paused/pending sections | Task 8 |
| Sidebar DCA nav item + pending badge | Task 8 |
| DCA tab in portfolio detail page | Task 9 |
| POST /fire/dca/process manual trigger | Task 3 |

All spec requirements covered. No placeholders. Types consistent across all tasks (`DcaPlan`, `DcaPending`, `DcaFrequency`, `DcaMode`).
