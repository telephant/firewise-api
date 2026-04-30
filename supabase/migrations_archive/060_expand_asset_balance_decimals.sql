-- Expand asset balance decimal places to support crypto (e.g., 0.00000001 BTC)
-- Change from DECIMAL(14, 2) to DECIMAL(20, 8)

ALTER TABLE assets
ALTER COLUMN balance TYPE DECIMAL(20, 8);
