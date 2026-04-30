-- Rename columns in recurring_schedules table to match transaction-based naming

-- Rename source_flow_id to source_transaction_id
ALTER TABLE recurring_schedules RENAME COLUMN source_flow_id TO source_transaction_id;

-- Rename flow_template to transaction_template
ALTER TABLE recurring_schedules RENAME COLUMN flow_template TO transaction_template;

-- Update indexes
DROP INDEX IF EXISTS idx_recurring_schedules_source_flow_id;
CREATE INDEX IF NOT EXISTS idx_recurring_schedules_source_transaction_id ON recurring_schedules(source_transaction_id);
