-- ============================================================
-- migration.sql — Single source-of-truth schema
-- Firewise: Ledger + Portfolio Tracker
--
-- Safe to re-run: uses IF NOT EXISTS + drops policies before recreating.
--
-- Tables (15):
--   Auth:      profiles
--   Ledger:    ledgers, ledger_users, ledger_currencies,
--              expense_categories, payment_methods, expenses
--   Shared:    currency_exchange, feedback
--   Family:    families, family_members, family_invitations
--   Portfolio: portfolios, trades, dividends,
--              portfolio_snapshots, price_cache
-- ============================================================

-- ── 0. Drop all existing policies (idempotent re-run safety) ─

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'profiles','ledgers','ledger_users','ledger_currencies',
        'expense_categories','payment_methods','expenses',
        'currency_exchange','feedback',
        'families','family_members','family_invitations',
        'portfolios','trades','dividends','portfolio_snapshots','price_cache',
        'dca_plans','dca_pending'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
  END LOOP;
END;
$$;


-- ── 1. profiles ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      VARCHAR(255),
  full_name  VARCHAR(255),
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are viewable by authenticated users"
  ON profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE POLICY "System can insert profiles"
  ON profiles FOR INSERT WITH CHECK (true);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO UPDATE SET
    email      = EXCLUDED.email,
    full_name  = COALESCE(NULLIF(EXCLUDED.full_name, ''), profiles.full_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url),
    updated_at = NOW();
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Error creating profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ── 2. ledgers ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ledgers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                VARCHAR(255) NOT NULL,
  description         TEXT,
  created_by          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  default_currency_id UUID,                            -- FK added after ledger_currencies
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ledgers ENABLE ROW LEVEL SECURITY;


-- ── 3. ledger_users ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ledger_users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id  UUID NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       VARCHAR(20) DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ledger_id, user_id)
);

ALTER TABLE ledger_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view ledger memberships"
  ON ledger_users FOR SELECT TO authenticated
  USING (ledger_id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()));

CREATE POLICY "Owners can add members"
  ON ledger_users FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid() AND (
      (user_id = auth.uid() AND role = 'owner')
      OR EXISTS (
        SELECT 1 FROM ledger_users lu
        WHERE lu.ledger_id = ledger_users.ledger_id
          AND lu.user_id   = auth.uid()
          AND lu.role      = 'owner'
      )
    )
  );

CREATE POLICY "Owners can remove members"
  ON ledger_users FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ledger_users lu
      WHERE lu.ledger_id = ledger_users.ledger_id
        AND lu.user_id   = auth.uid()
        AND lu.role      = 'owner'
    )
  );

-- Ledger policies (require ledger_users to exist first)
CREATE POLICY "Users can view their ledgers"
  ON ledgers FOR SELECT TO authenticated
  USING (id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()));

CREATE POLICY "Users can create ledgers"
  ON ledgers FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Members can update ledger"
  ON ledgers FOR UPDATE TO authenticated
  USING (id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()));

CREATE POLICY "Owners can delete ledger"
  ON ledgers FOR DELETE TO authenticated
  USING (id IN (
    SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid() AND role = 'owner'
  ));


-- ── 4. ledger_currencies ────────────────────────────────────

CREATE TABLE IF NOT EXISTS ledger_currencies (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       VARCHAR(3) NOT NULL,
  name       VARCHAR(50) NOT NULL,
  ledger_id  UUID REFERENCES ledgers(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ledger_id, code)
);

ALTER TABLE ledger_currencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view currencies in their ledgers"
  ON ledger_currencies FOR SELECT TO authenticated
  USING (ledger_id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()));

CREATE POLICY "Users can create currencies in their ledgers"
  ON ledger_currencies FOR INSERT TO authenticated
  WITH CHECK (ledger_id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()));

CREATE POLICY "Users can update currencies in their ledgers"
  ON ledger_currencies FOR UPDATE TO authenticated
  USING (ledger_id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()))
  WITH CHECK (ledger_id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete currencies in their ledgers"
  ON ledger_currencies FOR DELETE TO authenticated
  USING (ledger_id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()));

