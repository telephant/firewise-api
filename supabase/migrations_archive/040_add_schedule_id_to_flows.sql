-- Add schedule_id to flows table to link flows to their recurring schedule
-- This allows tracking which flows were generated from a schedule

-- Add schedule_id column
ALTER TABLE flows
ADD COLUMN IF NOT EXISTS schedule_id UUID REFERENCES recurring_schedules(id) ON DELETE SET NULL;

-- Index for querying flows by schedule
CREATE INDEX IF NOT EXISTS idx_flows_schedule_id ON flows(schedule_id);

-- Comment for documentation
COMMENT ON COLUMN flows.schedule_id IS 'Links to the recurring schedule that generated this flow, or the schedule this flow belongs to';
