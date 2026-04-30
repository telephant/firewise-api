-- =====================================================
-- Add Singapore (SGX) Tax Settings
-- =====================================================
-- Singapore has 0% dividend withholding tax for most investors

ALTER TABLE user_tax_settings
ADD COLUMN IF NOT EXISTS sg_dividend_withholding_rate DECIMAL(5,4) DEFAULT 0.00,  -- 0% default (Singapore has no dividend withholding tax)
ADD COLUMN IF NOT EXISTS sg_capital_gains_rate DECIMAL(5,4) DEFAULT 0.00;         -- 0% default (Singapore has no capital gains tax)
