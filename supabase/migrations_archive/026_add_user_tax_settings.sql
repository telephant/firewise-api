-- =====================================================
-- Add User Tax Settings and Remove per-flow tax_withheld
-- =====================================================
-- Tax is calculated on-the-fly from user settings, not stored per-flow
-- This allows users to configure their tax rates globally and have
-- all displayed amounts automatically recalculated

-- Remove tax_withheld from flows (tax is calculated from settings)
ALTER TABLE flows DROP COLUMN IF EXISTS tax_withheld;

-- Create user tax settings table for global tax configuration
CREATE TABLE IF NOT EXISTS user_tax_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- US Stock tax rates
  us_dividend_withholding_rate DECIMAL(5,4) DEFAULT 0.30,  -- 30% default, 15% with tax treaty
  us_capital_gains_rate DECIMAL(5,4) DEFAULT 0.00,         -- 0% default (many countries exempt)

  -- Can add more markets later: cn_*, hk_*, etc.

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- RLS
ALTER TABLE user_tax_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tax settings" ON user_tax_settings
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tax settings" ON user_tax_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tax settings" ON user_tax_settings
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Index for quick lookup by user
CREATE INDEX IF NOT EXISTS idx_user_tax_settings_user_id ON user_tax_settings(user_id);
