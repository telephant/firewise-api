-- Add composite indexes for better query performance

-- Composite index for expenses queries that filter by ledger_id and date range
-- This is used by the stats view which queries expenses for a specific ledger within a date range
CREATE INDEX IF NOT EXISTS idx_expenses_ledger_date ON expenses(ledger_id, date DESC);

-- Composite index for ledger_users lookups (used in every API call to verify access)
CREATE INDEX IF NOT EXISTS idx_ledger_users_lookup ON ledger_users(ledger_id, user_id);

-- Index for filtering metadata by ledger
CREATE INDEX IF NOT EXISTS idx_expense_categories_ledger ON expense_categories(ledger_id);
CREATE INDEX IF NOT EXISTS idx_currencies_ledger ON currencies(ledger_id);
CREATE INDEX IF NOT EXISTS idx_payment_methods_ledger ON payment_methods(ledger_id);
