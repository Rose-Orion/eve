-- Migration 011: Row-Level Security (RLS) Policies
-- Enables cross-floor data isolation for multi-tenant security.
-- The Orchestrator uses service_role which bypasses RLS automatically.
-- These policies protect against direct client access (e.g., Dashboard with anon key).

-- Enable RLS on all floor-scoped tables
ALTER TABLE floors ENABLE ROW LEVEL SECURITY;
ALTER TABLE phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE gold_standards ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_daily_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE improvement_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE preference_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE playbook_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ab_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE floor_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE command_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE floor_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE floor_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE phase_gates ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_ladder_history ENABLE ROW LEVEL SECURITY;

-- Floors: Authenticated users can see their own floors if they are the owner
-- In this MVP implementation, we use a simple pattern where any authenticated user can see the floor
-- Extend this with a floor_memberships table for multi-user access control later
DROP POLICY IF EXISTS "floors_select_policy" ON floors;
CREATE POLICY "floors_select_policy" ON floors
  FOR SELECT
  TO authenticated
  USING (auth.jwt() ->> 'user_id' IS NOT NULL);

DROP POLICY IF EXISTS "floors_insert_policy" ON floors;
CREATE POLICY "floors_insert_policy" ON floors
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.jwt() ->> 'user_id' IS NOT NULL);

DROP POLICY IF EXISTS "floors_update_policy" ON floors;
CREATE POLICY "floors_update_policy" ON floors
  FOR UPDATE
  TO authenticated
  USING (auth.jwt() ->> 'user_id' IS NOT NULL);

DROP POLICY IF EXISTS "floors_delete_policy" ON floors;
CREATE POLICY "floors_delete_policy" ON floors
  FOR DELETE
  TO authenticated
  USING (auth.jwt() ->> 'user_id' IS NOT NULL);

-- Phases: Access restricted to authenticated users accessing their floor's phases
DROP POLICY IF EXISTS "phases_select_policy" ON phases;
CREATE POLICY "phases_select_policy" ON phases
  FOR SELECT
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "phases_insert_policy" ON phases;
CREATE POLICY "phases_insert_policy" ON phases
  FOR INSERT
  TO authenticated
  WITH CHECK (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "phases_update_policy" ON phases;
CREATE POLICY "phases_update_policy" ON phases
  FOR UPDATE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "phases_delete_policy" ON phases;
CREATE POLICY "phases_delete_policy" ON phases
  FOR DELETE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

-- Agents: Access restricted to agents within user's floors
DROP POLICY IF EXISTS "agents_select_policy" ON agents;
CREATE POLICY "agents_select_policy" ON agents
  FOR SELECT
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "agents_insert_policy" ON agents;
CREATE POLICY "agents_insert_policy" ON agents
  FOR INSERT
  TO authenticated
  WITH CHECK (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "agents_update_policy" ON agents;
CREATE POLICY "agents_update_policy" ON agents
  FOR UPDATE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "agents_delete_policy" ON agents;
CREATE POLICY "agents_delete_policy" ON agents
  FOR DELETE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

-- Tasks: Access restricted to authenticated users accessing their floor's tasks
DROP POLICY IF EXISTS "tasks_select_policy" ON tasks;
CREATE POLICY "tasks_select_policy" ON tasks
  FOR SELECT
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "tasks_insert_policy" ON tasks;
CREATE POLICY "tasks_insert_policy" ON tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "tasks_update_policy" ON tasks;
CREATE POLICY "tasks_update_policy" ON tasks
  FOR UPDATE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "tasks_delete_policy" ON tasks;
CREATE POLICY "tasks_delete_policy" ON tasks
  FOR DELETE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

-- Cost Events: Access restricted to authenticated users accessing their floor's cost events
DROP POLICY IF EXISTS "cost_events_select_policy" ON cost_events;
CREATE POLICY "cost_events_select_policy" ON cost_events
  FOR SELECT
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "cost_events_insert_policy" ON cost_events;
CREATE POLICY "cost_events_insert_policy" ON cost_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "cost_events_update_policy" ON cost_events;
CREATE POLICY "cost_events_update_policy" ON cost_events
  FOR UPDATE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "cost_events_delete_policy" ON cost_events;
CREATE POLICY "cost_events_delete_policy" ON cost_events
  FOR DELETE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

-- Agent Performance: Access restricted to authenticated users accessing their floor's performance data
DROP POLICY IF EXISTS "agent_performance_select_policy" ON agent_performance;
CREATE POLICY "agent_performance_select_policy" ON agent_performance
  FOR SELECT
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "agent_performance_insert_policy" ON agent_performance;
CREATE POLICY "agent_performance_insert_policy" ON agent_performance
  FOR INSERT
  TO authenticated
  WITH CHECK (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "agent_performance_update_policy" ON agent_performance;
CREATE POLICY "agent_performance_update_policy" ON agent_performance
  FOR UPDATE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "agent_performance_delete_policy" ON agent_performance;
CREATE POLICY "agent_performance_delete_policy" ON agent_performance
  FOR DELETE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

-- Content Queue: Access restricted to authenticated users accessing their floor's content
DROP POLICY IF EXISTS "content_queue_select_policy" ON content_queue;
CREATE POLICY "content_queue_select_policy" ON content_queue
  FOR SELECT
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "content_queue_insert_policy" ON content_queue;
CREATE POLICY "content_queue_insert_policy" ON content_queue
  FOR INSERT
  TO authenticated
  WITH CHECK (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "content_queue_update_policy" ON content_queue;
CREATE POLICY "content_queue_update_policy" ON content_queue
  FOR UPDATE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "content_queue_delete_policy" ON content_queue;
CREATE POLICY "content_queue_delete_policy" ON content_queue
  FOR DELETE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

-- Content Performance: Access restricted to authenticated users accessing their floor's performance data
DROP POLICY IF EXISTS "content_performance_select_policy" ON content_performance;
CREATE POLICY "content_performance_select_policy" ON content_performance
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM content_queue cq
      WHERE cq.id = content_performance.content_id
      AND cq.floor_id IN (
        SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
      )
    )
  );

DROP POLICY IF EXISTS "content_performance_insert_policy" ON content_performance;
CREATE POLICY "content_performance_insert_policy" ON content_performance
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM content_queue cq
      WHERE cq.id = content_performance.content_id
      AND cq.floor_id IN (
        SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
      )
    )
  );

DROP POLICY IF EXISTS "content_performance_update_policy" ON content_performance;
CREATE POLICY "content_performance_update_policy" ON content_performance
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM content_queue cq
      WHERE cq.id = content_performance.content_id
      AND cq.floor_id IN (
        SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
      )
    )
  );

DROP POLICY IF EXISTS "content_performance_delete_policy" ON content_performance;
CREATE POLICY "content_performance_delete_policy" ON content_performance
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM content_queue cq
      WHERE cq.id = content_performance.content_id
      AND cq.floor_id IN (
        SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
      )
    )
  );

