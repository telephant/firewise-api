-- Add asset_subtype to trades for ETF/Stock/Commodity classification
-- Populated automatically from findata quote_type when a new ticker is first traded

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS asset_subtype TEXT
    CHECK (asset_subtype IN ('stock', 'etf', 'commodity', 'crypto', 'fund', 'other'));

COMMENT ON COLUMN trades.asset_subtype IS
  'Asset classification from findata quote_type: stock, etf, commodity, crypto, fund, other. NULL for legacy trades.';
