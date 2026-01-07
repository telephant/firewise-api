-- Migration: Create fire_linked_ledgers table
-- This table tracks which ledgers a user has linked for FIRE expense tracking

CREATE TABLE fire_linked_ledgers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ledger_id UUID NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, ledger_id)
);

-- RLS
ALTER TABLE fire_linked_ledgers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their linked ledgers"
  ON fire_linked_ledgers FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Index for efficient lookups
CREATE INDEX idx_fire_linked_ledgers_user ON fire_linked_ledgers(user_id);