-- Gold Standards: Access restricted to authenticated users accessing their floor's gold standards
DROP POLICY IF EXISTS "gold_standards_select_policy" ON gold_standards;
CREATE POLICY "gold_standards_select_policy" ON gold_standards
  FOR SELECT
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "gold_standards_insert_policy" ON gold_standards;
CREATE POLICY "gold_standards_insert_policy" ON gold_standards
  FOR INSERT
  TO authenticated
  WITH CHECK (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "gold_standards_update_policy" ON gold_standards;
CREATE POLICY "gold_standards_update_policy" ON gold_standards
  FOR UPDATE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "gold_standards_delete_policy" ON gold_standards;
CREATE POLICY "gold_standards_delete_policy" ON gold_standards
  FOR DELETE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

-- Products: Access restricted to authenticated users accessing their floor's products
DROP POLICY IF EXISTS "products_select_policy" ON products;
CREATE POLICY "products_select_policy" ON products
  FOR SELECT
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "products_insert_policy" ON products;
CREATE POLICY "products_insert_policy" ON products
  FOR INSERT
  TO authenticated
  WITH CHECK (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "products_update_policy" ON products;
CREATE POLICY "products_update_policy" ON products
  FOR UPDATE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "products_delete_policy" ON products;
CREATE POLICY "products_delete_policy" ON products
  FOR DELETE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

-- Orders: Access restricted to authenticated users accessing their floor's orders
DROP POLICY IF EXISTS "orders_select_policy" ON orders;
CREATE POLICY "orders_select_policy" ON orders
  FOR SELECT
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "orders_insert_policy" ON orders;
CREATE POLICY "orders_insert_policy" ON orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "orders_update_policy" ON orders;
CREATE POLICY "orders_update_policy" ON orders
  FOR UPDATE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "orders_delete_policy" ON orders;
CREATE POLICY "orders_delete_policy" ON orders
  FOR DELETE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

-- Ad Campaigns: Access restricted to authenticated users accessing their floor's ad campaigns
DROP POLICY IF EXISTS "ad_campaigns_select_policy" ON ad_campaigns;
CREATE POLICY "ad_campaigns_select_policy" ON ad_campaigns
  FOR SELECT
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "ad_campaigns_insert_policy" ON ad_campaigns;
CREATE POLICY "ad_campaigns_insert_policy" ON ad_campaigns
  FOR INSERT
  TO authenticated
  WITH CHECK (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "ad_campaigns_update_policy" ON ad_campaigns;
CREATE POLICY "ad_campaigns_update_policy" ON ad_campaigns
  FOR UPDATE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "ad_campaigns_delete_policy" ON ad_campaigns;
CREATE POLICY "ad_campaigns_delete_policy" ON ad_campaigns
  FOR DELETE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

-- Ad Daily Performance: Access restricted to authenticated users accessing their floor's ad performance data
DROP POLICY IF EXISTS "ad_daily_performance_select_policy" ON ad_daily_performance;
CREATE POLICY "ad_daily_performance_select_policy" ON ad_daily_performance
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ad_campaigns ac
      WHERE ac.id = ad_daily_performance.campaign_id
      AND ac.floor_id IN (
        SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
      )
    )
  );

DROP POLICY IF EXISTS "ad_daily_performance_insert_policy" ON ad_daily_performance;
CREATE POLICY "ad_daily_performance_insert_policy" ON ad_daily_performance
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ad_campaigns ac
      WHERE ac.id = ad_daily_performance.campaign_id
      AND ac.floor_id IN (
        SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
      )
    )
  );

DROP POLICY IF EXISTS "ad_daily_performance_update_policy" ON ad_daily_performance;
CREATE POLICY "ad_daily_performance_update_policy" ON ad_daily_performance
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ad_campaigns ac
      WHERE ac.id = ad_daily_performance.campaign_id
      AND ac.floor_id IN (
        SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
      )
    )
  );

DROP POLICY IF EXISTS "ad_daily_performance_delete_policy" ON ad_daily_performance;
CREATE POLICY "ad_daily_performance_delete_policy" ON ad_daily_performance
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ad_campaigns ac
      WHERE ac.id = ad_daily_performance.campaign_id
      AND ac.floor_id IN (
        SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
      )
    )
  );

-- Email Subscribers: Access restricted to authenticated users accessing their floor's email subscribers
DROP POLICY IF EXISTS "email_subscribers_select_policy" ON email_subscribers;
CREATE POLICY "email_subscribers_select_policy" ON email_subscribers
  FOR SELECT
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "email_subscribers_insert_policy" ON email_subscribers;
CREATE POLICY "email_subscribers_insert_policy" ON email_subscribers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "email_subscribers_update_policy" ON email_subscribers;
CREATE POLICY "email_subscribers_update_policy" ON email_subscribers
  FOR UPDATE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "email_subscribers_delete_policy" ON email_subscribers;
CREATE POLICY "email_subscribers_delete_policy" ON email_subscribers
  FOR DELETE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

