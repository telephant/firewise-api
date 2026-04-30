-- Create recurring_schedules table for managing recurring flows
-- Stores the template and schedule for auto-generating flows

-- Frequency enum (reuse existing or create)
DO $$ BEGIN
  CREATE TYPE recurring_frequency AS ENUM ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Recurring schedules table
CREATE TABLE IF NOT EXISTS recurring_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Link to the original flow that created this schedule
  source_flow_id UUID REFERENCES flows(id) ON DELETE SET NULL,

  -- Schedule configuration
  frequency recurring_frequency NOT NULL,
  next_run_date DATE NOT NULL,
  last_run_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,

  -- Flow template - stores all data needed to create a new flow
  flow_template JSONB NOT NULL,
  -- Expected structure:
  -- {
  --   "type": "income|expense|transfer",
  --   "amount": 5000,
  --   "currency": "USD",
  --   "from_asset_id": "uuid" | null,
  --   "to_asset_id": "uuid" | null,
  --   "debt_id": "uuid" | null,
  --   "category": "salary",
  --   "description": "Monthly salary",
  --   "metadata": {}
  -- }

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS policies
ALTER TABLE recurring_schedules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can view own schedules" ON recurring_schedules
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can create own schedules" ON recurring_schedules
    FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update own schedules" ON recurring_schedules
    FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can delete own schedules" ON recurring_schedules
    FOR DELETE USING (auth.uid() = user_id);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_recurring_schedules_user_id ON recurring_schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_recurring_schedules_next_run_date ON recurring_schedules(next_run_date);
CREATE INDEX IF NOT EXISTS idx_recurring_schedules_is_active ON recurring_schedules(is_active);
CREATE INDEX IF NOT EXISTS idx_recurring_schedules_source_flow_id ON recurring_schedules(source_flow_id);

-- Index for the script query: find active schedules due to run
CREATE INDEX IF NOT EXISTS idx_recurring_schedules_due
  ON recurring_schedules(next_run_date, is_active)
  WHERE is_active = true;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_recurring_schedules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_recurring_schedules_updated_at ON recurring_schedules;
CREATE TRIGGER trigger_recurring_schedules_updated_at
  BEFORE UPDATE ON recurring_schedules
  FOR EACH ROW
  EXECUTE FUNCTION update_recurring_schedules_updated_at();
