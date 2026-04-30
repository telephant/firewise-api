-- Migration: Allow NULL user_id for family-owned data
-- Data ownership is mutually exclusive:
-- Personal data: user_id = X, family_id = NULL
-- Family data: user_id = NULL, family_id = Y

-- Drop NOT NULL constraint on user_id for assets
ALTER TABLE assets ALTER COLUMN user_id DROP NOT NULL;

-- Drop NOT NULL constraint on user_id for flows
ALTER TABLE flows ALTER COLUMN user_id DROP NOT NULL;

-- Drop NOT NULL constraint on user_id for debts
ALTER TABLE debts ALTER COLUMN user_id DROP NOT NULL;

-- Drop NOT NULL constraint on user_id for recurring_schedules
ALTER TABLE recurring_schedules ALTER COLUMN user_id DROP NOT NULL;

-- Drop NOT NULL constraint on user_id for flow_expense_categories
ALTER TABLE flow_expense_categories ALTER COLUMN user_id DROP NOT NULL;

-- Add check constraint to ensure data has either user_id OR family_id (not both, not neither)
ALTER TABLE assets ADD CONSTRAINT assets_ownership_check
  CHECK (
    (user_id IS NOT NULL AND family_id IS NULL) OR
    (user_id IS NULL AND family_id IS NOT NULL)
  );

ALTER TABLE flows ADD CONSTRAINT flows_ownership_check
  CHECK (
    (user_id IS NOT NULL AND family_id IS NULL) OR
    (user_id IS NULL AND family_id IS NOT NULL)
  );

ALTER TABLE debts ADD CONSTRAINT debts_ownership_check
  CHECK (
    (user_id IS NOT NULL AND family_id IS NULL) OR
    (user_id IS NULL AND family_id IS NOT NULL)
  );

ALTER TABLE recurring_schedules ADD CONSTRAINT recurring_schedules_ownership_check
  CHECK (
    (user_id IS NOT NULL AND family_id IS NULL) OR
    (user_id IS NULL AND family_id IS NOT NULL)
  );

ALTER TABLE flow_expense_categories ADD CONSTRAINT flow_expense_categories_ownership_check
  CHECK (
    (user_id IS NOT NULL AND family_id IS NULL) OR
    (user_id IS NULL AND family_id IS NOT NULL)
  );