-- Email Enrollments: Access restricted via email_subscribers relationship
DROP POLICY IF EXISTS "email_enrollments_select_policy" ON email_enrollments;
CREATE POLICY "email_enrollments_select_policy" ON email_enrollments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM email_subscribers es
      WHERE es.id = email_enrollments.subscriber_id
      AND es.floor_id IN (
        SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
      )
    )
  );

DROP POLICY IF EXISTS "email_enrollments_insert_policy" ON email_enrollments;
CREATE POLICY "email_enrollments_insert_policy" ON email_enrollments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM email_subscribers es
      WHERE es.id = email_enrollments.subscriber_id
      AND es.floor_id IN (
        SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
      )
    )
  );

DROP POLICY IF EXISTS "email_enrollments_update_policy" ON email_enrollments;
CREATE POLICY "email_enrollments_update_policy" ON email_enrollments
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM email_subscribers es
      WHERE es.id = email_enrollments.subscriber_id
      AND es.floor_id IN (
        SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
      )
    )
  );

DROP POLICY IF EXISTS "email_enrollments_delete_policy" ON email_enrollments;
CREATE POLICY "email_enrollments_delete_policy" ON email_enrollments
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM email_subscribers es
      WHERE es.id = email_enrollments.subscriber_id
      AND es.floor_id IN (
        SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
      )
    )
  );

