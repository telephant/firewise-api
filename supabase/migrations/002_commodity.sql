-- 002_commodity.sql
-- Add asset_type and unit columns to trades table for commodity trading support.
-- Existing rows: asset_type defaults to 'stock', unit defaults to NULL (correct for stocks).

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS asset_type TEXT NOT NULL DEFAULT 'stock'
    CHECK (asset_type IN ('stock', 'commodity')),
  ADD COLUMN IF NOT EXISTS unit TEXT
    CHECK (unit IN ('troy_oz', 'barrel', 'gram', 'kg', 'oz', 'pound', 'unit'));

-- Extend market check constraint to include COMMODITY
ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_market_check;
ALTER TABLE trades ADD CONSTRAINT trades_market_check
  CHECK (market IN ('US', 'SGX', 'HK', 'CN', 'COMMODITY'));
