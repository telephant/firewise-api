-- Add ledger_id to currencies table
ALTER TABLE currencies
ADD COLUMN ledger_id UUID REFERENCES ledgers(id) ON DELETE CASCADE,
ADD COLUMN created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Remove unique constraint on code (now unique per ledger)
ALTER TABLE currencies DROP CONSTRAINT IF EXISTS currencies_code_key;

-- Add unique constraint per ledger
ALTER TABLE currencies ADD CONSTRAINT currencies_ledger_code_unique UNIQUE (ledger_id, code);

-- Add ledger_id to expense_categories table
ALTER TABLE expense_categories
ADD COLUMN ledger_id UUID REFERENCES ledgers(id) ON DELETE CASCADE;

-- Add ledger_id to payment_methods table
ALTER TABLE payment_methods
ADD COLUMN ledger_id UUID REFERENCES ledgers(id) ON DELETE CASCADE;

-- Drop old policies
DROP POLICY IF EXISTS "Currencies are viewable by authenticated users" ON currencies;
DROP POLICY IF EXISTS "Authenticated users can create currencies" ON currencies;
DROP POLICY IF EXISTS "Users can view own categories" ON expense_categories;
DROP POLICY IF EXISTS "Users can create own categories" ON expense_categories;
DROP POLICY IF EXISTS "Users can delete own categories" ON expense_categories;
DROP POLICY IF EXISTS "Users can view own payment methods" ON payment_methods;
DROP POLICY IF EXISTS "Users can create own payment methods" ON payment_methods;
DROP POLICY IF EXISTS "Users can delete own payment methods" ON payment_methods;

-- New policies for currencies (ledger-based)
CREATE POLICY "Users can view currencies in their ledgers"
  ON currencies FOR SELECT
  TO authenticated
  USING (
    ledger_id IN (
      SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create currencies in their ledgers"
  ON currencies FOR INSERT
  TO authenticated
  WITH CHECK (
    ledger_id IN (
      SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete currencies in their ledgers"
  ON currencies FOR DELETE
  TO authenticated
  USING (
    ledger_id IN (
      SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()
    )
  );

-- New policies for expense_categories (ledger-based)
CREATE POLICY "Users can view categories in their ledgers"
  ON expense_categories FOR SELECT
  TO authenticated
  USING (
    ledger_id IN (
      SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create categories in their ledgers"
  ON expense_categories FOR INSERT
  TO authenticated
  WITH CHECK (
    ledger_id IN (
      SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete categories in their ledgers"
  ON expense_categories FOR DELETE
  TO authenticated
  USING (
    ledger_id IN (
      SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()
    )
  );

-- New policies for payment_methods (ledger-based)
CREATE POLICY "Users can view payment methods in their ledgers"
  ON payment_methods FOR SELECT
  TO authenticated
  USING (
    ledger_id IN (
      SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create payment methods in their ledgers"
  ON payment_methods FOR INSERT
  TO authenticated
  WITH CHECK (
    ledger_id IN (
      SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete payment methods in their ledgers"
  ON payment_methods FOR DELETE
  TO authenticated
  USING (
    ledger_id IN (
      SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()
    )
  );
