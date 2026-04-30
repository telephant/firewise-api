-- Migration: Fix seed_default_flow_expense_categories to include belong_id
-- Also update unique constraint to use belong_id
-- Also add belong_id to fire_linked_ledgers for family sharing

-- ============================================
-- Fix flow_expense_categories
-- ============================================

-- Drop old unique constraint and create new one
ALTER TABLE flow_expense_categories DROP CONSTRAINT IF EXISTS flow_expense_categories_user_id_name_key;
ALTER TABLE flow_expense_categories ADD CONSTRAINT flow_expense_categories_belong_id_name_key UNIQUE(belong_id, name);

-- Update the seed function to include belong_id (defaults to user_id for personal mode)
CREATE OR REPLACE FUNCTION seed_default_flow_expense_categories(p_user_id UUID)
RETURNS void AS $$
BEGIN
  INSERT INTO flow_expense_categories (user_id, belong_id, name, icon, color, sort_order)
  VALUES
    (p_user_id, p_user_id, 'Food', '🍔', '#f97316', 1),
    (p_user_id, p_user_id, 'Housing', '🏠', '#3b82f6', 2),
    (p_user_id, p_user_id, 'Transport', '🚗', '#8b5cf6', 3),
    (p_user_id, p_user_id, 'Utilities', '⚡', '#eab308', 4),
    (p_user_id, p_user_id, 'Shopping', '🛍️', '#ec4899', 5),
    (p_user_id, p_user_id, 'Health', '💊', '#22c55e', 6),
    (p_user_id, p_user_id, 'Entertainment', '🎬', '#f43f5e', 7),
    (p_user_id, p_user_id, 'Other', '📦', '#6b7280', 8)
  ON CONFLICT (belong_id, name) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Add belong_id to fire_linked_ledgers
-- ============================================

-- Add belong_id column
ALTER TABLE fire_linked_ledgers ADD COLUMN IF NOT EXISTS belong_id UUID;
UPDATE fire_linked_ledgers SET belong_id = user_id WHERE belong_id IS NULL;
ALTER TABLE fire_linked_ledgers ALTER COLUMN belong_id SET NOT NULL;

-- Add index
CREATE INDEX IF NOT EXISTS idx_fire_linked_ledgers_belong_id ON fire_linked_ledgers(belong_id);

-- Update RLS policies
DROP POLICY IF EXISTS "Users can view their own linked ledgers" ON fire_linked_ledgers;
DROP POLICY IF EXISTS "Users can insert their own linked ledgers" ON fire_linked_ledgers;
DROP POLICY IF EXISTS "Users can delete their own linked ledgers" ON fire_linked_ledgers;

CREATE POLICY "Users can view own or family linked ledgers"
  ON fire_linked_ledgers FOR SELECT
  USING (
    belong_id = auth.uid()
    OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can insert linked ledgers"
  ON fire_linked_ledgers FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      belong_id = auth.uid()
      OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "Users can delete own or family linked ledgers"
  ON fire_linked_ledgers FOR DELETE
  USING (
    belong_id = auth.uid()
    OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );
