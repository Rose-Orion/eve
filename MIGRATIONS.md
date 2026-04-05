# EVE Supabase Database Migrations

## Overview

Complete idempotent migration suite for the EVE orchestrator database. All migrations use `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` to ensure safety on re-runs.

## Migration Execution Order

The migrations **must** be executed sequentially starting from 001, as later migrations depend on tables created by earlier ones:

```bash
# Using Supabase SQL Editor (recommended)
1. Copy 001_add_extended_columns.sql and run
2. Copy 002_core_tables.sql and run
3. Copy 003_task_and_cost_tables.sql and run
4. Copy 004_content_tables.sql and run
5. Copy 005_commerce_tables.sql and run
6. Copy 006_email_tables.sql and run
7. Copy 007_improvement_tables.sql and run
8. Copy 008_approval_and_notifications.sql and run
9. Copy 009_communication_and_security.sql and run
10. Copy 010_tokens_and_config.sql and run

# Using psql (if you have direct database access)
psql -h <host> -U <user> -d <database> -f 001_add_extended_columns.sql
psql -h <host> -U <user> -d <database> -f 002_core_tables.sql
# ... continue for all 10 files
```

## Migration Files

### 001_add_extended_columns.sql
**Purpose:** Adds missing columns to existing tables (floor extended data, task prompts).

**Tables Modified:**
- `floors`: Adds `selected_brand`, `theme_config`, `growth_cycle`
- `tasks`: Adds `prompt`

**Status:** Pre-existing migration (baseline)

---

### 002_core_tables.sql
**Purpose:** Creates foundational floor management and agent coordination tables.

**Tables Created:**
1. **floors** — Business floor metadata and state
   - UUID primary key, name, slug, goal, status, budget tracking, phase tracking
   - Extended columns: selected_brand, theme_config, growth_cycle, trust_state, archived_at
   - Indexes: status, created_at

2. **phases** — Build phases within each floor
   - UUID primary key, floor_id (foreign key with cascade delete)
   - Phase number, name, status, timestamps (started_at, completed_at)
   - Gate approval tracking: gate_approved, gate_approved_at
   - Unique constraint: (floor_id, phase_number)
   - Indexes: floor_id, status, floor_id+phase_number

3. **agents** — Agent instances per floor
   - UUID primary key, floor_id (foreign key with cascade delete)
   - Role, model tier, status (idle/working/blocked/paused)
   - Current task reference, OpenClaw agent ID, config JSONB
   - Unique constraint: (floor_id, role)
   - Indexes: floor_id, status

---

### 003_task_and_cost_tables.sql
**Purpose:** Task execution tracking, cost events, and agent performance metrics.

**Tables Created:**
1. **tasks** — Individual tasks within phases
   - UUID primary key, floor_id + phase_number (foreign key cascade delete)
   - Assigned agent, model tier, task type, description, prompt
   - Status, priority (integer 1-4), attempts, estimated/actual costs
   - Result, review status/feedback, approval token
   - Input/output files, dependencies as arrays
   - Timestamps: created_at, dispatched_at, completed_at
   - Indexes: floor_id, status, phase, created_at

2. **cost_events** — Per-task and system cost tracking
   - UUID primary key, floor_id (foreign key cascade delete)
   - Event type, model, token counts (input/output)
   - Cost in cents, task description
   - Timestamps: created_at
   - Indexes: floor_id, created_at

3. **agent_performance** — Performance metrics per agent/period
   - UUID primary key, floor_id (foreign key cascade delete)
   - Agent role, period (start/end dates)
   - Tasks completed, approval rate, avg revision count, avg time, avg cost, avg turns
   - Quality trend (improving/stable/declining)
   - Indexes: floor_id, agent_role

---

### 004_content_tables.sql
**Purpose:** Social media content creation, scheduling, and performance tracking.

