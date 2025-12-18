-- Create expense categories table
CREATE TABLE IF NOT EXISTS expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;

-- Users can view their own categories
CREATE POLICY "Users can view own categories"
  ON expense_categories FOR SELECT
  TO authenticated
  USING (created_by = auth.uid() OR created_by IS NULL);

-- Users can create their own categories
CREATE POLICY "Users can create own categories"
  ON expense_categories FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

-- Users can delete their own categories
CREATE POLICY "Users can delete own categories"
  ON expense_categories FOR DELETE
  TO authenticated
  USING (created_by = auth.uid());
