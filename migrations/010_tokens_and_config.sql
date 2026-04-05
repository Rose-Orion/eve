-- Migration 010: Tokens, Configuration, and Webhooks
-- Manages approval tokens, floor configuration, webhooks, phase gates, and trust ladder.

CREATE TABLE IF NOT EXISTS floor_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  token_type TEXT NOT NULL,
  token_value TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_floor_tokens_floor_id ON floor_tokens(floor_id);
CREATE INDEX IF NOT EXISTS idx_floor_tokens_token_type ON floor_tokens(token_type);

CREATE TABLE IF NOT EXISTS floor_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE UNIQUE,
  config_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_floor_config_floor_id ON floor_config(floor_id);

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN DEFAULT FALSE,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webhook_floor_id ON webhook_events(floor_id);
CREATE INDEX IF NOT EXISTS idx_webhook_event_type ON webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_processed ON webhook_events(processed);

CREATE TABLE IF NOT EXISTS phase_gates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  phase_number INTEGER NOT NULL,
  gate_name TEXT NOT NULL,
  required_metrics JSONB,
  approval_status TEXT NOT NULL DEFAULT 'pending',
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (floor_id, phase_number)
);

CREATE INDEX IF NOT EXISTS idx_phase_gates_floor_id ON phase_gates(floor_id);

CREATE TABLE IF NOT EXISTS trust_ladder_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  agent_role TEXT NOT NULL,
  from_level TEXT NOT NULL,
  to_level TEXT NOT NULL,
  reason TEXT,
  evidence JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trust_history_floor_id ON trust_ladder_history(floor_id);
CREATE INDEX IF NOT EXISTS idx_trust_history_agent_role ON trust_ladder_history(agent_role);
