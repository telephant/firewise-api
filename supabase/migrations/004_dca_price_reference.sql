-- Add price_reference and price_delay_minutes to dca_plans
ALTER TABLE dca_plans
  ADD COLUMN IF NOT EXISTS price_reference TEXT NOT NULL DEFAULT 'close' CHECK (price_reference IN ('open', 'close', 'delay')),
  ADD COLUMN IF NOT EXISTS price_delay_minutes INTEGER DEFAULT NULL;
