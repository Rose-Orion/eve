-- Migration 001: Add prompt column to tasks table
-- This is CRITICAL for task persistence — without it, agent prompts are lost on restart
-- and agents receive empty instructions, producing placeholder/garbage output.
--
-- Run this in Supabase Dashboard → SQL Editor → New Query → Paste → Run

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS prompt text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS output_files text[];
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS input_files text[];
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS depends_on text[];

-- Also ensure floors has the extended columns
ALTER TABLE floors ADD COLUMN IF NOT EXISTS selected_brand jsonb;
ALTER TABLE floors ADD COLUMN IF NOT EXISTS theme_config jsonb;
ALTER TABLE floors ADD COLUMN IF NOT EXISTS growth_cycle integer DEFAULT 0;
ALTER TABLE floors ADD COLUMN IF NOT EXISTS archived_at timestamptz;
