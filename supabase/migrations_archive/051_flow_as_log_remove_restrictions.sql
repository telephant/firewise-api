-- Flow as Log: Remove deletion restrictions
--
-- Flow table is now an audit log, not the source of truth.
-- Assets and debts can be deleted even if flows reference them.
-- When deleted, the flow log entries will have NULL references.
--
-- This migration:
-- 1. Changes FK constraints from RESTRICT to SET NULL
-- 2. Assets/debts can be deleted freely
-- 3. Flow history is preserved with NULL references

-- =====================================================
-- 1. Change flows.from_asset_id constraint
-- =====================================================
ALTER TABLE flows DROP CONSTRAINT IF EXISTS flows_from_asset_id_fkey;
ALTER TABLE flows
  ADD CONSTRAINT flows_from_asset_id_fkey
  FOREIGN KEY (from_asset_id)
  REFERENCES assets(id)
  ON DELETE SET NULL;

-- =====================================================
-- 2. Change flows.to_asset_id constraint
-- =====================================================
ALTER TABLE flows DROP CONSTRAINT IF EXISTS flows_to_asset_id_fkey;
ALTER TABLE flows
  ADD CONSTRAINT flows_to_asset_id_fkey
  FOREIGN KEY (to_asset_id)
  REFERENCES assets(id)
  ON DELETE SET NULL;

-- =====================================================
-- 3. Change flows.debt_id constraint
-- =====================================================
ALTER TABLE flows DROP CONSTRAINT IF EXISTS flows_debt_id_fkey;
ALTER TABLE flows
  ADD CONSTRAINT flows_debt_id_fkey
  FOREIGN KEY (debt_id)
  REFERENCES debts(id)
  ON DELETE SET NULL;

-- =====================================================
-- Summary:
-- - Deleting an asset will set from_asset_id/to_asset_id to NULL in flows
-- - Deleting a debt will set debt_id to NULL in flows
-- - Flow history is preserved for audit purposes
-- =====================================================
