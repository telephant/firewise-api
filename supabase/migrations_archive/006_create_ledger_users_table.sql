-- Create ledger users table for membership
CREATE TABLE IF NOT EXISTS ledger_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role VARCHAR(20) DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ledger_id, user_id)
);

-- Enable RLS
ALTER TABLE ledger_users ENABLE ROW LEVEL SECURITY;

-- Users can view ledger memberships for ledgers they belong to
CREATE POLICY "Users can view ledger memberships"
  ON ledger_users FOR SELECT
  TO authenticated
  USING (
    ledger_id IN (
      SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()
    )
  );

-- Only owners can add members
CREATE POLICY "Owners can add members"
  ON ledger_users FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid() AND
    (
      -- Owner adding themselves when creating ledger
      (user_id = auth.uid() AND role = 'owner')
      OR
      -- Owner inviting members
      EXISTS (
        SELECT 1 FROM ledger_users
        WHERE ledger_id = ledger_users.ledger_id
        AND user_id = auth.uid()
        AND role = 'owner'
      )
    )
  );

-- Only owners can remove members
CREATE POLICY "Owners can remove members"
  ON ledger_users FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ledger_users lu
      WHERE lu.ledger_id = ledger_users.ledger_id
      AND lu.user_id = auth.uid()
      AND lu.role = 'owner'
    )
  );

-- Now add policies for ledgers table
CREATE POLICY "Users can view their ledgers"
  ON ledgers FOR SELECT
  TO authenticated
  USING (
    id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can create ledgers"
  ON ledgers FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Members can update ledger"
  ON ledgers FOR UPDATE
  TO authenticated
  USING (
    id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Owners can delete ledger"
  ON ledgers FOR DELETE
  TO authenticated
  USING (
    id IN (
      SELECT ledger_id FROM ledger_users
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );
