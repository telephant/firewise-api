-- Fix dividend flow metadata: rename "shares" to "share_count" to avoid
-- triggering balance recalculation on stock assets.
--
-- The balance trigger looks for metadata->>'shares' and incorrectly
-- subtracts it from stock balances when dividend flows have from_asset_id
-- set to a stock asset.

-- Step 1: Update existing dividend flows to use share_count instead of shares
UPDATE flows
SET metadata = (metadata - 'shares') || jsonb_build_object('share_count', metadata->>'shares')
WHERE category = 'dividend'
  AND metadata ? 'shares'
  AND metadata->>'shares' IS NOT NULL;

-- Step 2: Recalculate balance for all stock/etf/crypto assets
-- This fixes any assets that were corrupted by the bug
DO $$
DECLARE
  asset_record RECORD;
BEGIN
  FOR asset_record IN
    SELECT id FROM assets WHERE type IN ('stock', 'etf', 'crypto')
  LOOP
    PERFORM recalculate_asset_balance(asset_record.id);
  END LOOP;
END $$;

COMMENT ON TABLE flows IS 'Flows table. Note: For dividend flows, use share_count (not shares) in metadata to store the number of shares held at dividend payment time.';
