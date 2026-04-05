-- Migration 004: Content Management Tables
-- Manages social media and marketing content creation, scheduling, and performance tracking.

CREATE TABLE IF NOT EXISTS content_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  media_url TEXT,
  caption TEXT,
  hashtags TEXT[] DEFAULT '{}',
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  post_id TEXT,
  created_by TEXT,
  approved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_queue_floor_id ON content_queue(floor_id);
CREATE INDEX IF NOT EXISTS idx_content_queue_status ON content_queue(status);
CREATE INDEX IF NOT EXISTS idx_content_queue_platform ON content_queue(platform);
CREATE INDEX IF NOT EXISTS idx_content_queue_published_at ON content_queue(published_at);

CREATE TABLE IF NOT EXISTS content_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID NOT NULL REFERENCES content_queue(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  saves INTEGER DEFAULT 0,
  reach INTEGER DEFAULT 0,
  engagement_rate NUMERIC(10, 4) DEFAULT 0.0,
  clicks INTEGER DEFAULT 0,
  revenue_attributed_cents INTEGER DEFAULT 0,
  measurement_window TEXT NOT NULL,
  measured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_perf_content_id ON content_performance(content_id);
CREATE INDEX IF NOT EXISTS idx_content_perf_platform ON content_performance(platform);

CREATE TABLE IF NOT EXISTS gold_standards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID REFERENCES floors(id) ON DELETE CASCADE,
  agent_role TEXT NOT NULL,
  task_type TEXT NOT NULL,
  description TEXT NOT NULL,
  output TEXT NOT NULL,
  quality_score INTEGER,
  approval_count INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gold_standards_floor_id ON gold_standards(floor_id);
CREATE INDEX IF NOT EXISTS idx_gold_standards_agent_role ON gold_standards(agent_role);
CREATE INDEX IF NOT EXISTS idx_gold_standards_task_type ON gold_standards(task_type);
