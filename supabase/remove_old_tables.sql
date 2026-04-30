-- ============================================================
-- TEMPORARY CLEANUP SCRIPT — Run ONCE before migration.sql
-- Drops all tables/enums from the old FIRE module that are
-- no longer needed after the portfolio-tracker refactor.
-- ============================================================

-- Drop tables in dependency order (dependents first)

-- 1. Tables that depend on recurring_schedules / transactions
DROP TABLE IF EXISTS recurring_schedules CASCADE;

-- 2. Old FIRE transaction tables
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS flows CASCADE;

-- 3. Old FIRE asset/debt tables
DROP TABLE IF EXISTS asset_interest_settings CASCADE;
DROP TABLE IF EXISTS assets CASCADE;
DROP TABLE IF EXISTS debts CASCADE;

-- 4. Old FIRE category / link tables
DROP TABLE IF EXISTS flow_expense_categories CASCADE;
DROP TABLE IF EXISTS fire_linked_ledgers CASCADE;

-- 5. Old FIRE snapshot / tax / preferences tables
DROP TABLE IF EXISTS monthly_financial_snapshots CASCADE;
DROP TABLE IF EXISTS user_tax_settings CASCADE;
DROP TABLE IF EXISTS user_preferences CASCADE;

-- Drop old ENUMs that were only used by the removed tables
DROP TYPE IF EXISTS asset_type CASCADE;
DROP TYPE IF EXISTS debt_type CASCADE;
DROP TYPE IF EXISTS flow_type CASCADE;
DROP TYPE IF EXISTS recurring_frequency CASCADE;
DROP TYPE IF EXISTS transaction_type CASCADE;

-- ============================================================
-- Verify: the following tables should still exist after this
-- script runs. Check with: \dt
--   profiles
--   ledgers, ledger_users, ledger_currencies
--   expense_categories, payment_methods, expenses
--   currency_exchange
--   feedback
--   families, family_members, family_invitations
--   portfolios, trades, dividends
--   portfolio_snapshots, price_cache
-- ============================================================
