-- Add 'metals' to the asset_type enum for precious metals (gold, silver, etc.)
ALTER TYPE asset_type ADD VALUE IF NOT EXISTS 'metals';
