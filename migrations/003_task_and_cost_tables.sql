-- Migration 003: Task and Cost Tracking Tables
-- Tracks all task execution, costs, and agent performance metrics.

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  phase_number INTEGER NOT NULL,
  assigned_agent TEXT NOT NULL,
  model_tier TEXT NOT NULL,
  task_type TEXT NOT NULL,
  description TEXT NOT NULL,
  prompt TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  priority INTEGER NOT NULL DEFAULT 2,
  attempts INTEGER NOT NULL DEFAULT 0,
  estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
  actual_cost_cents INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  review_status TEXT NOT NULL DEFAULT 'pending',
  review_feedback TEXT,
  approval_token TEXT,
  input_files TEXT[] DEFAULT '{}',
  output_files TEXT[] DEFAULT '{}',
  depends_on TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatched_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_floor_id ON tasks(floor_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_phase ON tasks(floor_id, phase_number);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);

CREATE TABLE IF NOT EXISTS cost_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_cents INTEGER NOT NULL,
  task_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cost_events_floor_id ON cost_events(floor_id);
CREATE INDEX IF NOT EXISTS idx_cost_events_created_at ON cost_events(created_at);

CREATE TABLE IF NOT EXISTS agent_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  agent_role TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  tasks_completed INTEGER NOT NULL DEFAULT 0,
  approval_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.0,
  avg_revision_count NUMERIC(10, 2) NOT NULL DEFAULT 0.0,
  avg_time_seconds INTEGER NOT NULL DEFAULT 0,
  avg_cost_cents INTEGER NOT NULL DEFAULT 0,
  avg_turns INTEGER NOT NULL DEFAULT 0,
  quality_trend TEXT NOT NULL DEFAULT 'stable',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_perf_floor_id ON agent_performance(floor_id);
CREATE INDEX IF NOT EXISTS idx_agent_perf_agent_role ON agent_performance(agent_role);
