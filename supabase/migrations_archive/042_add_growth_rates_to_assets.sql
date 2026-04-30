-- Add growth_rates column to assets table
-- Stores pre-fetched 5yr/10yr annualized growth rates from Yahoo Finance
-- Updated daily by update-growth-rates task

ALTER TABLE assets
ADD COLUMN growth_rates JSONB DEFAULT NULL;

-- Example structure:
-- {
--   "5y": 0.12,           -- 12% annual return over 5 years (can be negative)
--   "10y": 0.08,          -- 8% annual return over 10 years
--   "updated_at": "2025-01-17T12:00:00Z"
-- }

COMMENT ON COLUMN assets.growth_rates IS 'Pre-fetched 5yr/10yr annualized growth rates from Yahoo Finance';
