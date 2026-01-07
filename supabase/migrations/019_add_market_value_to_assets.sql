-- Add balance column to assets table
-- This stores the current balance of the asset (updated when flows change)
-- For cash: currency units, for stocks: value, for debt: negative value

ALTER TABLE assets ADD COLUMN balance DECIMAL(14, 2) DEFAULT 0;
ALTER TABLE assets ADD COLUMN balance_updated_at TIMESTAMPTZ;

-- Add comment for documentation
COMMENT ON COLUMN assets.balance IS 'Current balance of the asset (auto-updated from flows)';
COMMENT ON COLUMN assets.balance_updated_at IS 'When the balance was last updated';
