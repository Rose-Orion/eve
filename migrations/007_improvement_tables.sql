-- Migration 007: Self-Improvement Engine Tables
-- Tracks improvement proposals, preference patterns, and A/B tests for continuous optimization.

CREATE TABLE IF NOT EXISTS improvement_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID REFERENCES floors(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  target_agent TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  what_changes TEXT NOT NULL,
  current_state TEXT,
  proposed_state TEXT NOT NULL,
  evidence JSONB NOT NULL,
  expected_impact TEXT,
  risk_level TEXT NOT NULL DEFAULT 'low',
  rollback_plan TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  impact_measured_at TIMESTAMPTZ,
  impact_result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_improvement_floor_id ON improvement_proposals(floor_id);
CREATE INDEX IF NOT EXISTS idx_improvement_status ON improvement_proposals(status);
CREATE INDEX IF NOT EXISTS idx_improvement_target_agent ON improvement_proposals(target_agent);

CREATE TABLE IF NOT EXISTS preference_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  agent_role TEXT NOT NULL,
  pattern_key TEXT NOT NULL,
  pattern_value JSONB NOT NULL,
  confidence NUMERIC(5, 2) NOT NULL DEFAULT 0.0,
  samples_counted INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (floor_id, agent_role, pattern_key)
);

CREATE INDEX IF NOT EXISTS idx_preference_floor_id ON preference_patterns(floor_id);
CREATE INDEX IF NOT EXISTS idx_preference_agent_role ON preference_patterns(agent_role);

CREATE TABLE IF NOT EXISTS playbook_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  agent_role TEXT NOT NULL,
  scenario TEXT NOT NULL,
  response TEXT NOT NULL,
  effectiveness_score NUMERIC(5, 2),
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_playbook_floor_id ON playbook_entries(floor_id);
CREATE INDEX IF NOT EXISTS idx_playbook_agent_role ON playbook_entries(agent_role);

CREATE TABLE IF NOT EXISTS ab_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  test_name TEXT NOT NULL,
  variant_a TEXT NOT NULL,
  variant_b TEXT NOT NULL,
  metric_tracked TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  variant_a_metric NUMERIC(10, 4),
  variant_b_metric NUMERIC(10, 4),
  winner TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ab_tests_floor_id ON ab_tests(floor_id);
CREATE INDEX IF NOT EXISTS idx_ab_tests_status ON ab_tests(status);
