-- Migration: Fix asset unique constraint for family support
-- Change unique constraint from (user_id, name) to (belong_id, name)
-- This allows the same asset name to exist in both personal and family contexts

-- Drop the old constraint (user_id, name)
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_user_id_name_key;

-- First, rename any duplicate (belong_id, name) entries by appending a suffix
-- This handles cases where the same name exists multiple times for the same belong_id
DO $$
DECLARE
    dup RECORD;
    counter INTEGER;
BEGIN
    FOR dup IN
        SELECT belong_id, name
        FROM assets
        GROUP BY belong_id, name
        HAVING COUNT(*) > 1
    LOOP
        counter := 1;
        FOR dup IN
            SELECT id
            FROM assets
            WHERE belong_id = dup.belong_id AND name = dup.name
            ORDER BY created_at DESC
            OFFSET 1  -- Skip the first (newest) one
        LOOP
            UPDATE assets
            SET name = name || ' (' || counter || ')'
            WHERE id = dup.id;
            counter := counter + 1;
        END LOOP;
    END LOOP;
END $$;

-- Add new constraint on (belong_id, name)
-- This ensures unique names within each ownership context (personal or family)
ALTER TABLE assets ADD CONSTRAINT assets_belong_id_name_key UNIQUE (belong_id, name);

-- Add index for better query performance on belong_id
CREATE INDEX IF NOT EXISTS idx_assets_belong_id ON assets(belong_id);
