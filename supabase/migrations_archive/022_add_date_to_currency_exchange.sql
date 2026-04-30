-- Add date column to currency_exchange table
-- Stores the API date for the exchange rates to enable date-based update checks

ALTER TABLE currency_exchange ADD COLUMN date DATE;

-- Index for date-based queries
CREATE INDEX idx_currency_exchange_date ON currency_exchange(date);
