-- =====================================================
-- FIRE Management - Unified Flow Model
-- =====================================================
-- Every money movement = Flow from A → B
-- Income:   [External] → [Your Asset]
-- Expense:  [Your Asset] → [External]
-- Transfer: [Your Asset] → [Your Asset]
-- =====================================================

-- Asset type enum
CREATE TYPE asset_type AS ENUM (
  'cash', 'stock', 'etf', 'bond', 'real_estate', 'crypto', 'debt', 'other'
);

-- Flow type enum
CREATE TYPE flow_type AS ENUM ('income', 'expense', 'transfer');

-- =====================================================
-- Assets table (auto-created from flows)
-- =====================================================
CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type asset_type NOT NULL,
  ticker VARCHAR(20),                    -- Stock/ETF ticker symbol
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  market VARCHAR(10),                    -- US / CN / HK / RE
  metadata JSONB,                        -- { shares, cost_basis, etc. }
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- =====================================================
-- Flows table (all transactions)
-- =====================================================
CREATE TABLE IF NOT EXISTS flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type flow_type NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  from_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
  to_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
  category VARCHAR(100),                 -- salary, dividend, groceries, investment...
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT,
  tax_withheld DECIMAL(12, 2),           -- For dividends/income
  metadata JSONB,                        -- Type-specific data
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Validation: income has to_asset, expense has from_asset, transfer has both
  CONSTRAINT valid_flow CHECK (
    (type = 'income' AND from_asset_id IS NULL AND to_asset_id IS NOT NULL) OR
    (type = 'expense' AND from_asset_id IS NOT NULL AND to_asset_id IS NULL) OR
    (type = 'transfer' AND from_asset_id IS NOT NULL AND to_asset_id IS NOT NULL)
  )
);

-- =====================================================
-- Indexes for assets
-- =====================================================
CREATE INDEX idx_assets_user ON assets(user_id);
CREATE INDEX idx_assets_type ON assets(user_id, type);
CREATE INDEX idx_assets_ticker ON assets(ticker) WHERE ticker IS NOT NULL;

-- =====================================================
-- Indexes for flows
-- =====================================================
CREATE INDEX idx_flows_user ON flows(user_id);
CREATE INDEX idx_flows_date ON flows(user_id, date DESC);
CREATE INDEX idx_flows_type ON flows(user_id, type);
CREATE INDEX idx_flows_from_asset ON flows(from_asset_id) WHERE from_asset_id IS NOT NULL;
CREATE INDEX idx_flows_to_asset ON flows(to_asset_id) WHERE to_asset_id IS NOT NULL;

-- =====================================================
-- RLS for assets
-- =====================================================
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own assets"
  ON assets FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can create their own assets"
  ON assets FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own assets"
  ON assets FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own assets"
  ON assets FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- =====================================================
-- RLS for flows
-- =====================================================
ALTER TABLE flows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own flows"
  ON flows FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can create their own flows"
  ON flows FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own flows"
  ON flows FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own flows"
  ON flows FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
