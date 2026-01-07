-- Migration 018: Create feedback table
-- Generic feedback table for different scenarios (missing stock, feature requests, bugs, etc.)

CREATE TABLE feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- Optional, can be anonymous
  type VARCHAR(50) NOT NULL, -- 'missing_stock', 'bug_report', 'feature_request', etc.
  content JSONB NOT NULL, -- Flexible content based on type
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'reviewed', 'resolved', 'rejected'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_feedback_type ON feedback(type);
CREATE INDEX idx_feedback_user ON feedback(user_id);
CREATE INDEX idx_feedback_status ON feedback(status);
CREATE INDEX idx_feedback_created ON feedback(created_at DESC);

-- RLS - Users can create feedback, but only see their own
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can create feedback
CREATE POLICY "Users can create feedback" ON feedback
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- Users can view their own feedback
CREATE POLICY "Users can view own feedback" ON feedback
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Comment: Content JSONB structure examples:
-- type: 'missing_stock' -> { "symbol": "TSLA", "market": "US", "note": "Tesla stock not found" }
-- type: 'bug_report' -> { "page": "/fire", "description": "...", "browser": "Chrome" }
-- type: 'feature_request' -> { "title": "...", "description": "..." }
