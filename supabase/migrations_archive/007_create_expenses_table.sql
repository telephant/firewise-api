-- Create expenses table
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  ledger_id UUID NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
  description TEXT,
  amount DECIMAL(12, 2) NOT NULL,
  currency_id UUID NOT NULL REFERENCES currencies(id),
  payment_method_id UUID REFERENCES payment_methods(id) ON DELETE SET NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX idx_expenses_ledger_id ON expenses(ledger_id);
CREATE INDEX idx_expenses_date ON expenses(date DESC);
CREATE INDEX idx_expenses_category_id ON expenses(category_id);

-- Enable RLS
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- Users can view expenses in ledgers they belong to
CREATE POLICY "Users can view expenses in their ledgers"
  ON expenses FOR SELECT
  TO authenticated
  USING (
    ledger_id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid())
  );

-- Users can create expenses in ledgers they belong to
CREATE POLICY "Users can create expenses in their ledgers"
  ON expenses FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid() AND
    ledger_id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid())
  );

-- Users can update expenses in ledgers they belong to
CREATE POLICY "Users can update expenses in their ledgers"
  ON expenses FOR UPDATE
  TO authenticated
  USING (
    ledger_id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid())
  );

-- Users can delete expenses in ledgers they belong to
CREATE POLICY "Users can delete expenses in their ledgers"
  ON expenses FOR DELETE
  TO authenticated
  USING (
    ledger_id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid())
  );
