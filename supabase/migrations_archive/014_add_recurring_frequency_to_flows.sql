-- =====================================================
-- Add recurring_frequency to flows table
-- =====================================================
-- Allows flows to be marked as recurring (weekly, monthly, etc.)
-- for automatic flow generation

-- Create recurring frequency enum
CREATE TYPE recurring_frequency AS ENUM (
  'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'
);

-- Add column to flows table
ALTER TABLE flows
ADD COLUMN recurring_frequency recurring_frequency;

-- Index for querying recurring flows
CREATE INDEX idx_flows_recurring ON flows(user_id, recurring_frequency)
WHERE recurring_frequency IS NOT NULL;
