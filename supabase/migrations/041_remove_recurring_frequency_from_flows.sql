-- Remove recurring_frequency from flows table
-- This field is now replaced by the recurring_schedules table

ALTER TABLE flows DROP COLUMN IF EXISTS recurring_frequency;
