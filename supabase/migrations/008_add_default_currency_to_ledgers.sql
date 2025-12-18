-- Add default_currency_id column to ledgers table
ALTER TABLE ledgers
ADD COLUMN default_currency_id UUID REFERENCES currencies(id) ON DELETE SET NULL;
