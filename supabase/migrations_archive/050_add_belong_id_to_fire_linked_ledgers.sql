-- Migration: Add belong_id to fire_linked_ledgers
-- This table was missed in the 047_simplify_to_belong_id migration

-- Step 1: Add belong_id column
ALTER TABLE fire_linked_ledgers ADD COLUMN IF NOT EXISTS belong_id UUID;

-- Step 2: Backfill existing data
-- If user is in a family, belong_id = family_id
-- Otherwise, belong_id = user_id (personal mode)
UPDATE fire_linked_ledgers fll
SET belong_id = COALESCE(
  (SELECT fm.family_id FROM family_members fm WHERE fm.user_id = fll.user_id LIMIT 1),
  fll.user_id
)
WHERE belong_id IS NULL OR belong_id = fll.user_id;

-- Step 3: Make belong_id NOT NULL
ALTER TABLE fire_linked_ledgers ALTER COLUMN belong_id SET NOT NULL;

-- Step 4: Add index for belong_id
CREATE INDEX IF NOT EXISTS idx_fire_linked_ledgers_belong_id ON fire_linked_ledgers(belong_id);

-- Step 5: Update RLS policies to use belong_id
DROP POLICY IF EXISTS "Users can view own linked ledgers" ON fire_linked_ledgers;
DROP POLICY IF EXISTS "Users can insert own linked ledgers" ON fire_linked_ledgers;
DROP POLICY IF EXISTS "Users can delete own linked ledgers" ON fire_linked_ledgers;
DROP POLICY IF EXISTS "Users can view own or family linked ledgers" ON fire_linked_ledgers;
DROP POLICY IF EXISTS "Users can insert linked ledgers" ON fire_linked_ledgers;
DROP POLICY IF EXISTS "Users can delete own or family linked ledgers" ON fire_linked_ledgers;

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