-- Now add the FK from ledgers → ledger_currencies
ALTER TABLE ledgers
  ADD CONSTRAINT IF NOT EXISTS fk_ledgers_default_currency
  FOREIGN KEY (default_currency_id) REFERENCES ledger_currencies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ledger_currencies_ledger ON ledger_currencies(ledger_id);


-- ── 5. expense_categories ───────────────────────────────────

CREATE TABLE IF NOT EXISTS expense_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(100) NOT NULL,
  ledger_id  UUID REFERENCES ledgers(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view categories in their ledgers"
  ON expense_categories FOR SELECT TO authenticated
  USING (ledger_id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()));

CREATE POLICY "Users can create categories in their ledgers"
  ON expense_categories FOR INSERT TO authenticated
  WITH CHECK (ledger_id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()));

CREATE POLICY "Users can update categories in their ledgers"
  ON expense_categories FOR UPDATE TO authenticated
  USING (ledger_id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()))
  WITH CHECK (ledger_id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete categories in their ledgers"
  ON expense_categories FOR DELETE TO authenticated
  USING (ledger_id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_expense_categories_ledger ON expense_categories(ledger_id);


-- ── 6. payment_methods ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS payment_methods (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  ledger_id   UUID REFERENCES ledgers(id) ON DELETE CASCADE,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view payment methods in their ledgers"
  ON payment_methods FOR SELECT TO authenticated
  USING (ledger_id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()));

CREATE POLICY "Users can create payment methods in their ledgers"
  ON payment_methods FOR INSERT TO authenticated
  WITH CHECK (ledger_id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()));

CREATE POLICY "Users can update payment methods in their ledgers"
  ON payment_methods FOR UPDATE TO authenticated
  USING (ledger_id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()))
  WITH CHECK (ledger_id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete payment methods in their ledgers"
  ON payment_methods FOR DELETE TO authenticated
  USING (ledger_id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_payment_methods_ledger ON payment_methods(ledger_id);


-- ── 7. expenses ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS expenses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(255) NOT NULL,
  ledger_id         UUID NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  category_id       UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
  description       TEXT,
  amount            DECIMAL(12,2) NOT NULL,
  currency_id       UUID NOT NULL REFERENCES ledger_currencies(id),
  payment_method_id UUID REFERENCES payment_methods(id) ON DELETE SET NULL,
  date              DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view expenses in their ledgers"
  ON expenses FOR SELECT TO authenticated
  USING (ledger_id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()));

CREATE POLICY "Users can create expenses in their ledgers"
  ON expenses FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid() AND
    ledger_id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update expenses in their ledgers"
  ON expenses FOR UPDATE TO authenticated
  USING (ledger_id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete expenses in their ledgers"
  ON expenses FOR DELETE TO authenticated
  USING (ledger_id IN (SELECT ledger_id FROM ledger_users WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_expenses_ledger_id              ON expenses(ledger_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date                   ON expenses(date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category_id            ON expenses(category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_payment_method_id      ON expenses(payment_method_id);
CREATE INDEX IF NOT EXISTS idx_expenses_ledger_date            ON expenses(ledger_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_ledger_category        ON expenses(ledger_id, category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_ledger_payment_method  ON expenses(ledger_id, payment_method_id);
CREATE INDEX IF NOT EXISTS idx_ledger_users_lookup             ON ledger_users(ledger_id, user_id);


-- ── 8. currency_exchange ────────────────────────────────────
-- Global exchange rate table, updated daily by task runner.
-- Both Ledger and Portfolio modules read from this.

CREATE TABLE IF NOT EXISTS currency_exchange (
  code       VARCHAR(10) PRIMARY KEY,   -- lowercase: usd, eur, cny
  name       VARCHAR(100),
  rate       DECIMAL(38,18) NOT NULL DEFAULT 1,
  date       DATE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE currency_exchange ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read currency exchange"
  ON currency_exchange FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_currency_exchange_updated ON currency_exchange(updated_at);
CREATE INDEX IF NOT EXISTS idx_currency_exchange_date    ON currency_exchange(date);


-- ── 9. feedback ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS feedback (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  type       VARCHAR(50) NOT NULL,   -- missing_stock | bug_report | feature_request | other
  content    JSONB NOT NULL,
  status     VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can create feedback"
  ON feedback FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can view own feedback"
  ON feedback FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_feedback_type    ON feedback(type);
CREATE INDEX IF NOT EXISTS idx_feedback_user    ON feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_status  ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);


-- ── 10. families ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS families (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  owner_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE families ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own families"
  ON families FOR ALL
  USING (owner_id = auth.uid());

CREATE POLICY "Family members can view family"
  ON families FOR SELECT
  USING (id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid()));


-- ── 11. family_members ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS family_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id  UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (family_id, user_id)
);

ALTER TABLE family_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Family members can view members"
  ON family_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can join families"
  ON family_members FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Family owners manage members"
  ON family_members FOR ALL
  USING (family_id IN (SELECT id FROM families WHERE owner_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_family_members_family_id ON family_members(family_id);
CREATE INDEX IF NOT EXISTS idx_family_members_user_id   ON family_members(user_id);


-- ── 12. family_invitations ──────────────────────────────────

CREATE TABLE IF NOT EXISTS family_invitations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  email       VARCHAR(255) NOT NULL,
  token       VARCHAR(64) NOT NULL UNIQUE,
  invited_by  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ
);

ALTER TABLE family_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Family members can view invitations"
  ON family_invitations FOR SELECT
  USING (
    family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
    OR true  -- anyone can view by token (for accepting)
  );

CREATE POLICY "Family members can create invitations"
  ON family_invitations FOR INSERT
  WITH CHECK (
    invited_by = auth.uid() AND
    family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can accept invitations"
  ON family_invitations FOR UPDATE USING (true);

CREATE POLICY "Creator can delete invitations"
  ON family_invitations FOR DELETE
  USING (family_id IN (SELECT id FROM families WHERE owner_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_family_invitations_family_id ON family_invitations(family_id);
CREATE INDEX IF NOT EXISTS idx_family_invitations_token     ON family_invitations(token);
CREATE INDEX IF NOT EXISTS idx_family_invitations_email     ON family_invitations(email);


-- ── 13. portfolios ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS portfolios (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  belong_id   UUID NOT NULL,   -- user_id (personal) or family_id (shared)
  name        TEXT NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'USD',
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access own portfolios"
  ON portfolios FOR ALL
  USING (
    belong_id = auth.uid() OR
    belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_portfolios_belong_id ON portfolios(belong_id);


-- ── 14. trades ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trades (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  ticker       TEXT NOT NULL,
  market       TEXT NOT NULL DEFAULT 'US' CHECK (market IN ('US', 'SGX', 'HK', 'CN')),
  type         TEXT NOT NULL CHECK (type IN ('buy', 'sell')),
  shares       DECIMAL(18,8) NOT NULL CHECK (shares > 0),
  price        DECIMAL(18,8) NOT NULL CHECK (price >= 0),
  currency     TEXT NOT NULL DEFAULT 'USD',
  date         DATE NOT NULL,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access trades"
  ON trades FOR ALL
  USING (
    portfolio_id IN (
      SELECT id FROM portfolios WHERE
        belong_id = auth.uid() OR
        belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
    )
  );

CREATE INDEX IF NOT EXISTS idx_trades_portfolio_id     ON trades(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_trades_ticker           ON trades(ticker);
CREATE INDEX IF NOT EXISTS idx_trades_date             ON trades(date);
CREATE INDEX IF NOT EXISTS idx_trades_portfolio_ticker ON trades(portfolio_id, ticker);


-- ── 15. dividends ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dividends (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id     UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  ticker           TEXT NOT NULL,
  shares_at_exdate DECIMAL(18,8) NOT NULL DEFAULT 0,
  amount_per_share DECIMAL(18,8) NOT NULL DEFAULT 0,
  total_amount     DECIMAL(18,8) NOT NULL DEFAULT 0,
  currency         TEXT NOT NULL DEFAULT 'USD',
  tax_rate         DECIMAL(5,4)  NOT NULL DEFAULT 0,
  tax_withheld     DECIMAL(18,8) NOT NULL DEFAULT 0,
  ex_date          DATE NOT NULL,
  pay_date         DATE,
  source           TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manual')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (portfolio_id, ticker, ex_date)
);

ALTER TABLE dividends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access dividends"
  ON dividends FOR ALL
  USING (
    portfolio_id IN (
      SELECT id FROM portfolios WHERE
        belong_id = auth.uid() OR
        belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
    )
  );

CREATE INDEX IF NOT EXISTS idx_dividends_portfolio_id ON dividends(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_dividends_ticker       ON dividends(ticker);
CREATE INDEX IF NOT EXISTS idx_dividends_ex_date      ON dividends(ex_date);


-- ── 16. portfolio_snapshots ─────────────────────────────────

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id  UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  total_value   DECIMAL(20,2) NOT NULL DEFAULT 0,
  total_cost    DECIMAL(20,2) NOT NULL DEFAULT 0,
  unrealized_pl DECIMAL(20,2) NOT NULL DEFAULT 0,
  realized_pl   DECIMAL(20,2) NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'USD',
  detail        JSONB DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (portfolio_id, snapshot_date)
);

ALTER TABLE portfolio_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access snapshots"
  ON portfolio_snapshots FOR ALL
  USING (
    portfolio_id IN (
      SELECT id FROM portfolios WHERE
        belong_id = auth.uid() OR
        belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
    )
  );

CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_portfolio_id ON portfolio_snapshots(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_date         ON portfolio_snapshots(snapshot_date);


-- ── 17. price_cache ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS price_cache (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker     TEXT NOT NULL,
  date       DATE NOT NULL,
  price      DECIMAL(18,8) NOT NULL,
  currency   TEXT NOT NULL DEFAULT 'USD',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticker, date)
);

ALTER TABLE price_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read price cache"
  ON price_cache FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE INDEX IF NOT EXISTS idx_price_cache_ticker_date ON price_cache(ticker, date);


-- ── 18. DCA Plans ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dca_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id    UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  ticker          TEXT NOT NULL,
  market          TEXT NOT NULL CHECK (market IN ('US', 'SGX', 'HK', 'CN')),
  currency        TEXT NOT NULL,
  frequency       TEXT NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
  mode            TEXT NOT NULL CHECK (mode IN ('amount', 'shares')),
  amount          DECIMAL(18,8),
  shares          DECIMAL(18,8),
  next_run_date   DATE NOT NULL,
  last_run_date   DATE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE dca_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dca_plans_access" ON dca_plans
  USING (portfolio_id IN (
    SELECT id FROM portfolios
    WHERE belong_id = auth.uid()
       OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  ));


-- ── 19. DCA Pending ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dca_pending (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dca_plan_id       UUID NOT NULL REFERENCES dca_plans(id) ON DELETE CASCADE,
  portfolio_id      UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  ticker            TEXT NOT NULL,
  market            TEXT NOT NULL,
  currency          TEXT NOT NULL,
  scheduled_date    DATE NOT NULL,
  mode              TEXT NOT NULL CHECK (mode IN ('amount', 'shares')),
  amount            DECIMAL(18,8),
  shares            DECIMAL(18,8),
  suggested_price   DECIMAL(18,8),
  suggested_shares  DECIMAL(18,8),
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'skipped')),
  confirmed_price   DECIMAL(18,8),
  confirmed_shares  DECIMAL(18,8),
  trade_id          UUID REFERENCES trades(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE dca_pending ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dca_pending_access" ON dca_pending
  USING (portfolio_id IN (
    SELECT id FROM portfolios
    WHERE belong_id = auth.uid()
       OR belong_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  ));
