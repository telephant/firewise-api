-- Add 'deposit' to the asset_type enum for savings/deposit accounts
ALTER TYPE asset_type ADD VALUE IF NOT EXISTS 'deposit';
