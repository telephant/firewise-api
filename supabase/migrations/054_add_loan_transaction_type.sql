-- Add 'loan' to transaction_type enum for loan disbursements
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'loan';
