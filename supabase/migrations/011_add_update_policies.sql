-- Add UPDATE policies for currencies, expense_categories, and payment_methods

-- Update policy for currencies
CREATE POLICY "Users can update currencies in their ledgers"
  ON currencies FOR UPDATE
  TO authenticated
  USING (
    ledger_id IN (
      SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    ledger_id IN (
      SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()
    )
  );

-- Update policy for expense_categories
CREATE POLICY "Users can update categories in their ledgers"
  ON expense_categories FOR UPDATE
  TO authenticated
  USING (
    ledger_id IN (
      SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    ledger_id IN (
      SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()
    )
  );

-- Update policy for payment_methods
CREATE POLICY "Users can update payment methods in their ledgers"
  ON payment_methods FOR UPDATE
  TO authenticated
  USING (
    ledger_id IN (
      SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    ledger_id IN (
      SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()
    )
  );
