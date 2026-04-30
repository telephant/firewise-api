-- Migration: Fix family ownership model
-- Better design: Keep user_id (creator), family_id indicates sharing
-- Personal data: user_id = X, family_id = NULL
-- Family data: user_id = X, family_id = Y (user_id is creator)

-- Remove the incorrect check constraints from previous migration
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_ownership_check;
ALTER TABLE flows DROP CONSTRAINT IF EXISTS flows_ownership_check;
ALTER TABLE debts DROP CONSTRAINT IF EXISTS debts_ownership_check;
ALTER TABLE recurring_schedules DROP CONSTRAINT IF EXISTS recurring_schedules_ownership_check;
ALTER TABLE flow_expense_categories DROP CONSTRAINT IF EXISTS flow_expense_categories_ownership_check;

-- Restore NOT NULL constraint on user_id (every record must have a creator)
-- First update any NULL user_ids (shouldn't exist, but just in case)
-- Then add the constraint back

ALTER TABLE assets ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE flows ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE debts ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE recurring_schedules ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE flow_expense_categories ALTER COLUMN user_id SET NOT NULL;