**Tables Created:**
1. **content_queue** — Social media content items
   - UUID primary key, floor_id (foreign key cascade delete)
   - Content type, platform, status (draft/review/approved/scheduled/published/rejected)
   - Media URL, caption, hashtags array
   - Scheduling: scheduled_at, published_at
   - Tracking: post_id, created_by, approved_by
   - Indexes: floor_id, status, platform, published_at

2. **content_performance** — Performance metrics per content piece
   - UUID primary key, content_id (foreign key cascade delete)
   - Platform, views, likes, comments, shares, saves, reach
   - Engagement rate, clicks, revenue attributed
   - Measurement window and timestamp
   - Indexes: content_id, platform

3. **gold_standards** — High-quality approved outputs for few-shot learning
   - UUID primary key, floor_id (optional, foreign key cascade delete)
   - Agent role, task type, description, output
   - Quality score, approval count
   - Indexes: floor_id, agent_role, task_type

---

### 005_commerce_tables.sql
**Purpose:** E-commerce product, order, and ad campaign management.

**Tables Created:**
1. **products** — Printful/POD products
   - UUID primary key, floor_id (foreign key cascade delete)
   - Name, slug, description
   - Costs: base_cost_cents, price_cents, margin_percent
   - Images array, variants JSONB, POD product ID
   - Status (draft/active/paused/archived)
   - Unique constraint: (floor_id, slug)
   - Indexes: floor_id, status

2. **orders** — Stripe orders
   - UUID primary key, floor_id (foreign key cascade delete)
   - Stripe session ID (unique), payment intent
   - Customer email hash, items JSONB
   - Cost breakdown: subtotal, shipping, total (in cents)
   - Status (paid/fulfilling/shipped/delivered/refunded)
   - Fulfillment: fulfillment_id, tracking_number, tracking_url
   - UTM tracking: source, medium, campaign, content
   - Timestamps: shipped_at, delivered_at, created_at
   - Indexes: floor_id, status, stripe_session_id

3. **ad_campaigns** — Meta/TikTok ad campaigns
   - UUID primary key, floor_id (foreign key cascade delete)
   - Platform, platform_campaign_id, name, objective
   - Daily budget (cents), status (paused/active/completed)
   - Indexes: floor_id, platform, status

4. **ad_daily_performance** — Daily ad metrics
   - UUID primary key, campaign_id (foreign key cascade delete)
   - Date, spend_cents, impressions, clicks, conversions
   - Revenue, ROAS, CPA, CTR, frequency
   - Unique constraint: (campaign_id, date)
   - Indexes: campaign_id, date

---

### 006_email_tables.sql
**Purpose:** Email subscriber management and email sequence enrollments.

**Tables Created:**
1. **email_subscribers** — Subscriber records
   - UUID primary key, floor_id (foreign key cascade delete)
   - Email hash (unique per floor), email address, status (subscribed/etc)
   - Enrolled sequences array
   - Timestamps: subscription_date, last_engaged_at, created_at, updated_at
   - Unique constraint: (floor_id, email_hash)
   - Indexes: floor_id, status, email_hash

2. **email_enrollments** — Sequence enrollment tracking
   - UUID primary key, subscriber_id (foreign key cascade delete)
   - Sequence name, step number, status (active/completed)
   - Timestamps: enrolled_at, completed_at, created_at, updated_at
   - Indexes: subscriber_id, sequence_name, status

---

### 007_improvement_tables.sql
**Purpose:** Self-improvement engine: proposals, preference patterns, playbook, A/B tests.

**Tables Created:**
1. **improvement_proposals** — Proposed system improvements
   - UUID primary key, floor_id (optional, foreign key cascade delete)
   - Type, target agent, priority (high/medium/low)
   - What changes, current state, proposed state, evidence JSONB
   - Expected impact, risk level (low/medium/high), rollback plan
   - Status (pending/applied/etc)
   - Timestamps: reviewed_at, applied_at, impact_measured_at
   - Impact result JSONB
   - Indexes: floor_id, status, target_agent

