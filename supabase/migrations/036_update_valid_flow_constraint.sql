-- Update the valid_flow constraint to include 'other' type
-- 'other' type requires either from_asset_id OR to_asset_id (for balance adjustments)
ALTER TABLE flows DROP CONSTRAINT IF EXISTS valid_flow;
ALTER TABLE flows ADD CONSTRAINT valid_flow CHECK (
  (type = 'income' AND to_asset_id IS NOT NULL) OR
  (type = 'expense' AND from_asset_id IS NOT NULL AND to_asset_id IS NULL) OR
  (type = 'transfer' AND from_asset_id IS NOT NULL AND to_asset_id IS NOT NULL) OR
  (type = 'other' AND (from_asset_id IS NOT NULL OR to_asset_id IS NOT NULL))
);
