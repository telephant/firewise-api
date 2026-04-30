-- Rename currencies table to ledger_currencies for clarity
-- This table stores user's currency preferences per ledger (not exchange rates)

ALTER TABLE currencies RENAME TO ledger_currencies;

-- Update the unique constraint name
ALTER TABLE ledger_currencies RENAME CONSTRAINT currencies_ledger_code_unique TO ledger_currencies_ledger_code_unique;

-- Update indexes if any exist with old name
ALTER INDEX IF EXISTS currencies_pkey RENAME TO ledger_currencies_pkey;
