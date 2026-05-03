-- 002_commodity.sql
-- Add asset_type and unit columns to trades table.
-- Existing rows: asset_type defaults to 'stock', unit defaults to NULL (correct for stocks).

-- Add columns without inline CHECK constraints (to avoid duplicate unnamed constraints on re-run)
ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS asset_type TEXT NOT NULL DEFAULT 'stock',
  ADD COLUMN IF NOT EXISTS unit TEXT;

-- Add named constraints (idempotent: drop if exists first)
ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_asset_type_check;
ALTER TABLE trades ADD CONSTRAINT trades_asset_type_check
  CHECK (asset_type IN ('stock', 'commodity'));

ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_unit_check;
ALTER TABLE trades ADD CONSTRAINT trades_unit_check
  CHECK (unit IN ('troy_oz', 'barrel', 'gram', 'kg', 'oz', 'pound', 'unit'));

-- Extend market check constraint to include COMMODITY
-- Drop all market-related constraints on trades (handles both named and auto-generated names)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'trades'::regclass AND contype = 'c' AND conname ILIKE '%market%'
  LOOP
    EXECUTE format('ALTER TABLE trades DROP CONSTRAINT %I', r.conname);
  END LOOP;
END;
$$;

ALTER TABLE trades ADD CONSTRAINT trades_market_check
  CHECK (market IN ('US', 'SGX', 'HK', 'CN', 'COMMODITY'));
