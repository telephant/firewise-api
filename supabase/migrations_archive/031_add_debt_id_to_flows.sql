-- Add debt reference to flows for debt payments
-- This allows flows to directly reference debts instead of using asset-based debt tracking

-- Add debt_id column to flows
ALTER TABLE flows ADD COLUMN IF NOT EXISTS debt_id UUID REFERENCES debts(id) ON DELETE SET NULL;

-- Index for debt-related flow queries
CREATE INDEX IF NOT EXISTS idx_flows_debt_id ON flows(debt_id);

-- Function to recalculate debt balance from all related flows
CREATE OR REPLACE FUNCTION recalculate_debt_balance(debt_id_param UUID)
RETURNS void AS $$
DECLARE
  new_balance DECIMAL(14, 2);
  original_principal DECIMAL(14, 2);
  debt_exists BOOLEAN;
BEGIN
  -- Check if debt exists
  SELECT EXISTS(SELECT 1 FROM debts WHERE id = debt_id_param) INTO debt_exists;
  IF NOT debt_exists THEN
    RETURN;
  END IF;

  -- Get original principal
  SELECT principal INTO original_principal FROM debts WHERE id = debt_id_param;

  -- Balance = principal - sum of all payments to this debt
  -- Payments are flows where debt_id matches and category is 'pay_debt'
  SELECT original_principal - COALESCE(SUM(amount), 0) INTO new_balance
  FROM flows
  WHERE debt_id = debt_id_param AND category = 'pay_debt';

  -- Update debt with new balance and status
  UPDATE debts
  SET current_balance = new_balance,
      balance_updated_at = NOW(),
      status = CASE WHEN new_balance <= 0 THEN 'paid_off' ELSE 'active' END,
      paid_off_date = CASE
        WHEN new_balance <= 0 AND paid_off_date IS NULL THEN CURRENT_DATE
        WHEN new_balance > 0 THEN NULL
        ELSE paid_off_date
      END
  WHERE id = debt_id_param;
END;
$$ LANGUAGE plpgsql;

-- Trigger function to update debt balance when flows change
CREATE OR REPLACE FUNCTION update_debt_balance_on_flow_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Recalculate for the old debt
    IF OLD.debt_id IS NOT NULL THEN
      PERFORM recalculate_debt_balance(OLD.debt_id);
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    -- Recalculate for the new debt
    IF NEW.debt_id IS NOT NULL THEN
      PERFORM recalculate_debt_balance(NEW.debt_id);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Recalculate for both if debt_id changed
    IF NEW.debt_id IS NOT NULL THEN
      PERFORM recalculate_debt_balance(NEW.debt_id);
    END IF;
    IF OLD.debt_id IS NOT NULL AND (OLD.debt_id != NEW.debt_id OR NEW.debt_id IS NULL) THEN
      PERFORM recalculate_debt_balance(OLD.debt_id);
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for debt balance updates
DROP TRIGGER IF EXISTS trigger_update_debt_balance ON flows;
CREATE TRIGGER trigger_update_debt_balance
  AFTER INSERT OR UPDATE OR DELETE ON flows
  FOR EACH ROW
  EXECUTE FUNCTION update_debt_balance_on_flow_change();
