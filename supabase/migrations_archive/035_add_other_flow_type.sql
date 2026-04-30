-- Add 'other' to flow_type enum for balance adjustments and misc flows
ALTER TYPE flow_type ADD VALUE IF NOT EXISTS 'other';

-- Update the valid_flow constraint to include 'other' type
-- 'other' type requires to_asset_id (the asset being adjusted)
ALTER TABLE flows DROP CONSTRAINT IF EXISTS valid_flow;
ALTER TABLE flows ADD CONSTRAINT valid_flow CHECK (
  (type = 'income' AND to_asset_id IS NOT NULL) OR
  (type = 'expense' AND from_asset_id IS NOT NULL AND to_asset_id IS NULL) OR
  (type = 'transfer' AND from_asset_id IS NOT NULL AND to_asset_id IS NOT NULL) OR
  (type = 'other' AND to_asset_id IS NOT NULL)
);
