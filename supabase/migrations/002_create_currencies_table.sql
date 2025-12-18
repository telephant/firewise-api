-- Create currencies table
CREATE TABLE IF NOT EXISTS currencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(3) UNIQUE NOT NULL,
  name VARCHAR(50) NOT NULL,
  rate DECIMAL(10, 6) NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE currencies ENABLE ROW LEVEL SECURITY;

-- Currencies are viewable by everyone
CREATE POLICY "Currencies are viewable by authenticated users"
  ON currencies FOR SELECT
  TO authenticated
  USING (true);

-- Anyone can create currencies
CREATE POLICY "Authenticated users can create currencies"
  ON currencies FOR INSERT
  TO authenticated
  WITH CHECK (true);
