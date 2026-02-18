-- =====================================================
-- Transactions Table - Atomic Design
-- =====================================================
-- Replaces the flows table with a cleaner design:
-- - Each transaction affects ONE primary asset (asset_id)
-- - Optional source_asset_id for context (dividend source, etc.)
-- - No confusing from/to concept
-- =====================================================

-- 1. Create transaction type enum
CREATE TYPE transaction_type AS ENUM (
  'income',        -- Money added to asset (salary, dividend, interest)
  'expense',       -- Money removed from asset (groceries, bills)
  'buy',           -- Investment shares added
  'sell',          -- Investment shares removed
  'debt_payment'   -- Debt payment
);

-- 2. Create transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  belong_id UUID NOT NULL,  -- Ownership (user_id or family_id)

  -- Core fields
  type transaction_type NOT NULL,
  category VARCHAR(100),           -- salary, dividend, groceries, etc.
  amount DECIMAL(12, 2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  date DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Asset references
  asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,        -- PRIMARY: asset affected
  source_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL, -- OPTIONAL: source/destination context
  debt_id UUID REFERENCES debts(id) ON DELETE SET NULL,          -- For debt_payment type

  -- Investment specific
  shares DECIMAL(18, 8),
  price_per_share DECIMAL(18, 8),

  -- Metadata
  description TEXT,
  expense_category_id UUID REFERENCES flow_expense_categories(id) ON DELETE SET NULL,
  schedule_id UUID REFERENCES recurring_schedules(id) ON DELETE SET NULL,
  metadata JSONB,
  needs_review BOOLEAN DEFAULT false,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create indexes
CREATE INDEX idx_transactions_belong ON transactions(belong_id);
CREATE INDEX idx_transactions_date ON transactions(belong_id, date DESC);
CREATE INDEX idx_transactions_type ON transactions(belong_id, type);
CREATE INDEX idx_transactions_asset ON transactions(asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX idx_transactions_source_asset ON transactions(source_asset_id) WHERE source_asset_id IS NOT NULL;
CREATE INDEX idx_transactions_debt ON transactions(debt_id) WHERE debt_id IS NOT NULL;
CREATE INDEX idx_transactions_category ON transactions(belong_id, category);

-- 4. Enable RLS
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies (same pattern as other tables)
CREATE POLICY "Users can view own transactions"
  ON transactions FOR SELECT
  TO authenticated
  USING (
    belong_id = auth.uid() OR
    belong_id IN (
      SELECT family_id FROM family_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create own transactions"
  ON transactions FOR INSERT
  TO authenticated
  WITH CHECK (
    belong_id = auth.uid() OR
    belong_id IN (
      SELECT family_id FROM family_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own transactions"
  ON transactions FOR UPDATE
  TO authenticated
  USING (
    belong_id = auth.uid() OR
    belong_id IN (
      SELECT family_id FROM family_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own transactions"
  ON transactions FOR DELETE
  TO authenticated
  USING (
    belong_id = auth.uid() OR
    belong_id IN (
      SELECT family_id FROM family_members WHERE user_id = auth.uid()
    )
  );

-- =====================================================
-- 6. Migrate data from flows to transactions
-- =====================================================

-- Helper: Determine transaction type from flow
-- income → income
-- expense → expense
-- transfer + category='invest' → buy
-- transfer + category='sell' → sell
-- transfer + debt_id → debt_payment
-- transfer (other) → will be split into two transactions later

-- Migrate income flows
INSERT INTO transactions (
  id, belong_id, type, category, amount, currency, date,
  asset_id, source_asset_id, debt_id,
  description, expense_category_id, schedule_id, metadata, needs_review,
  created_at, updated_at
)
SELECT
  id,
  belong_id,
  'income'::transaction_type,
  category,
  amount,
  currency,
  date,
  to_asset_id,        -- asset_id = where money goes
  from_asset_id,      -- source_asset_id = where it came from (for dividend)
  debt_id,
  description,
  flow_expense_category_id,
  schedule_id,
  metadata,
  needs_review,
  created_at,
  updated_at
FROM flows
WHERE type = 'income';

-- Migrate expense flows
INSERT INTO transactions (
  id, belong_id, type, category, amount, currency, date,
  asset_id, source_asset_id, debt_id,
  description, expense_category_id, schedule_id, metadata, needs_review,
  created_at, updated_at
)
SELECT
  id,
  belong_id,
  'expense'::transaction_type,
  category,
  amount,
  currency,
  date,
  from_asset_id,      -- asset_id = where money comes from
  NULL,               -- no source context needed
  debt_id,
  description,
  flow_expense_category_id,
  schedule_id,
  metadata,
  needs_review,
  created_at,
  updated_at
FROM flows
WHERE type = 'expense';

-- Migrate invest flows (transfer + category='invest')
INSERT INTO transactions (
  id, belong_id, type, category, amount, currency, date,
  asset_id, source_asset_id, debt_id, shares,
  description, expense_category_id, schedule_id, metadata, needs_review,
  created_at, updated_at
)
SELECT
  id,
  belong_id,
  'buy'::transaction_type,
  category,
  amount,
  currency,
  date,
  to_asset_id,        -- asset_id = the investment
  from_asset_id,      -- source_asset_id = cash account
  debt_id,
  (metadata->>'shares')::DECIMAL(18,8),
  description,
  flow_expense_category_id,
  schedule_id,
  metadata,
  needs_review,
  created_at,
  updated_at
FROM flows
WHERE type = 'transfer' AND category = 'invest';

-- Migrate sell flows (transfer + category='sell')
INSERT INTO transactions (
  id, belong_id, type, category, amount, currency, date,
  asset_id, source_asset_id, debt_id, shares,
  description, expense_category_id, schedule_id, metadata, needs_review,
  created_at, updated_at
)
SELECT
  id,
  belong_id,
  'sell'::transaction_type,
  category,
  amount,
  currency,
  date,
  from_asset_id,      -- asset_id = the investment being sold
  to_asset_id,        -- source_asset_id = cash account receiving proceeds
  debt_id,
  ABS((metadata->>'shares')::DECIMAL(18,8)),
  description,
  flow_expense_category_id,
  schedule_id,
  metadata,
  needs_review,
  created_at,
  updated_at
FROM flows
WHERE type = 'transfer' AND category = 'sell';

-- Migrate debt payment flows
INSERT INTO transactions (
  id, belong_id, type, category, amount, currency, date,
  asset_id, source_asset_id, debt_id,
  description, expense_category_id, schedule_id, metadata, needs_review,
  created_at, updated_at
)
SELECT
  id,
  belong_id,
  'debt_payment'::transaction_type,
  category,
  amount,
  currency,
  date,
  from_asset_id,      -- asset_id = payment source
  NULL,
  debt_id,
  description,
  flow_expense_category_id,
  schedule_id,
  metadata,
  needs_review,
  created_at,
  updated_at
FROM flows
WHERE type = 'expense' AND category = 'pay_debt' AND debt_id IS NOT NULL
ON CONFLICT (id) DO UPDATE SET type = 'debt_payment';

-- Migrate regular transfers as expense (source side)
-- Note: We only create ONE transaction for transfers, with source_asset_id pointing to destination
INSERT INTO transactions (
  id, belong_id, type, category, amount, currency, date,
  asset_id, source_asset_id, debt_id,
  description, expense_category_id, schedule_id, metadata, needs_review,
  created_at, updated_at
)
SELECT
  id,
  belong_id,
  'expense'::transaction_type,
  'transfer',
  amount,
  currency,
  date,
  from_asset_id,      -- asset_id = source (money leaves)
  to_asset_id,        -- source_asset_id = destination (for reference)
  debt_id,
  description,
  flow_expense_category_id,
  schedule_id,
  jsonb_build_object('transfer_type', 'out', 'original_metadata', metadata),
  needs_review,
  created_at,
  updated_at
FROM flows
WHERE type = 'transfer'
  AND category = 'transfer'
  AND from_asset_id IS NOT NULL
  AND to_asset_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Migrate 'other' flows as income (balance adjustments)
INSERT INTO transactions (
  id, belong_id, type, category, amount, currency, date,
  asset_id, source_asset_id, debt_id,
  description, expense_category_id, schedule_id, metadata, needs_review,
  created_at, updated_at
)
SELECT
  id,
  belong_id,
  'income'::transaction_type,
  COALESCE(category, 'adjustment'),
  amount,
  currency,
  date,
  COALESCE(to_asset_id, from_asset_id),
  NULL,
  debt_id,
  description,
  flow_expense_category_id,
  schedule_id,
  metadata,
  needs_review,
  created_at,
  updated_at
FROM flows
WHERE type = 'other'
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- Note: flows table is kept for backup
-- Drop after verifying migration: DROP TABLE flows;
-- =====================================================
