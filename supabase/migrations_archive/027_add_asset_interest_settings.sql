-- Asset interest settings for deposit accounts
-- Stores interest rate and payment period for each deposit asset

CREATE TABLE IF NOT EXISTS asset_interest_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,

  -- Interest rate as decimal (e.g., 0.0450 for 4.50% APY)
  interest_rate DECIMAL(8,6) NOT NULL,

  -- Payment period: how often interest is paid
  -- weekly, monthly, quarterly, semi_annual, annual, biennial (2yr), triennial (3yr), quinquennial (5yr)
  payment_period TEXT NOT NULL DEFAULT 'annual',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- One setting per asset
  UNIQUE(asset_id)
);

-- RLS policies
ALTER TABLE asset_interest_settings ENABLE ROW LEVEL SECURITY;

-- Users can only access settings for their own assets
CREATE POLICY "Users can view own asset interest settings" ON asset_interest_settings
  FOR SELECT USING (
    asset_id IN (SELECT id FROM assets WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can insert own asset interest settings" ON asset_interest_settings
  FOR INSERT WITH CHECK (
    asset_id IN (SELECT id FROM assets WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update own asset interest settings" ON asset_interest_settings
  FOR UPDATE USING (
    asset_id IN (SELECT id FROM assets WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete own asset interest settings" ON asset_interest_settings
  FOR DELETE USING (
    asset_id IN (SELECT id FROM assets WHERE user_id = auth.uid())
  );

-- Index for fast lookups by asset_id
CREATE INDEX idx_asset_interest_settings_asset_id ON asset_interest_settings(asset_id);

-- Add comment
COMMENT ON TABLE asset_interest_settings IS 'Interest rate and payment period settings for deposit assets';
COMMENT ON COLUMN asset_interest_settings.interest_rate IS 'Annual interest rate as decimal (e.g., 0.0450 = 4.50% APY)';
COMMENT ON COLUMN asset_interest_settings.payment_period IS 'Payment frequency: weekly, monthly, quarterly, semi_annual, annual, biennial, triennial, quinquennial';
