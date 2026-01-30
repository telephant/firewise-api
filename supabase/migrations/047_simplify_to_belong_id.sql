-- Migration: Simplify ownership model with belong_id
-- Instead of user_id/family_id dual ownership, use:
-- - user_id: Creator (who made this, NOT NULL)
-- - belong_id: Ownership (user_id for personal, family_id for family)

-- ============================================
-- Step 1: Drop OLD RLS policies (they reference family_id)
-- Must be done BEFORE dropping family_id column
-- ============================================

-- Assets RLS
DROP POLICY IF EXISTS "Users can view own or family assets" ON assets;
DROP POLICY IF EXISTS "Users can insert assets" ON assets;
DROP POLICY IF EXISTS "Users can update own or family assets" ON assets;
DROP POLICY IF EXISTS "Users can delete own or family assets" ON assets;

-- Flows RLS
DROP POLICY IF EXISTS "Users can view own or family flows" ON flows;
DROP POLICY IF EXISTS "Users can insert flows" ON flows;
DROP POLICY IF EXISTS "Users can update own or family flows" ON flows;
DROP POLICY IF EXISTS "Users can delete own or family flows" ON flows;

-- Debts RLS
DROP POLICY IF EXISTS "Users can view own or family debts" ON debts;
DROP POLICY IF EXISTS "Users can insert debts" ON debts;
DROP POLICY IF EXISTS "Users can update own or family debts" ON debts;
DROP POLICY IF EXISTS "Users can delete own or family debts" ON debts;

-- Recurring Schedules RLS
DROP POLICY IF EXISTS "Users can view own or family recurring_schedules" ON recurring_schedules;
DROP POLICY IF EXISTS "Users can insert recurring_schedules" ON recurring_schedules;
DROP POLICY IF EXISTS "Users can update own or family recurring_schedules" ON recurring_schedules;
DROP POLICY IF EXISTS "Users can delete own or family recurring_schedules" ON recurring_schedules;

-- Flow Expense Categories RLS
DROP POLICY IF EXISTS "Users can view own or family flow_expense_categories" ON flow_expense_categories;
DROP POLICY IF EXISTS "Users can insert flow_expense_categories" ON flow_expense_categories;
DROP POLICY IF EXISTS "Users can update own or family flow_expense_categories" ON flow_expense_categories;
DROP POLICY IF EXISTS "Users can delete own or family flow_expense_categories" ON flow_expense_categories;

-- ============================================
-- Step 2: Add belong_id column to data tables
-- ============================================

-- For existing data, belong_id defaults to user_id (personal data)
ALTER TABLE assets ADD COLUMN IF NOT EXISTS belong_id UUID;
UPDATE assets SET belong_id = user_id WHERE belong_id IS NULL;
ALTER TABLE assets ALTER COLUMN belong_id SET NOT NULL;

ALTER TABLE flows ADD COLUMN IF NOT EXISTS belong_id UUID;
UPDATE flows SET belong_id = user_id WHERE belong_id IS NULL;
ALTER TABLE flows ALTER COLUMN belong_id SET NOT NULL;

ALTER TABLE debts ADD COLUMN IF NOT EXISTS belong_id UUID;
UPDATE debts SET belong_id = user_id WHERE belong_id IS NULL;
ALTER TABLE debts ALTER COLUMN belong_id SET NOT NULL;

ALTER TABLE recurring_schedules ADD COLUMN IF NOT EXISTS belong_id UUID;
UPDATE recurring_schedules SET belong_id = user_id WHERE belong_id IS NULL;
ALTER TABLE recurring_schedules ALTER COLUMN belong_id SET NOT NULL;

ALTER TABLE flow_expense_categories ADD COLUMN IF NOT EXISTS belong_id UUID;
UPDATE flow_expense_categories SET belong_id = user_id WHERE belong_id IS NULL;
ALTER TABLE flow_expense_categories ALTER COLUMN belong_id SET NOT NULL;

-- ============================================
-- Step 3: Drop family_id column (no longer needed)
-- ============================================

-- First drop any constraints that reference family_id
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_ownership_check;
ALTER TABLE flows DROP CONSTRAINT IF EXISTS flows_ownership_check;
ALTER TABLE debts DROP CONSTRAINT IF EXISTS debts_ownership_check;
ALTER TABLE recurring_schedules DROP CONSTRAINT IF EXISTS recurring_schedules_ownership_check;
ALTER TABLE flow_expense_categories DROP CONSTRAINT IF EXISTS flow_expense_categories_ownership_check;

