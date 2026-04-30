-- Migrate existing debt assets to the new debts table
-- This preserves all existing debt data while moving to the new schema

-- Step 1: Migrate debt assets to debts table
INSERT INTO debts (
  user_id,
  name,
  debt_type,
  currency,
  principal,
  interest_rate,
  term_months,
  start_date,
  current_balance,
  monthly_payment,
  status,
  metadata,
  created_at,
  updated_at
)
SELECT
  a.user_id,
  a.name,
  -- Convert string debt_type to enum, default to 'other'
  CASE
    WHEN a.metadata->>'debt_type' = 'mortgage' THEN 'mortgage'::debt_type
    WHEN a.metadata->>'debt_type' = 'personal_loan' THEN 'personal_loan'::debt_type
    WHEN a.metadata->>'debt_type' = 'credit_card' THEN 'credit_card'::debt_type
    WHEN a.metadata->>'debt_type' = 'student_loan' THEN 'student_loan'::debt_type
    WHEN a.metadata->>'debt_type' = 'auto_loan' THEN 'auto_loan'::debt_type
    ELSE 'other'::debt_type
  END,
  a.currency,
  -- Principal: from metadata or use absolute balance
  COALESCE((a.metadata->>'principal')::DECIMAL, ABS(a.balance)),
  -- Interest rate as decimal
  (a.metadata->>'interest_rate')::DECIMAL,
  -- Term in months
  (a.metadata->>'term_months')::INTEGER,
  -- Start date
  (a.metadata->>'start_date')::DATE,
  -- Current balance (absolute value, debts store positive balances)
  ABS(a.balance),
  -- Monthly payment
  (a.metadata->>'monthly_payment')::DECIMAL,
  -- Status based on balance (negative = active debt, zero/positive = paid off)
  CASE WHEN a.balance < 0 THEN 'active' ELSE 'paid_off' END,
  -- Keep original metadata
  a.metadata,
  a.created_at,
  a.updated_at
FROM assets a
WHERE a.type = 'debt'
ON CONFLICT (user_id, name) DO NOTHING;

-- Step 2: Update flows that reference debt assets to use the new debt_id
-- For flows where to_asset_id points to a debt asset
UPDATE flows f
SET debt_id = d.id
FROM debts d
JOIN assets a ON a.name = d.name AND a.user_id = d.user_id AND a.type = 'debt'
WHERE f.to_asset_id = a.id
  AND f.debt_id IS NULL;

-- For flows where from_asset_id points to a debt asset (paying from debt)
UPDATE flows f
SET debt_id = d.id
FROM debts d
JOIN assets a ON a.name = d.name AND a.user_id = d.user_id AND a.type = 'debt'
WHERE f.from_asset_id = a.id
  AND f.debt_id IS NULL;

-- Step 3: Recalculate all debt balances to ensure consistency
DO $$
DECLARE
  debt_record RECORD;
BEGIN
  FOR debt_record IN SELECT id FROM debts LOOP
    PERFORM recalculate_debt_balance(debt_record.id);
  END LOOP;
END $$;

-- Note: We keep the debt assets for now for backwards compatibility
-- A future migration can remove them after verifying everything works:
-- DELETE FROM assets WHERE type = 'debt';
-- And update the asset_type enum to remove 'debt'
