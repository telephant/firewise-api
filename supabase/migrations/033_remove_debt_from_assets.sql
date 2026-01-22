-- Remove debt type from assets now that we have a dedicated debts table
-- This is a cleanup migration after the debts table migration is verified working

-- Clean up in case of partial previous run
DROP TYPE IF EXISTS asset_type_new;

-- Step 1: Delete any remaining debt assets (their data is now in debts table)
DELETE FROM assets WHERE type = 'debt';

-- Step 2: Remove 'debt' from asset_type enum
-- PostgreSQL doesn't support dropping enum values directly

-- Drop indexes that use the type column (they block ALTER)
DROP INDEX IF EXISTS idx_assets_type;
DROP INDEX IF EXISTS idx_assets_user_cash_unique;

-- Drop default
ALTER TABLE assets
  ALTER COLUMN type DROP DEFAULT;

-- Convert to text with explicit USING clause
ALTER TABLE assets
  ALTER COLUMN type TYPE text
  USING type::text;

-- Now we can safely drop the old enum and create new one
DROP TYPE IF EXISTS asset_type;
CREATE TYPE asset_type AS ENUM ('cash', 'deposit', 'stock', 'etf', 'bond', 'real_estate', 'crypto', 'other');

-- Convert text back to the new enum
ALTER TABLE assets
  ALTER COLUMN type TYPE asset_type
  USING type::asset_type;

-- Restore default
ALTER TABLE assets
  ALTER COLUMN type SET DEFAULT 'cash'::asset_type;

-- Recreate the indexes
CREATE INDEX idx_assets_type ON assets(user_id, type);
CREATE UNIQUE INDEX idx_assets_user_cash_unique ON assets(user_id) WHERE type = 'cash';
