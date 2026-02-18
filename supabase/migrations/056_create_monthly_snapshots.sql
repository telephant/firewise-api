-- Monthly Financial Snapshots Table
-- Stores end-of-month snapshots of complete financial state for historical comparison

CREATE TABLE IF NOT EXISTS monthly_financial_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  belong_id UUID NOT NULL,

  -- Period identification
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
  snapshot_date DATE NOT NULL, -- Last day of the month

  -- Primary currency for aggregated values
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',

  -- Net Worth Summary
  total_assets NUMERIC(20, 2) NOT NULL DEFAULT 0,
  total_debts NUMERIC(20, 2) NOT NULL DEFAULT 0,
  net_worth NUMERIC(20, 2) NOT NULL DEFAULT 0,

  -- Income Summary (for the month)
  total_income NUMERIC(20, 2) NOT NULL DEFAULT 0,
  active_income NUMERIC(20, 2) NOT NULL DEFAULT 0,
  passive_income NUMERIC(20, 2) NOT NULL DEFAULT 0,

  -- Expense Summary (for the month)
  total_expenses NUMERIC(20, 2) NOT NULL DEFAULT 0,

  -- Detailed breakdowns (JSONB for flexibility)
  -- assets: [{ id, name, type, ticker, balance, currency, balance_usd }]
  assets JSONB NOT NULL DEFAULT '[]',
  -- debts: [{ id, name, type, current_balance, currency, balance_usd }]
  debts JSONB NOT NULL DEFAULT '[]',
  -- assets_by_type: { cash: 1000, stock: 5000, ... }
  assets_by_type JSONB NOT NULL DEFAULT '{}',
  -- income_by_category: { salary: 5000, dividend: 200, rental: 1000, ... }
  income_by_category JSONB NOT NULL DEFAULT '{}',
  -- expenses_by_category: { housing: 2000, food: 500, ... }
  expenses_by_category JSONB NOT NULL DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unique constraint: one snapshot per month per belong_id
  CONSTRAINT monthly_financial_snapshots_unique_month UNIQUE (belong_id, year, month)
);

-- Indexes
CREATE INDEX idx_monthly_financial_snapshots_belong_id ON monthly_financial_snapshots(belong_id);
CREATE INDEX idx_monthly_financial_snapshots_period ON monthly_financial_snapshots(year, month);
CREATE INDEX idx_monthly_financial_snapshots_date ON monthly_financial_snapshots(snapshot_date);

-- RLS
ALTER TABLE monthly_financial_snapshots ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view snapshots they belong to
CREATE POLICY "monthly_financial_snapshots_select" ON monthly_financial_snapshots
  FOR SELECT USING (
    belong_id = auth.uid()
    OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );

-- Policy: Users can insert snapshots for themselves or their family
CREATE POLICY "monthly_financial_snapshots_insert" ON monthly_financial_snapshots
  FOR INSERT WITH CHECK (
    belong_id = auth.uid()
    OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );

-- Policy: Users can update their own snapshots
CREATE POLICY "monthly_financial_snapshots_update" ON monthly_financial_snapshots
  FOR UPDATE USING (
    belong_id = auth.uid()
    OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );

-- Comment
COMMENT ON TABLE monthly_financial_snapshots IS 'Stores end-of-month snapshots of complete financial state: assets, debts, income, expenses';
