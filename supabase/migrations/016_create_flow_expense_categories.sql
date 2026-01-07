-- Migration 016: Create flow_expense_categories table for FIRE expense tracking
-- Separate from ledger expense_categories - these are user-specific for FIRE

-- Create the flow_expense_categories table
CREATE TABLE flow_expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  icon VARCHAR(50),
  color VARCHAR(20),
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- Add reference column to flows table
ALTER TABLE flows ADD COLUMN flow_expense_category_id UUID
  REFERENCES flow_expense_categories(id) ON DELETE SET NULL;

-- Indexes
CREATE INDEX idx_flow_expense_categories_user ON flow_expense_categories(user_id);
CREATE INDEX idx_flows_expense_category ON flows(flow_expense_category_id);

-- RLS
ALTER TABLE flow_expense_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own expense categories"
  ON flow_expense_categories FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can create their own expense categories"
  ON flow_expense_categories FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own expense categories"
  ON flow_expense_categories FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own expense categories"
  ON flow_expense_categories FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Function to seed default categories for a user
CREATE OR REPLACE FUNCTION seed_default_flow_expense_categories(p_user_id UUID)
RETURNS void AS $$
BEGIN
  INSERT INTO flow_expense_categories (user_id, name, icon, color, sort_order)
  VALUES
    (p_user_id, 'Food', '🍔', '#f97316', 1),
    (p_user_id, 'Housing', '🏠', '#3b82f6', 2),
    (p_user_id, 'Transport', '🚗', '#8b5cf6', 3),
    (p_user_id, 'Utilities', '⚡', '#eab308', 4),
    (p_user_id, 'Shopping', '🛍️', '#ec4899', 5),
    (p_user_id, 'Health', '💊', '#22c55e', 6),
    (p_user_id, 'Entertainment', '🎬', '#f43f5e', 7),
    (p_user_id, 'Other', '📦', '#6b7280', 8)
  ON CONFLICT (user_id, name) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
