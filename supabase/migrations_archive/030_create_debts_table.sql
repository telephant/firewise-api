-- Create debts table for proper debt tracking
-- Migrating from storing debts as assets with JSON metadata to a dedicated table

-- Debt type enum
DO $$ BEGIN
  CREATE TYPE debt_type AS ENUM ('mortgage', 'personal_loan', 'credit_card', 'student_loan', 'auto_loan', 'other');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Debts table
CREATE TABLE IF NOT EXISTS debts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  debt_type debt_type NOT NULL DEFAULT 'other',
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',

  -- Loan terms
  principal DECIMAL(14, 2) NOT NULL,           -- Original loan amount
  interest_rate DECIMAL(6, 4),                  -- Annual rate as decimal (0.065 = 6.5%)
  term_months INTEGER,                          -- Loan term in months
  start_date DATE,                              -- When loan started

  -- Calculated/cached values
  current_balance DECIMAL(14, 2) NOT NULL DEFAULT 0,  -- Updated by trigger
  monthly_payment DECIMAL(12, 2),               -- Calculated or user-entered
  balance_updated_at TIMESTAMPTZ,

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- active, paid_off
  paid_off_date DATE,

  -- Optional links
  property_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL, -- For mortgages linked to real estate

  -- Metadata for extensibility
  metadata JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, name)
);

-- RLS policies
ALTER TABLE debts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can view own debts" ON debts
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can create own debts" ON debts
    FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update own debts" ON debts
    FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can delete own debts" ON debts
    FOR DELETE USING (auth.uid() = user_id);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_debts_user_id ON debts(user_id);
CREATE INDEX IF NOT EXISTS idx_debts_status ON debts(status);
CREATE INDEX IF NOT EXISTS idx_debts_debt_type ON debts(debt_type);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_debts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_debts_updated_at ON debts;
CREATE TRIGGER trigger_debts_updated_at
  BEFORE UPDATE ON debts
  FOR EACH ROW
  EXECUTE FUNCTION update_debts_updated_at();
