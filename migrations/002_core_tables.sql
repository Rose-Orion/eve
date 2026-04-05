-- Migration 002: Core Tables (floors, phases, agents)
-- These are the foundational tables for floor management and agent coordination.

CREATE TABLE IF NOT EXISTS floors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planning',
  brand_state JSONB,
  budget_ceiling_cents INTEGER NOT NULL DEFAULT 0,
  spent_cents INTEGER NOT NULL DEFAULT 0,
  current_phase INTEGER NOT NULL DEFAULT 1,
  config JSONB,
  selected_brand JSONB,
  theme_config JSONB,
  growth_cycle INTEGER DEFAULT 0,
  trust_state JSONB,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_floors_status ON floors(status);
CREATE INDEX IF NOT EXISTS idx_floors_created_at ON floors(created_at);

CREATE TABLE IF NOT EXISTS phases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  phase_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  gate_approved BOOLEAN DEFAULT FALSE,
  gate_approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (floor_id, phase_number)
);

CREATE INDEX IF NOT EXISTS idx_phases_floor_id ON phases(floor_id);
CREATE INDEX IF NOT EXISTS idx_phases_status ON phases(status);
CREATE INDEX IF NOT EXISTS idx_phases_floor_phase ON phases(floor_id, phase_number);

CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  model_tier TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  current_task TEXT,
  openclaw_agent_id TEXT,
  config JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (floor_id, role)
);

CREATE INDEX IF NOT EXISTS idx_agents_floor_id ON agents(floor_id);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