-- Improvement Proposals: Access restricted to authenticated users accessing their floor's improvement proposals
DROP POLICY IF EXISTS "improvement_proposals_select_policy" ON improvement_proposals;
CREATE POLICY "improvement_proposals_select_policy" ON improvement_proposals
  FOR SELECT
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "improvement_proposals_insert_policy" ON improvement_proposals;
CREATE POLICY "improvement_proposals_insert_policy" ON improvement_proposals
  FOR INSERT
  TO authenticated
  WITH CHECK (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "improvement_proposals_update_policy" ON improvement_proposals;
CREATE POLICY "improvement_proposals_update_policy" ON improvement_proposals
  FOR UPDATE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "improvement_proposals_delete_policy" ON improvement_proposals;
CREATE POLICY "improvement_proposals_delete_policy" ON improvement_proposals
  FOR DELETE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

-- Preference Patterns: Access restricted to authenticated users accessing their floor's preference patterns
DROP POLICY IF EXISTS "preference_patterns_select_policy" ON preference_patterns;
CREATE POLICY "preference_patterns_select_policy" ON preference_patterns
  FOR SELECT
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "preference_patterns_insert_policy" ON preference_patterns;
CREATE POLICY "preference_patterns_insert_policy" ON preference_patterns
  FOR INSERT
  TO authenticated
  WITH CHECK (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "preference_patterns_update_policy" ON preference_patterns;
CREATE POLICY "preference_patterns_update_policy" ON preference_patterns
  FOR UPDATE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "preference_patterns_delete_policy" ON preference_patterns;
CREATE POLICY "preference_patterns_delete_policy" ON preference_patterns
  FOR DELETE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

-- Playbook Entries: Access restricted to authenticated users accessing their floor's playbook entries
DROP POLICY IF EXISTS "playbook_entries_select_policy" ON playbook_entries;
CREATE POLICY "playbook_entries_select_policy" ON playbook_entries
  FOR SELECT
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "playbook_entries_insert_policy" ON playbook_entries;
CREATE POLICY "playbook_entries_insert_policy" ON playbook_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "playbook_entries_update_policy" ON playbook_entries;
CREATE POLICY "playbook_entries_update_policy" ON playbook_entries
  FOR UPDATE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "playbook_entries_delete_policy" ON playbook_entries;
CREATE POLICY "playbook_entries_delete_policy" ON playbook_entries
  FOR DELETE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

-- A/B Tests: Access restricted to authenticated users accessing their floor's A/B tests
DROP POLICY IF EXISTS "ab_tests_select_policy" ON ab_tests;
CREATE POLICY "ab_tests_select_policy" ON ab_tests
  FOR SELECT
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "ab_tests_insert_policy" ON ab_tests;
CREATE POLICY "ab_tests_insert_policy" ON ab_tests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "ab_tests_update_policy" ON ab_tests;
CREATE POLICY "ab_tests_update_policy" ON ab_tests
  FOR UPDATE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "ab_tests_delete_policy" ON ab_tests;
CREATE POLICY "ab_tests_delete_policy" ON ab_tests
  FOR DELETE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

-- Approval Queue: Access restricted to authenticated users accessing their floor's approval queue
DROP POLICY IF EXISTS "approval_queue_select_policy" ON approval_queue;
CREATE POLICY "approval_queue_select_policy" ON approval_queue
  FOR SELECT
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "approval_queue_insert_policy" ON approval_queue;
CREATE POLICY "approval_queue_insert_policy" ON approval_queue
  FOR INSERT
  TO authenticated
  WITH CHECK (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "approval_queue_update_policy" ON approval_queue;
CREATE POLICY "approval_queue_update_policy" ON approval_queue
  FOR UPDATE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "approval_queue_delete_policy" ON approval_queue;
CREATE POLICY "approval_queue_delete_policy" ON approval_queue
  FOR DELETE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

-- Notifications: Access restricted to authenticated users accessing their floor's notifications
DROP POLICY IF EXISTS "notifications_select_policy" ON notifications;
CREATE POLICY "notifications_select_policy" ON notifications
  FOR SELECT
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "notifications_insert_policy" ON notifications;
CREATE POLICY "notifications_insert_policy" ON notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "notifications_update_policy" ON notifications;
CREATE POLICY "notifications_update_policy" ON notifications
  FOR UPDATE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "notifications_delete_policy" ON notifications;
CREATE POLICY "notifications_delete_policy" ON notifications
  FOR DELETE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

-- Floor Chat Messages: Access restricted to authenticated users accessing their floor's messages
DROP POLICY IF EXISTS "floor_chat_messages_select_policy" ON floor_chat_messages;
CREATE POLICY "floor_chat_messages_select_policy" ON floor_chat_messages
  FOR SELECT
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "floor_chat_messages_insert_policy" ON floor_chat_messages;
CREATE POLICY "floor_chat_messages_insert_policy" ON floor_chat_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "floor_chat_messages_update_policy" ON floor_chat_messages;
CREATE POLICY "floor_chat_messages_update_policy" ON floor_chat_messages
  FOR UPDATE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "floor_chat_messages_delete_policy" ON floor_chat_messages;
CREATE POLICY "floor_chat_messages_delete_policy" ON floor_chat_messages
  FOR DELETE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

-- Command Log: Access restricted to authenticated users accessing their floor's command logs
DROP POLICY IF EXISTS "command_log_select_policy" ON command_log;
CREATE POLICY "command_log_select_policy" ON command_log
  FOR SELECT
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "command_log_insert_policy" ON command_log;
CREATE POLICY "command_log_insert_policy" ON command_log
  FOR INSERT
  TO authenticated
  WITH CHECK (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "command_log_update_policy" ON command_log;
CREATE POLICY "command_log_update_policy" ON command_log
  FOR UPDATE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "command_log_delete_policy" ON command_log;
CREATE POLICY "command_log_delete_policy" ON command_log
  FOR DELETE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

-- Security Events: Access restricted to authenticated users accessing their floor's security events
DROP POLICY IF EXISTS "security_events_select_policy" ON security_events;
CREATE POLICY "security_events_select_policy" ON security_events
  FOR SELECT
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "security_events_insert_policy" ON security_events;
CREATE POLICY "security_events_insert_policy" ON security_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "security_events_update_policy" ON security_events;
CREATE POLICY "security_events_update_policy" ON security_events
  FOR UPDATE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "security_events_delete_policy" ON security_events;
CREATE POLICY "security_events_delete_policy" ON security_events
  FOR DELETE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

-- Floor Tokens: Access restricted to authenticated users accessing their floor's tokens
DROP POLICY IF EXISTS "floor_tokens_select_policy" ON floor_tokens;
CREATE POLICY "floor_tokens_select_policy" ON floor_tokens
  FOR SELECT
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "floor_tokens_insert_policy" ON floor_tokens;
CREATE POLICY "floor_tokens_insert_policy" ON floor_tokens
  FOR INSERT
  TO authenticated
  WITH CHECK (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "floor_tokens_update_policy" ON floor_tokens;
CREATE POLICY "floor_tokens_update_policy" ON floor_tokens
  FOR UPDATE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "floor_tokens_delete_policy" ON floor_tokens;
CREATE POLICY "floor_tokens_delete_policy" ON floor_tokens
  FOR DELETE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

-- Floor Config: Access restricted to authenticated users accessing their floor's configuration
DROP POLICY IF EXISTS "floor_config_select_policy" ON floor_config;
CREATE POLICY "floor_config_select_policy" ON floor_config
  FOR SELECT
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "floor_config_insert_policy" ON floor_config;
CREATE POLICY "floor_config_insert_policy" ON floor_config
  FOR INSERT
  TO authenticated
  WITH CHECK (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "floor_config_update_policy" ON floor_config;
CREATE POLICY "floor_config_update_policy" ON floor_config
  FOR UPDATE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "floor_config_delete_policy" ON floor_config;
CREATE POLICY "floor_config_delete_policy" ON floor_config
  FOR DELETE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

-- Webhook Events: Access restricted to authenticated users accessing their floor's webhooks
DROP POLICY IF EXISTS "webhook_events_select_policy" ON webhook_events;
CREATE POLICY "webhook_events_select_policy" ON webhook_events
  FOR SELECT
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "webhook_events_insert_policy" ON webhook_events;
CREATE POLICY "webhook_events_insert_policy" ON webhook_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "webhook_events_update_policy" ON webhook_events;
CREATE POLICY "webhook_events_update_policy" ON webhook_events
  FOR UPDATE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "webhook_events_delete_policy" ON webhook_events;
CREATE POLICY "webhook_events_delete_policy" ON webhook_events
  FOR DELETE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

-- Phase Gates: Access restricted to authenticated users accessing their floor's phase gates
DROP POLICY IF EXISTS "phase_gates_select_policy" ON phase_gates;
CREATE POLICY "phase_gates_select_policy" ON phase_gates
  FOR SELECT
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "phase_gates_insert_policy" ON phase_gates;
CREATE POLICY "phase_gates_insert_policy" ON phase_gates
  FOR INSERT
  TO authenticated
  WITH CHECK (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "phase_gates_update_policy" ON phase_gates;
CREATE POLICY "phase_gates_update_policy" ON phase_gates
  FOR UPDATE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "phase_gates_delete_policy" ON phase_gates;
CREATE POLICY "phase_gates_delete_policy" ON phase_gates
  FOR DELETE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

-- Trust Ladder History: Access restricted to authenticated users accessing their floor's trust ladder history
DROP POLICY IF EXISTS "trust_ladder_history_select_policy" ON trust_ladder_history;
CREATE POLICY "trust_ladder_history_select_policy" ON trust_ladder_history
  FOR SELECT
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "trust_ladder_history_insert_policy" ON trust_ladder_history;
CREATE POLICY "trust_ladder_history_insert_policy" ON trust_ladder_history
  FOR INSERT
  TO authenticated
  WITH CHECK (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "trust_ladder_history_update_policy" ON trust_ladder_history;
CREATE POLICY "trust_ladder_history_update_policy" ON trust_ladder_history
  FOR UPDATE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "trust_ladder_history_delete_policy" ON trust_ladder_history;
CREATE POLICY "trust_ladder_history_delete_policy" ON trust_ladder_history
  FOR DELETE
  TO authenticated
  USING (
    floor_id IN (
      SELECT id FROM floors WHERE auth.jwt() ->> 'user_id' IS NOT NULL
    )
  );
