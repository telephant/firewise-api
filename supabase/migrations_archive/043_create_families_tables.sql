-- Migration: Create family sharing tables
-- families, family_members, family_invitations

-- families: The family unit
CREATE TABLE families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- family_members: Links users to families (1 user = 1 family max)
CREATE TABLE family_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)  -- User can only belong to ONE family
);

-- family_invitations: Email-based invites with tokens
CREATE TABLE family_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  token VARCHAR(64) NOT NULL UNIQUE,
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ
);

-- Indexes for performance
CREATE INDEX idx_family_members_family_id ON family_members(family_id);
CREATE INDEX idx_family_members_user_id ON family_members(user_id);
CREATE INDEX idx_family_invitations_family_id ON family_invitations(family_id);
CREATE INDEX idx_family_invitations_token ON family_invitations(token);
CREATE INDEX idx_family_invitations_email ON family_invitations(email);

-- Enable RLS
ALTER TABLE families ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_invitations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for families
-- Users can view families they are members of
CREATE POLICY "Users can view their family"
  ON families FOR SELECT
  USING (
    id IN (
      SELECT family_id FROM family_members WHERE user_id = auth.uid()
    )
  );

-- Users can create families
CREATE POLICY "Users can create families"
  ON families FOR INSERT
  WITH CHECK (created_by = auth.uid());

-- Only creator can update family
CREATE POLICY "Creator can update family"
  ON families FOR UPDATE
  USING (created_by = auth.uid());

-- Only creator can delete family
CREATE POLICY "Creator can delete family"
  ON families FOR DELETE
  USING (created_by = auth.uid());

-- RLS Policies for family_members
-- Users can view members of their family
CREATE POLICY "Users can view family members"
  ON family_members FOR SELECT
  USING (
    family_id IN (
      SELECT family_id FROM family_members WHERE user_id = auth.uid()
    )
  );

-- Family members can add new members (for accepting invites)
CREATE POLICY "Users can join families"
  ON family_members FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can leave families (delete their own membership)
CREATE POLICY "Users can leave families"
  ON family_members FOR DELETE
  USING (user_id = auth.uid());

-- Family creator can remove members
CREATE POLICY "Creator can remove members"
  ON family_members FOR DELETE
  USING (
    family_id IN (
      SELECT id FROM families WHERE created_by = auth.uid()
    )
  );

-- RLS Policies for family_invitations
-- Family members can view invitations for their family
CREATE POLICY "Family members can view invitations"
  ON family_invitations FOR SELECT
  USING (
    family_id IN (
      SELECT family_id FROM family_members WHERE user_id = auth.uid()
    )
  );

-- Anyone can view invitation by token (for accepting)
CREATE POLICY "Anyone can view invitation by token"
  ON family_invitations FOR SELECT
  USING (true);

-- Family members can create invitations
CREATE POLICY "Family members can create invitations"
  ON family_invitations FOR INSERT
  WITH CHECK (
    family_id IN (
      SELECT family_id FROM family_members WHERE user_id = auth.uid()
    )
    AND invited_by = auth.uid()
  );

-- Family members can update invitations (mark as accepted)
CREATE POLICY "Users can accept invitations"
  ON family_invitations FOR UPDATE
  USING (true);

-- Family creator can delete invitations
CREATE POLICY "Creator can delete invitations"
  ON family_invitations FOR DELETE
  USING (
    family_id IN (
      SELECT id FROM families WHERE created_by = auth.uid()
    )
  );