-- Drop indexes on family_id
DROP INDEX IF EXISTS idx_assets_family_id;
DROP INDEX IF EXISTS idx_flows_family_id;
DROP INDEX IF EXISTS idx_debts_family_id;
DROP INDEX IF EXISTS idx_recurring_schedules_family_id;
DROP INDEX IF EXISTS idx_flow_expense_categories_family_id;

-- Drop family_id columns
ALTER TABLE assets DROP COLUMN IF EXISTS family_id;
ALTER TABLE flows DROP COLUMN IF EXISTS family_id;
ALTER TABLE debts DROP COLUMN IF EXISTS family_id;
ALTER TABLE recurring_schedules DROP COLUMN IF EXISTS family_id;
ALTER TABLE flow_expense_categories DROP COLUMN IF EXISTS family_id;

-- ============================================
-- Step 4: Add indexes on belong_id
-- ============================================

CREATE INDEX IF NOT EXISTS idx_assets_belong_id ON assets(belong_id);
CREATE INDEX IF NOT EXISTS idx_flows_belong_id ON flows(belong_id);
CREATE INDEX IF NOT EXISTS idx_debts_belong_id ON debts(belong_id);
CREATE INDEX IF NOT EXISTS idx_recurring_schedules_belong_id ON recurring_schedules(belong_id);
CREATE INDEX IF NOT EXISTS idx_flow_expense_categories_belong_id ON flow_expense_categories(belong_id);

-- ============================================
-- Step 5: Create NEW RLS policies using belong_id
-- ============================================

-- Assets RLS
CREATE POLICY "Users can view own or family assets"
  ON assets FOR SELECT
  USING (
    belong_id = auth.uid()
    OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can insert assets"
  ON assets FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      belong_id = auth.uid()
      OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "Users can update own or family assets"
  ON assets FOR UPDATE
  USING (
    belong_id = auth.uid()
    OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete own or family assets"
  ON assets FOR DELETE
  USING (
    belong_id = auth.uid()
    OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );

-- Flows RLS
CREATE POLICY "Users can view own or family flows"
  ON flows FOR SELECT
  USING (
    belong_id = auth.uid()
    OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can insert flows"
  ON flows FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      belong_id = auth.uid()
      OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "Users can update own or family flows"
  ON flows FOR UPDATE
  USING (
    belong_id = auth.uid()
    OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete own or family flows"
  ON flows FOR DELETE
  USING (
    belong_id = auth.uid()
    OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );

-- Debts RLS
CREATE POLICY "Users can view own or family debts"
  ON debts FOR SELECT
  USING (
    belong_id = auth.uid()
    OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can insert debts"
  ON debts FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      belong_id = auth.uid()
      OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "Users can update own or family debts"
  ON debts FOR UPDATE
  USING (
    belong_id = auth.uid()
    OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete own or family debts"
  ON debts FOR DELETE
  USING (
    belong_id = auth.uid()
    OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );

-- Recurring Schedules RLS
CREATE POLICY "Users can view own or family recurring_schedules"
  ON recurring_schedules FOR SELECT
  USING (
    belong_id = auth.uid()
    OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can insert recurring_schedules"
  ON recurring_schedules FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      belong_id = auth.uid()
      OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "Users can update own or family recurring_schedules"
  ON recurring_schedules FOR UPDATE
  USING (
    belong_id = auth.uid()
    OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete own or family recurring_schedules"
  ON recurring_schedules FOR DELETE
  USING (
    belong_id = auth.uid()
    OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );

-- Flow Expense Categories RLS
CREATE POLICY "Users can view own or family flow_expense_categories"
  ON flow_expense_categories FOR SELECT
  USING (
    belong_id = auth.uid()
    OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can insert flow_expense_categories"
  ON flow_expense_categories FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      belong_id = auth.uid()
      OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "Users can update own or family flow_expense_categories"
  ON flow_expense_categories FOR UPDATE
  USING (
    belong_id = auth.uid()
    OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete own or family flow_expense_categories"
  ON flow_expense_categories FOR DELETE
  USING (
    belong_id = auth.uid()
    OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );
