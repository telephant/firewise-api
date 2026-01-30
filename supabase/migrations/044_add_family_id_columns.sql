-- Migration: Add family_id column to data tables
-- Data ownership: user_id OR family_id (mutually exclusive)
-- Personal data: user_id = X, family_id = NULL
-- Family data: user_id = NULL, family_id = Y

-- Add family_id to assets
ALTER TABLE assets ADD COLUMN family_id UUID REFERENCES families(id) ON DELETE SET NULL;
CREATE INDEX idx_assets_family_id ON assets(family_id);

-- Add family_id to flows
ALTER TABLE flows ADD COLUMN family_id UUID REFERENCES families(id) ON DELETE SET NULL;
CREATE INDEX idx_flows_family_id ON flows(family_id);

-- Add family_id to debts
ALTER TABLE debts ADD COLUMN family_id UUID REFERENCES families(id) ON DELETE SET NULL;
CREATE INDEX idx_debts_family_id ON debts(family_id);

-- Add family_id to recurring_schedules
ALTER TABLE recurring_schedules ADD COLUMN family_id UUID REFERENCES families(id) ON DELETE SET NULL;
CREATE INDEX idx_recurring_schedules_family_id ON recurring_schedules(family_id);

-- Add family_id to flow_expense_categories
ALTER TABLE flow_expense_categories ADD COLUMN family_id UUID REFERENCES families(id) ON DELETE SET NULL;
CREATE INDEX idx_flow_expense_categories_family_id ON flow_expense_categories(family_id);

-- Update RLS policies for assets to support family access
DROP POLICY IF EXISTS "Users can view own assets" ON assets;
DROP POLICY IF EXISTS "Users can insert own assets" ON assets;
DROP POLICY IF EXISTS "Users can update own assets" ON assets;
DROP POLICY IF EXISTS "Users can delete own assets" ON assets;

CREATE POLICY "Users can view own or family assets"
  ON assets FOR SELECT
  USING (
    user_id = auth.uid()
    OR (
      family_id IN (
        SELECT family_id FROM family_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can insert assets"
  ON assets FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR (
      family_id IN (
        SELECT family_id FROM family_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can update own or family assets"
  ON assets FOR UPDATE
  USING (
    user_id = auth.uid()
    OR (
      family_id IN (
        SELECT family_id FROM family_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can delete own or family assets"
  ON assets FOR DELETE
  USING (
    user_id = auth.uid()
    OR (
      family_id IN (
        SELECT family_id FROM family_members WHERE user_id = auth.uid()
      )
    )
  );

-- Update RLS policies for flows to support family access
DROP POLICY IF EXISTS "Users can view own flows" ON flows;
DROP POLICY IF EXISTS "Users can insert own flows" ON flows;
DROP POLICY IF EXISTS "Users can update own flows" ON flows;
DROP POLICY IF EXISTS "Users can delete own flows" ON flows;

CREATE POLICY "Users can view own or family flows"
  ON flows FOR SELECT
  USING (
    user_id = auth.uid()
    OR (
      family_id IN (
        SELECT family_id FROM family_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can insert flows"
  ON flows FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR (
      family_id IN (
        SELECT family_id FROM family_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can update own or family flows"
  ON flows FOR UPDATE
  USING (
    user_id = auth.uid()
    OR (
      family_id IN (
        SELECT family_id FROM family_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can delete own or family flows"
  ON flows FOR DELETE
  USING (
    user_id = auth.uid()
    OR (
      family_id IN (
        SELECT family_id FROM family_members WHERE user_id = auth.uid()
      )
    )
  );

-- Update RLS policies for debts to support family access
DROP POLICY IF EXISTS "Users can view own debts" ON debts;
DROP POLICY IF EXISTS "Users can insert own debts" ON debts;
DROP POLICY IF EXISTS "Users can update own debts" ON debts;
DROP POLICY IF EXISTS "Users can delete own debts" ON debts;

CREATE POLICY "Users can view own or family debts"
  ON debts FOR SELECT
  USING (
    user_id = auth.uid()
    OR (
      family_id IN (
        SELECT family_id FROM family_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can insert debts"
  ON debts FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR (
      family_id IN (
        SELECT family_id FROM family_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can update own or family debts"
  ON debts FOR UPDATE
  USING (
    user_id = auth.uid()
    OR (
      family_id IN (
        SELECT family_id FROM family_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can delete own or family debts"
  ON debts FOR DELETE
  USING (
    user_id = auth.uid()
    OR (
      family_id IN (
        SELECT family_id FROM family_members WHERE user_id = auth.uid()
      )
    )
  );

-- Update RLS policies for recurring_schedules to support family access
DROP POLICY IF EXISTS "Users can view own recurring_schedules" ON recurring_schedules;
DROP POLICY IF EXISTS "Users can insert own recurring_schedules" ON recurring_schedules;
DROP POLICY IF EXISTS "Users can update own recurring_schedules" ON recurring_schedules;
DROP POLICY IF EXISTS "Users can delete own recurring_schedules" ON recurring_schedules;

CREATE POLICY "Users can view own or family recurring_schedules"
  ON recurring_schedules FOR SELECT
  USING (
    user_id = auth.uid()
    OR (
      family_id IN (
        SELECT family_id FROM family_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can insert recurring_schedules"
  ON recurring_schedules FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR (
      family_id IN (
        SELECT family_id FROM family_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can update own or family recurring_schedules"
  ON recurring_schedules FOR UPDATE
  USING (
    user_id = auth.uid()
    OR (
      family_id IN (
        SELECT family_id FROM family_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can delete own or family recurring_schedules"
  ON recurring_schedules FOR DELETE
  USING (
    user_id = auth.uid()
    OR (
      family_id IN (
        SELECT family_id FROM family_members WHERE user_id = auth.uid()
      )
    )
  );

-- Update RLS policies for flow_expense_categories to support family access
DROP POLICY IF EXISTS "Users can view own flow_expense_categories" ON flow_expense_categories;
DROP POLICY IF EXISTS "Users can insert own flow_expense_categories" ON flow_expense_categories;
DROP POLICY IF EXISTS "Users can update own flow_expense_categories" ON flow_expense_categories;
DROP POLICY IF EXISTS "Users can delete own flow_expense_categories" ON flow_expense_categories;

CREATE POLICY "Users can view own or family flow_expense_categories"
  ON flow_expense_categories FOR SELECT
  USING (
    user_id = auth.uid()
    OR (
      family_id IN (
        SELECT family_id FROM family_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can insert flow_expense_categories"
  ON flow_expense_categories FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR (
      family_id IN (
        SELECT family_id FROM family_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can update own or family flow_expense_categories"
  ON flow_expense_categories FOR UPDATE
  USING (
    user_id = auth.uid()
    OR (
      family_id IN (
        SELECT family_id FROM family_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can delete own or family flow_expense_categories"
  ON flow_expense_categories FOR DELETE
  USING (
    user_id = auth.uid()
    OR (
      family_id IN (
        SELECT family_id FROM family_members WHERE user_id = auth.uid()
      )
    )
  );
