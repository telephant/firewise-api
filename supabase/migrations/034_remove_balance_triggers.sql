-- Remove balance auto-update triggers and functions
-- Balance updates should be handled by application code, not SQL triggers
-- This ensures predictable behavior and easier debugging
--
-- NOTE: Auto-creation triggers (profile, default cash asset) are kept

-- =====================================================
-- 1. Drop asset balance triggers and functions
-- =====================================================

-- Drop the trigger first
DROP TRIGGER IF EXISTS trigger_update_asset_balances ON flows;

-- Drop the functions
DROP FUNCTION IF EXISTS update_asset_balances_on_flow_change();
DROP FUNCTION IF EXISTS recalculate_asset_balance(UUID);

-- =====================================================
-- 2. Drop debt balance triggers and functions
-- =====================================================

-- Drop the trigger first
DROP TRIGGER IF EXISTS trigger_update_debt_balance ON flows;

-- Drop the functions
DROP FUNCTION IF EXISTS update_debt_balance_on_flow_change();
DROP FUNCTION IF EXISTS recalculate_debt_balance(UUID);

-- =====================================================
-- 3. Change foreign key behavior to RESTRICT
--    This will prevent deletion if data is referenced
-- =====================================================

-- For flows.from_asset_id: Change from ON DELETE SET NULL to ON DELETE RESTRICT
ALTER TABLE flows DROP CONSTRAINT IF EXISTS flows_from_asset_id_fkey;
ALTER TABLE flows
  ADD CONSTRAINT flows_from_asset_id_fkey
  FOREIGN KEY (from_asset_id)
  REFERENCES assets(id)
  ON DELETE RESTRICT;

-- For flows.to_asset_id: Change from ON DELETE SET NULL to ON DELETE RESTRICT
ALTER TABLE flows DROP CONSTRAINT IF EXISTS flows_to_asset_id_fkey;
ALTER TABLE flows
  ADD CONSTRAINT flows_to_asset_id_fkey
  FOREIGN KEY (to_asset_id)
  REFERENCES assets(id)
  ON DELETE RESTRICT;

-- For flows.debt_id: Change from ON DELETE SET NULL to ON DELETE RESTRICT
ALTER TABLE flows DROP CONSTRAINT IF EXISTS flows_debt_id_fkey;
ALTER TABLE flows
  ADD CONSTRAINT flows_debt_id_fkey
  FOREIGN KEY (debt_id)
  REFERENCES debts(id)
  ON DELETE RESTRICT;

-- For debts.property_asset_id: Keep as SET NULL since this is an optional link
-- (Deleting a property shouldn't block if a mortgage references it)

-- =====================================================
-- Summary of removed triggers:
-- 1. trigger_update_asset_balances - auto-updated asset balance on flow changes
-- 2. trigger_update_debt_balance - auto-updated debt balance on flow changes
--
-- Triggers kept:
-- - on_auth_user_created - auto-creates profile on user signup
-- - on_profile_created_create_asset - auto-creates default cash asset
--
-- The application must now handle:
-- - Updating asset/debt balances when flows change
-- =====================================================
