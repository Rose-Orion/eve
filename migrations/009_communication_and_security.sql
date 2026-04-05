-- Migration 009: Communication and Security Logging
-- Tracks floor conversations, command execution, and security events.

CREATE TABLE IF NOT EXISTS floor_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,
  role TEXT NOT NULL,
  message TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_floor_id ON floor_chat_messages(floor_id);
CREATE INDEX IF NOT EXISTS idx_chat_sender ON floor_chat_messages(sender);
CREATE INDEX IF NOT EXISTS idx_chat_timestamp ON floor_chat_messages(timestamp);

CREATE TABLE IF NOT EXISTS command_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  command TEXT NOT NULL,
  agent TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'executed',
  result TEXT,
  error_message TEXT,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_command_floor_id ON command_log(floor_id);
CREATE INDEX IF NOT EXISTS idx_command_status ON command_log(status);
CREATE INDEX IF NOT EXISTS idx_command_executed_at ON command_log(executed_at);

CREATE TABLE IF NOT EXISTS security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'low',
  actor TEXT,
  action TEXT NOT NULL,
  resource TEXT,
  result TEXT,
  details JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_floor_id ON security_events(floor_id);
CREATE INDEX IF NOT EXISTS idx_security_event_type ON security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_security_severity ON security_events(severity);
