-- Add SE (Sweden) market support to trades and dca_plans tables

ALTER TABLE trades
  DROP CONSTRAINT IF EXISTS trades_market_check,
  ADD CONSTRAINT trades_market_check CHECK (market IN ('US', 'SGX', 'HK', 'CN', 'SE', 'COMMODITY'));

ALTER TABLE dca_plans
  DROP CONSTRAINT IF EXISTS dca_plans_market_check,
  ADD CONSTRAINT dca_plans_market_check CHECK (market IN ('US', 'SGX', 'HK', 'CN', 'SE', 'COMMODITY'));
