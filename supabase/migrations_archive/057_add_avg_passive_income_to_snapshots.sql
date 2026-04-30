-- Add 12-month average passive income to monthly snapshots
-- This provides a more stable comparison metric than single-month values

ALTER TABLE monthly_financial_snapshots
ADD COLUMN IF NOT EXISTS avg_passive_income_12m NUMERIC(20, 2) DEFAULT 0;

COMMENT ON COLUMN monthly_financial_snapshots.avg_passive_income_12m IS 'Average monthly passive income over the last 12 months (in USD)';