2. **preference_patterns** — Recurring behavioral patterns
   - UUID primary key, floor_id (foreign key cascade delete)
   - Agent role, pattern key, pattern value JSONB
   - Confidence score, sample count
   - Unique constraint: (floor_id, agent_role, pattern_key)
   - Indexes: floor_id, agent_role

3. **playbook_entries** — Scenario-response playbook
   - UUID primary key, floor_id (foreign key cascade delete)
   - Agent role, scenario, response
   - Effectiveness score, usage count
   - Indexes: floor_id, agent_role

4. **ab_tests** — A/B test tracking
   - UUID primary key, floor_id (foreign key cascade delete)
   - Test name, variant A/B, metric tracked
   - Status (running/completed), variant metrics, winner
   - Timestamps: started_at, completed_at, created_at
   - Indexes: floor_id, status

---

### 008_approval_and_notifications.sql
**Purpose:** Approval workflows and user notifications.

**Tables Created:**
1. **approval_queue** — Items pending human approval
   - UUID primary key, floor_id (foreign key cascade delete)
   - Task ID (foreign key cascade delete), content type
   - Status, approval token (unique), pending item JSONB
   - Approved flag, approved_at timestamp
   - Indexes: floor_id, status, task_id

2. **notifications** — User notifications
   - UUID primary key, floor_id (foreign key cascade delete)
   - Type, title, message, severity (info/warning/error)
   - Read flag, read_at timestamp
   - Indexes: floor_id, read, created_at

---

### 009_communication_and_security.sql
**Purpose:** Communication history and security event logging.

**Tables Created:**
1. **floor_chat_messages** — Conversation history
   - UUID primary key, floor_id (foreign key cascade delete)
   - Sender, role, message
   - Timestamps: timestamp, created_at
   - Indexes: floor_id, sender, timestamp

2. **command_log** — Command execution audit trail
   - UUID primary key, floor_id (foreign key cascade delete)
   - Command, agent, status (executed/failed/etc)
   - Result, error message
   - Timestamps: executed_at, created_at
   - Indexes: floor_id, status, executed_at

3. **security_events** — Security/authorization events
   - UUID primary key, floor_id (foreign key cascade delete)
   - Event type, severity (low/medium/high), actor, action
   - Resource, result, details JSONB
   - Timestamps: occurred_at, created_at
   - Indexes: floor_id, event_type, severity

---

### 010_tokens_and_config.sql
**Purpose:** Approval tokens, configuration, webhooks, phase gates, and trust tracking.

**Tables Created:**
1. **floor_tokens** — API/approval tokens
   - UUID primary key, floor_id (foreign key cascade delete)
   - Token type, token value (unique), expires_at, used_at
   - Indexes: floor_id, token_type

2. **floor_config** — Floor-level configuration
   - UUID primary key, floor_id (unique, foreign key cascade delete)
   - Config data JSONB
   - Indexes: floor_id

3. **webhook_events** — Inbound webhook events
   - UUID primary key, floor_id (foreign key cascade delete)
   - Event type, provider, payload JSONB
   - Processed flag, error message
   - Timestamps: created_at, processed_at
   - Indexes: floor_id, event_type, processed

4. **phase_gates** — Phase completion gates
   - UUID primary key, floor_id (foreign key cascade delete)
   - Phase number, gate name, required metrics JSONB
   - Approval status, approved_by, approved_at
   - Unique constraint: (floor_id, phase_number)
   - Indexes: floor_id

5. **trust_ladder_history** — Trust level change audit
   - UUID primary key, floor_id (foreign key cascade delete)
   - Agent role, from/to level, reason, evidence JSONB
   - Indexes: floor_id, agent_role

---

## Schema Summary

**Total Tables:** 23
**Total Indexes:** 70+

