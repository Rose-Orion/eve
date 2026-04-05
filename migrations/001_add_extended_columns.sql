-- Migration: Add missing columns for full data persistence
-- Run against Supabase SQL editor or psql

-- Floor extended columns
ALTER TABLE floors ADD COLUMN IF NOT EXISTS selected_brand JSONB;
ALTER TABLE floors ADD COLUMN IF NOT EXISTS theme_config JSONB;
ALTER TABLE floors ADD COLUMN IF NOT EXISTS growth_cycle INTEGER DEFAULT 0;

-- Task prompt column
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS prompt TEXT;
