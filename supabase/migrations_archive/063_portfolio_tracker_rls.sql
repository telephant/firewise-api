-- Enable RLS on new tables
ALTER TABLE families ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE dividends ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_cache ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to manage their own families
CREATE POLICY "Users can manage own families" ON families
  FOR ALL USING (owner_id = auth.uid());

-- Allow family members to view family
CREATE POLICY "Family members can view" ON family_members
  FOR SELECT USING (user_id = auth.uid() OR family_id IN (
    SELECT family_id FROM family_members WHERE user_id = auth.uid()
  ));

-- Allow family owners to manage members
CREATE POLICY "Family owners manage members" ON family_members
  FOR ALL USING (
    family_id IN (SELECT id FROM families WHERE owner_id = auth.uid())
  );

-- Portfolios: accessible if belong_id matches user or their family
CREATE POLICY "Users can access own portfolios" ON portfolios
  FOR ALL USING (
    belong_id = auth.uid() OR
    belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );

-- Trades accessible through portfolio ownership
CREATE POLICY "Users can access trades" ON trades
  FOR ALL USING (
    portfolio_id IN (
      SELECT id FROM portfolios WHERE
        belong_id = auth.uid() OR
        belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
    )
  );

-- Dividends accessible through portfolio ownership
CREATE POLICY "Users can access dividends" ON dividends
  FOR ALL USING (
    portfolio_id IN (
      SELECT id FROM portfolios WHERE
        belong_id = auth.uid() OR
        belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
    )
  );

-- Portfolio snapshots accessible through portfolio ownership
CREATE POLICY "Users can access snapshots" ON portfolio_snapshots
  FOR ALL USING (
    portfolio_id IN (
      SELECT id FROM portfolios WHERE
        belong_id = auth.uid() OR
        belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
    )
  );

-- Price cache is read-only for authenticated users
CREATE POLICY "Authenticated users can read price cache" ON price_cache
  FOR SELECT USING (auth.role() = 'authenticated');
