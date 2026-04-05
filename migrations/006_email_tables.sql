-- Migration 006: Email Marketing Tables
-- Manages email subscribers and enrollment tracking for customer journeys.

CREATE TABLE IF NOT EXISTS email_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  email_hash TEXT NOT NULL,
  email_address TEXT,
  status TEXT NOT NULL DEFAULT 'subscribed',
  enrolled_sequences TEXT[] DEFAULT '{}',
  subscription_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_engaged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (floor_id, email_hash)
);

CREATE INDEX IF NOT EXISTS idx_email_subs_floor_id ON email_subscribers(floor_id);
CREATE INDEX IF NOT EXISTS idx_email_subs_status ON email_subscribers(status);
CREATE INDEX IF NOT EXISTS idx_email_subs_email_hash ON email_subscribers(email_hash);

CREATE TABLE IF NOT EXISTS email_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID NOT NULL REFERENCES email_subscribers(id) ON DELETE CASCADE,
  sequence_name TEXT NOT NULL,
  step_number INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_enroll_subscriber_id ON email_enrollments(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_email_enroll_sequence ON email_enrollments(sequence_name);
CREATE INDEX IF NOT EXISTS idx_email_enroll_status ON email_enrollments(status);
