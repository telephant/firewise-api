-- =====================================================
-- Create User Preferences Table
-- =====================================================
-- Stores user preferences including currency settings
-- Expandable for future preference types (theme, locale, etc.)

CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Currency preferences
  preferred_currency VARCHAR(3) DEFAULT 'USD',           -- User's preferred currency for stats
  convert_all_to_preferred BOOLEAN DEFAULT false,        -- Show all amounts in preferred currency

  -- Future expandable fields:
  -- theme VARCHAR(20) DEFAULT 'light',
  -- locale VARCHAR(10) DEFAULT 'en-US',
  -- date_format VARCHAR(20) DEFAULT 'MM/DD/YYYY',
  -- number_format VARCHAR(20) DEFAULT 'comma',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- RLS
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own preferences" ON user_preferences
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own preferences" ON user_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own preferences" ON user_preferences
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Index for quick lookup by user
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);

-- Trigger to update updated_at on changes
CREATE OR REPLACE FUNCTION update_user_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_user_preferences_updated_at();
