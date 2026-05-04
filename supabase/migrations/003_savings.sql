-- firewise-api/supabase/migrations/003_savings.sql

CREATE TABLE savings_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  belong_id           UUID NOT NULL,
  name                TEXT NOT NULL,
  bank                TEXT,
  currency            TEXT NOT NULL DEFAULT 'USD',
  balance             NUMERIC(18,2) NOT NULL DEFAULT 0,
  interest_rate       NUMERIC(8,4) NOT NULL,
  compound_frequency  TEXT NOT NULL DEFAULT 'monthly'
                        CHECK (compound_frequency IN ('monthly','quarterly','semi_annual','annual')),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX savings_accounts_belong_id_idx ON savings_accounts(belong_id);

CREATE TABLE interest_records (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES savings_accounts(id) ON DELETE CASCADE,
  amount       NUMERIC(18,2) NOT NULL,
  credited_at  DATE NOT NULL,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX interest_records_account_id_idx ON interest_records(account_id);
