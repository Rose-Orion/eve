# Supabase Migration Execution Checklist

## Pre-Execution Checklist

- [ ] Backup existing Supabase database (if upgrading existing instance)
- [ ] Verify Supabase project is accessible (test connection)
- [ ] Confirm you have SQL editor access in Supabase dashboard
- [ ] Review migration files for accuracy: `migrations/00{1-10}_*.sql`

## Migration Execution Sequence

Execute migrations in **exact order** from 001 to 010. Each must complete successfully before starting the next.

### ✓ Step 1: 001_add_extended_columns.sql
**What:** Adds missing columns to existing tables
- Adds `selected_brand`, `theme_config`, `growth_cycle` to `floors`
- Adds `prompt` to `tasks`
- **Duration:** < 1 second
- **Status:** [ ] Complete

### ✓ Step 2: 002_core_tables.sql
**What:** Creates core tables (floors, phases, agents)
**Tables:** 3 (floors, phases, agents)
**Indexes:** 6
- **Duration:** ~2 seconds
- **Status:** [ ] Complete

### ✓ Step 3: 003_task_and_cost_tables.sql
**What:** Creates task execution and cost tracking tables
**Tables:** 3 (tasks, cost_events, agent_performance)
**Indexes:** 7
- **Duration:** ~2 seconds
- **Status:** [ ] Complete

### ✓ Step 4: 004_content_tables.sql
**What:** Creates social media content tables
**Tables:** 3 (content_queue, content_performance, gold_standards)
**Indexes:** 8
- **Duration:** ~2 seconds
- **Status:** [ ] Complete

### ✓ Step 5: 005_commerce_tables.sql
**What:** Creates e-commerce tables
**Tables:** 4 (products, orders, ad_campaigns, ad_daily_performance)
**Indexes:** 9
- **Duration:** ~2 seconds
- **Status:** [ ] Complete

### ✓ Step 6: 006_email_tables.sql
**What:** Creates email marketing tables
**Tables:** 2 (email_subscribers, email_enrollments)
**Indexes:** 6
- **Duration:** ~2 seconds
- **Status:** [ ] Complete

### ✓ Step 7: 007_improvement_tables.sql
**What:** Creates improvement engine tables
**Tables:** 4 (improvement_proposals, preference_patterns, playbook_entries, ab_tests)
**Indexes:** 9
- **Duration:** ~2 seconds
- **Status:** [ ] Complete

### ✓ Step 8: 008_approval_and_notifications.sql
**What:** Creates approval and notification tables
**Tables:** 2 (approval_queue, notifications)
**Indexes:** 5
- **Duration:** ~2 seconds
- **Status:** [ ] Complete

### ✓ Step 9: 009_communication_and_security.sql
**What:** Creates communication and security logging tables
**Tables:** 3 (floor_chat_messages, command_log, security_events)
**Indexes:** 8
- **Duration:** ~2 seconds
- **Status:** [ ] Complete

### ✓ Step 10: 010_tokens_and_config.sql
**What:** Creates configuration and webhook tables
**Tables:** 5 (floor_tokens, floor_config, webhook_events, phase_gates, trust_ladder_history)
**Indexes:** 7
- **Duration:** ~2 seconds
- **Status:** [ ] Complete

## Post-Execution Verification

After all migrations complete, verify the schema:

### Verify Table Count
```sql
SELECT count(*) as table_count FROM information_schema.tables 
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
```
**Expected:** 23 tables (or 24 if floor_chat_messages exists from earlier work)

### Verify Index Count
```sql
SELECT count(*) as index_count FROM pg_indexes 
WHERE schemaname = 'public' AND indexname NOT LIKE 'pg_%';
```
**Expected:** 70+ indexes

### List All Tables
```sql
SELECT tablename FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;
```
**Expected Output:**
```
ab_tests
ad_campaigns
ad_daily_performance
agent_performance
agents
approval_queue
command_log
content_performance
content_queue
cost_events
email_enrollments
email_subscribers
floor_chat_messages
floor_config
floor_tokens
floors
gold_standards
improvement_proposals
notifications
orders
phase_gates
phases
playbook_entries
preference_patterns
products
security_events
tasks
trust_ladder_history
webhook_events
```

### Verify Foreign Key Constraints
```sql
SELECT constraint_name, table_name, constraint_type 
FROM information_schema.table_constraints 
WHERE table_schema = 'public' AND constraint_type = 'FOREIGN KEY' 
ORDER BY table_name;
```
**Expected:** 20+ foreign keys with CASCADE delete rules

### Sample Table Structure Check
```sql
-- Check floors table has all expected columns
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_name = 'floors' AND table_schema = 'public' 
ORDER BY ordinal_position;
```

## Rollback (If Needed)

If errors occur and you need to rollback, execute this **in reverse migration order** (010 down to 002):

```sql
-- WARNING: This permanently deletes all data!
DROP TABLE IF EXISTS trust_ladder_history CASCADE;
DROP TABLE IF EXISTS phase_gates CASCADE;
DROP TABLE IF EXISTS webhook_events CASCADE;
DROP TABLE IF EXISTS floor_config CASCADE;
DROP TABLE IF EXISTS floor_tokens CASCADE;
DROP TABLE IF EXISTS security_events CASCADE;
DROP TABLE IF EXISTS command_log CASCADE;
DROP TABLE IF EXISTS floor_chat_messages CASCADE;
DROP TABLE IF EXISTS ab_tests CASCADE;
DROP TABLE IF EXISTS playbook_entries CASCADE;
DROP TABLE IF EXISTS preference_patterns CASCADE;
DROP TABLE IF EXISTS improvement_proposals CASCADE;
DROP TABLE IF EXISTS email_enrollments CASCADE;
DROP TABLE IF EXISTS email_subscribers CASCADE;
DROP TABLE IF EXISTS ad_daily_performance CASCADE;
DROP TABLE IF EXISTS ad_campaigns CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS content_performance CASCADE;
DROP TABLE IF EXISTS gold_standards CASCADE;
DROP TABLE IF EXISTS content_queue CASCADE;
DROP TABLE IF EXISTS agent_performance CASCADE;
DROP TABLE IF EXISTS cost_events CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS agents CASCADE;
DROP TABLE IF EXISTS phases CASCADE;
DROP TABLE IF EXISTS floors CASCADE;
```

## Troubleshooting

### Error: "relation already exists"
- **Cause:** Migration already ran (idempotent check failed)
- **Solution:** Check `pg_tables` to see if table exists; migrations are safe to re-run

### Error: "column already exists"
- **Cause:** Column was already added in a previous migration
- **Solution:** This shouldn't happen with `IF NOT EXISTS` clauses; safe to re-run

### Error: "foreign key constraint violation"
- **Cause:** Attempting to delete data with dependent records
- **Solution:** Ensure migrations execute in order; use cascade delete as-is

### Error: "permission denied"
- **Cause:** Supabase user lacks DDL privileges
- **Solution:** Use Supabase dashboard SQL editor (has full privileges) or ensure your role has CREATE/ALTER permissions

## Success Criteria

- [ ] All 10 migrations executed without errors
- [ ] 23 tables present in database
- [ ] 70+ indexes created
- [ ] All foreign keys with CASCADE delete configured
- [ ] Sample queries work (e.g., `SELECT * FROM floors LIMIT 1`)
- [ ] Orchestrator logs show successful Supabase connection
- [ ] No "missing column" warnings in orchestrator logs

## Documentation

See `MIGRATIONS.md` for:
- Detailed schema documentation
- Table relationships and constraints
- Design decisions and rationale
- Migration file contents