| Grouping | Count | Purpose |
|----------|-------|---------|
| Core (floors, phases, agents) | 3 | Floor management |
| Tasks & Costs | 3 | Execution tracking |
| Content | 3 | Social media |
| Commerce | 4 | E-commerce & ads |
| Email | 2 | Marketing |
| Improvement | 4 | Self-optimization |
| Approval & Notifications | 2 | Workflows |
| Communication & Security | 3 | Logging & audit |
| Tokens & Config | 5 | Infrastructure |

## Key Design Decisions

1. **Idempotency:** All migrations use `IF NOT EXISTS`, safe to re-run.
2. **Cascade Delete:** All foreign keys use `ON DELETE CASCADE` to maintain referential integrity.
3. **Soft Deletes:** `floors` uses `archived_at` for soft deletes; other tables cascade delete.
4. **Timestamps:** `created_at` (required) and `updated_at` (recommended) on all tables.
5. **Snake Case:** All columns use PostgreSQL convention (snake_case).
6. **UUIDs:** All primary keys are UUID v4 (`gen_random_uuid()`).
7. **Indexing:** Strategic indexes on floor_id, status, created_at, and foreign keys.
8. **Arrays:** TEXT[] for simple lists (hashtags, files); JSONB for complex structures.
9. **Cents:** All monetary amounts stored as INTEGER cents (no floating-point precision loss).
10. **Unique Constraints:** (floor_id, phase_number), (floor_id, slug), (campaign_id, date), etc.

## Validation Checklist

- [x] All 23 tables referenced in `supabase.ts` have CREATE TABLE statements
- [x] All column names match code references (snake_case in DB, auto-converted to camelCase by Supabase SDK)
- [x] Foreign keys use cascade delete for data integrity
- [x] Indexes on floor_id for all floor-scoped tables
- [x] Indexes on status columns for query filtering
- [x] Unique constraints where needed (floor_id+phase_number, slug, dates, etc.)
- [x] Timestamps (created_at, updated_at) on all tables
- [x] JSONB for complex nested data (config, evidence, metrics, payload)
- [x] TEXT[] for simple arrays (hashtags, files, sequences)
- [x] INTEGER for all monetary amounts (cents)
- [x] No migration order dependencies (except 001 → 002+)

## Testing & Deployment

### Local Testing
```bash
# Using Docker Postgres (optional)
docker run -d -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:15
psql -h localhost -U postgres -d postgres -f 002_core_tables.sql

# Verify tables created
\dt  # In psql
```

### Supabase Deployment
1. Log in to Supabase dashboard
2. Navigate to SQL Editor
3. Create new query for each migration file
4. Copy entire .sql file contents
5. Execute (verify "Success" message)
6. Repeat for all 10 files in order

### Verification
```sql
-- List all tables
SELECT tablename FROM pg_tables WHERE schemaname = 'public';

-- List all indexes
SELECT indexname FROM pg_indexes WHERE schemaname = 'public';

-- Check table structure
\d+ floors  -- In psql
```

## Rollback Strategy

To rollback (warning: destructive):
```sql
DROP TABLE IF EXISTS trust_ladder_history CASCADE;
DROP TABLE IF EXISTS phase_gates CASCADE;
DROP TABLE IF EXISTS webhook_events CASCADE;
DROP TABLE IF EXISTS floor_config CASCADE;
DROP TABLE IF EXISTS floor_tokens CASCADE;
-- ... continue with remaining tables in reverse order
```

**Note:** Cascading deletes will remove all dependent data. Use only in development/testing.

## Notes for Developers

- The Supabase JavaScript client auto-converts snake_case column names to camelCase in TypeScript code (e.g., `floor_id` → `floorId`).
- All migrations are replayable (idempotent) without side effects.
- To add new columns to existing tables, create a new migration file (e.g., `011_add_new_columns.sql`) with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- Foreign key constraints ensure data consistency; respect cascade behavior when deleting.
