-- Add index for payment_method_id filter on expenses
-- This is used when filtering expenses by payment method in the expense list

CREATE INDEX IF NOT EXISTS idx_expenses_payment_method_id ON expenses(payment_method_id);

-- Add composite index for ledger + category filtering (common query pattern)
CREATE INDEX IF NOT EXISTS idx_expenses_ledger_category ON expenses(ledger_id, category_id);

-- Add composite index for ledger + payment method filtering
CREATE INDEX IF NOT EXISTS idx_expenses_ledger_payment_method ON expenses(ledger_id, payment_method_id);
