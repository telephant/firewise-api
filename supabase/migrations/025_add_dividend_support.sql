-- =====================================================
-- Add dividend support for automated flow creation
-- =====================================================

-- Add needs_review field to flows for auto-created entries
ALTER TABLE flows ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT FALSE;

-- Index for efficiently querying flows that need review
CREATE INDEX IF NOT EXISTS idx_flows_needs_review
ON flows(user_id, needs_review)
WHERE needs_review = TRUE;

-- Update flow constraint to allow income flows with optional from_asset_id
-- This enables linking dividend income to the source stock asset
ALTER TABLE flows DROP CONSTRAINT IF EXISTS valid_flow;
ALTER TABLE flows ADD CONSTRAINT valid_flow CHECK (
  (type = 'income' AND to_asset_id IS NOT NULL) OR
  (type = 'expense' AND from_asset_id IS NOT NULL AND to_asset_id IS NULL) OR
  (type = 'transfer' AND from_asset_id IS NOT NULL AND to_asset_id IS NOT NULL)
);
