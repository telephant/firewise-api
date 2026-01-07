-- Global currency exchange table (USD-based)
-- Stores rates from external API, updated daily via task runner
-- Both FIRE and Ledger modules can read from this table

CREATE TABLE currency_exchange (
  code VARCHAR(10) PRIMARY KEY,           -- Currency code (lowercase): usd, eur, cny
  name VARCHAR(100),                      -- Currency name: US Dollar, Euro
  rate DECIMAL(38, 18) NOT NULL DEFAULT 1,-- Rate: 1 USD = X currency (supports crypto with extreme values)
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX idx_currency_exchange_updated ON currency_exchange(updated_at);

-- RLS: Public read access for all authenticated users
-- No insert/update/delete for regular users (only via service role / task runner)
ALTER TABLE currency_exchange ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read currency exchange" ON currency_exchange
  FOR SELECT TO authenticated USING (true);

-- Data is populated by running: npm run task:update-currency
