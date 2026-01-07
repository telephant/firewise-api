-- Remove rate field from currencies table
-- Exchange rates are now fetched from the global currency_exchange table
-- currencies table is now just for user preferences (which currencies they use)

ALTER TABLE currencies DROP COLUMN IF EXISTS rate;
