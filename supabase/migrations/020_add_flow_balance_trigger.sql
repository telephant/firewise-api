-- Function to recalculate asset balance from flows
-- For stock/etf/crypto: balance = sum of shares
-- For cash/debt/other: balance = sum of amounts
CREATE OR REPLACE FUNCTION recalculate_asset_balance(asset_id_param UUID)
RETURNS void AS $$
DECLARE
  asset_type TEXT;
  new_balance DECIMAL(14, 2);
BEGIN
  -- Get asset type
  SELECT type INTO asset_type FROM assets WHERE id = asset_id_param;

  IF asset_type IS NULL THEN
    RETURN;
  END IF;

  -- Calculate balance based on asset type
  IF asset_type IN ('stock', 'etf', 'crypto') THEN
    -- For share-based assets: sum shares from metadata
    SELECT COALESCE(
      SUM(
        CASE
          WHEN to_asset_id = asset_id_param THEN COALESCE((metadata->>'shares')::DECIMAL, 0)
          WHEN from_asset_id = asset_id_param THEN -COALESCE((metadata->>'shares')::DECIMAL, 0)
          ELSE 0
        END
      ), 0
    ) INTO new_balance
    FROM flows
    WHERE to_asset_id = asset_id_param OR from_asset_id = asset_id_param;
  ELSE
    -- For currency-based assets: sum amounts
    SELECT COALESCE(
      SUM(
        CASE
          WHEN to_asset_id = asset_id_param THEN amount
          WHEN from_asset_id = asset_id_param THEN -amount
          ELSE 0
        END
      ), 0
    ) INTO new_balance
    FROM flows
    WHERE to_asset_id = asset_id_param OR from_asset_id = asset_id_param;
  END IF;

  -- Update asset balance
  UPDATE assets
  SET balance = new_balance, balance_updated_at = NOW()
  WHERE id = asset_id_param;
END;
$$ LANGUAGE plpgsql;

-- Trigger function to update asset balances after flow changes
CREATE OR REPLACE FUNCTION update_asset_balances_on_flow_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Handle INSERT
  IF TG_OP = 'INSERT' THEN
    IF NEW.from_asset_id IS NOT NULL THEN
      PERFORM recalculate_asset_balance(NEW.from_asset_id);
    END IF;
    IF NEW.to_asset_id IS NOT NULL THEN
      PERFORM recalculate_asset_balance(NEW.to_asset_id);
    END IF;
    RETURN NEW;
  END IF;

  -- Handle UPDATE
  IF TG_OP = 'UPDATE' THEN
    -- Recalculate old assets
    IF OLD.from_asset_id IS NOT NULL THEN
      PERFORM recalculate_asset_balance(OLD.from_asset_id);
    END IF;
    IF OLD.to_asset_id IS NOT NULL THEN
      PERFORM recalculate_asset_balance(OLD.to_asset_id);
    END IF;
    -- Recalculate new assets (if different)
    IF NEW.from_asset_id IS NOT NULL AND NEW.from_asset_id IS DISTINCT FROM OLD.from_asset_id THEN
      PERFORM recalculate_asset_balance(NEW.from_asset_id);
    END IF;
    IF NEW.to_asset_id IS NOT NULL AND NEW.to_asset_id IS DISTINCT FROM OLD.to_asset_id THEN
      PERFORM recalculate_asset_balance(NEW.to_asset_id);
    END IF;
    RETURN NEW;
  END IF;

  -- Handle DELETE
  IF TG_OP = 'DELETE' THEN
    IF OLD.from_asset_id IS NOT NULL THEN
      PERFORM recalculate_asset_balance(OLD.from_asset_id);
    END IF;
    IF OLD.to_asset_id IS NOT NULL THEN
      PERFORM recalculate_asset_balance(OLD.to_asset_id);
    END IF;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on flows table
DROP TRIGGER IF EXISTS trigger_update_asset_balances ON flows;
CREATE TRIGGER trigger_update_asset_balances
  AFTER INSERT OR UPDATE OR DELETE ON flows
  FOR EACH ROW
  EXECUTE FUNCTION update_asset_balances_on_flow_change();

-- Add comment for documentation
COMMENT ON FUNCTION recalculate_asset_balance IS 'Recalculates asset balance from all related flows. Uses shares for stock/etf/crypto, amount for others.';
COMMENT ON FUNCTION update_asset_balances_on_flow_change IS 'Trigger function that updates asset balances when flows are inserted, updated, or deleted.';
