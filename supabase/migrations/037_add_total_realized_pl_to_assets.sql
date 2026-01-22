-- =====================================================
-- Add total_realized_pl to assets table
-- =====================================================
-- Stores cumulative realized profit/loss from all sell transactions
-- Updated by application code when sell flows are created
-- Can be recalculated from flows if data drifts

-- Add total_realized_pl column to assets
ALTER TABLE assets ADD COLUMN IF NOT EXISTS total_realized_pl DECIMAL(20,2) DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN assets.total_realized_pl IS 'Cumulative realized P/L from sell transactions. Updated by app on each sale. Source of truth is flow metadata.realized_pl';

-- Index for efficient querying of assets with P/L data
CREATE INDEX IF NOT EXISTS idx_assets_total_realized_pl ON assets(total_realized_pl) WHERE total_realized_pl IS NOT NULL;
