# EVE — Supplementary Specifications
## Database Schema, Revision System, Testing, Onboarding, Monitoring

---

# PART 1: CONSOLIDATED DATABASE SCHEMA

All tables live in Supabase (PostgreSQL). Row-level security (RLS) enforces data isolation.

```sql
-- ============================================
-- CORE SYSTEM TABLES
-- ============================================

CREATE TABLE floors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                    -- "FaithForge"
  slug TEXT UNIQUE NOT NULL,             -- "faithforge"
  goal TEXT NOT NULL,                    -- Business goal description
  status TEXT NOT NULL DEFAULT 'building', -- building | staging | live | paused | archived
  trust_level INT NOT NULL DEFAULT 1,   -- 1-4 Trust Ladder level
  config JSONB NOT NULL DEFAULT '{}',   -- Floor-specific configuration
  budget_ceiling_cents INT NOT NULL,     -- Total budget ceiling in cents
  budget_spent_cents INT NOT NULL DEFAULT 0,
  ad_budget_daily_cents INT DEFAULT 0,  -- Daily ad budget in cents
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID REFERENCES floors(id),
  role TEXT NOT NULL,                    -- "floor-manager", "brand-agent", etc.
  model_tier TEXT NOT NULL,              -- "opus", "sonnet", "haiku"
  status TEXT NOT NULL DEFAULT 'idle',   -- idle | working | blocked | paused
  current_task TEXT,                     -- Description of current work
  openclaw_agent_id TEXT,               -- OpenClaw registration ID
  config JSONB DEFAULT '{}',            -- Agent-specific config
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE phases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID REFERENCES floors(id),
  phase_number INT NOT NULL,             -- 1-10
  name TEXT NOT NULL,                    -- "Foundation", "Alpha", "Content", etc.
  status TEXT NOT NULL DEFAULT 'pending', -- pending | active | completed | skipped
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  gate_approved BOOLEAN DEFAULT FALSE,  -- For phases with approval gates
  gate_approved_at TIMESTAMPTZ
);

-- ============================================
-- COST & PERFORMANCE TRACKING
-- ============================================

CREATE TABLE cost_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID REFERENCES floors(id),
  agent_id UUID REFERENCES agents(id),
  event_type TEXT NOT NULL,              -- "llm_call", "image_gen", "video_gen", "api_call"
  model TEXT,                            -- "opus-4.6", "sonnet-4.6", "flux-2-max", etc.
  input_tokens INT,
  output_tokens INT,
  cost_cents INT NOT NULL,              -- Cost in cents
  task_description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE agent_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id),
  floor_id UUID REFERENCES floors(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  tasks_completed INT DEFAULT 0,
  approval_rate DECIMAL(5,4),           -- 0.0000 to 1.0000
  avg_revision_count DECIMAL(5,2),
  avg_time_seconds INT,
  avg_cost_cents INT,
  avg_turns INT,
  quality_trend TEXT,                    -- "improving", "stable", "declining"
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CONTENT & PUBLISHING
-- ============================================

CREATE TABLE content_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID REFERENCES floors(id),
  content_type TEXT NOT NULL,            -- "reel", "carousel", "story", "feed_post", "tiktok_video"
  platform TEXT NOT NULL,                -- "instagram", "tiktok", "facebook"
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | review | approved | scheduled | published | rejected
  media_url TEXT,                        -- URL to media file (image/video)
  caption TEXT,
  hashtags TEXT[],
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  post_id TEXT,                          -- Platform post ID after publishing
  created_by UUID REFERENCES agents(id),
  reviewed_by UUID REFERENCES agents(id), -- Brand Agent review
  approved_by TEXT,                      -- "brand-agent" | "owner"
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE content_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID REFERENCES content_queue(id),
  platform TEXT NOT NULL,
  views INT DEFAULT 0,
  likes INT DEFAULT 0,
  comments INT DEFAULT 0,
  shares INT DEFAULT 0,
  saves INT DEFAULT 0,
  reach INT DEFAULT 0,
  engagement_rate DECIMAL(5,4),
  clicks INT DEFAULT 0,
  revenue_attributed_cents INT DEFAULT 0,
  measured_at TIMESTAMPTZ DEFAULT NOW(), -- Snapshot time
  measurement_window TEXT                -- "1h", "24h", "48h", "7d"
);

-- ============================================
-- PRODUCTS & ORDERS
-- ============================================

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID REFERENCES floors(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  base_cost_cents INT NOT NULL,         -- Cost from POD/supplier
  price_cents INT NOT NULL,             -- Selling price
  margin_percent DECIMAL(5,2),
  images TEXT[],                         -- Array of image URLs
  variants JSONB DEFAULT '[]',          -- Size/color variants
  pod_product_id TEXT,                  -- Printful/Printify product ID
  status TEXT DEFAULT 'draft',          -- draft | active | paused | archived
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID REFERENCES floors(id),
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent TEXT,
  customer_email_hash TEXT,             -- SHA256 hash (never store raw email in this table)
  items JSONB NOT NULL,                 -- Array of {product_id, variant, quantity, price}
  subtotal_cents INT NOT NULL,
  shipping_cents INT NOT NULL,
  total_cents INT NOT NULL,
  status TEXT DEFAULT 'paid',           -- paid | fulfilling | shipped | delivered | refunded
  fulfillment_id TEXT,                  -- POD provider order ID
  tracking_number TEXT,
  tracking_url TEXT,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  utm_source TEXT,                      -- Attribution
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ADS
-- ============================================

CREATE TABLE ad_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID REFERENCES floors(id),
  platform TEXT NOT NULL,               -- "meta", "tiktok"
  platform_campaign_id TEXT,            -- Meta/TikTok campaign ID
  name TEXT NOT NULL,
  objective TEXT,
  daily_budget_cents INT,
  status TEXT DEFAULT 'paused',         -- paused | active | completed
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ad_daily_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES ad_campaigns(id),
  date DATE NOT NULL,
  spend_cents INT DEFAULT 0,
  impressions INT DEFAULT 0,
  clicks INT DEFAULT 0,
  conversions INT DEFAULT 0,
  revenue_cents INT DEFAULT 0,
  roas DECIMAL(6,2),
  cpa_cents INT,
  ctr DECIMAL(6,4),
  frequency DECIMAL(4,2)
);

-- ============================================
-- IMPROVEMENT ENGINE
-- ============================================

CREATE TABLE improvement_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID REFERENCES floors(id),  -- NULL if applies to all floors
  type TEXT NOT NULL,                    -- "prompt_change", "strategy_change", "config_change"
  target_agent TEXT,                     -- Agent role this affects
  priority TEXT DEFAULT 'medium',        -- "high", "medium", "low"
  what_changes TEXT NOT NULL,
  current_state TEXT,
  proposed_state TEXT NOT NULL,
  evidence JSONB NOT NULL,
  expected_impact TEXT,
  risk_level TEXT DEFAULT 'low',
  rollback_plan TEXT,
  status TEXT DEFAULT 'proposed',        -- proposed | approved | applied | confirmed | rolled_back | rejected
  proposed_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  impact_measured_at TIMESTAMPTZ,
  impact_result JSONB                    -- Measured outcome after application
);

CREATE TABLE preference_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,                -- "design", "copy", "content", "strategy"
  pattern_type TEXT NOT NULL,            -- "bold_over_minimalist", "short_copy_preferred", etc.
  description TEXT NOT NULL,
  confidence_score DECIMAL(5,4),
  evidence_count INT DEFAULT 0,
  evidence JSONB DEFAULT '[]',
  applied_as_default BOOLEAN DEFAULT FALSE,
  applied_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE playbook_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,                -- "ad-strategies", "content-formats", "pricing", etc.
  title TEXT NOT NULL,
  strategy TEXT NOT NULL,
  results JSONB,
  source_floor_id UUID REFERENCES floors(id),
  applicability TEXT,
  times_applied INT DEFAULT 0,
  avg_impact_when_applied JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ab_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID REFERENCES improvement_proposals(id),
  variant_a_config JSONB NOT NULL,
  variant_b_config JSONB NOT NULL,
  tasks_a INT DEFAULT 0,
  tasks_b INT DEFAULT 0,
  results_a JSONB,
  results_b JSONB,
  winner TEXT,                           -- "a", "b", "inconclusive"
  status TEXT DEFAULT 'running',         -- running | completed | cancelled
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ============================================
-- APPROVALS & NOTIFICATIONS
-- ============================================

CREATE TABLE approval_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID REFERENCES floors(id),
  type TEXT NOT NULL,                    -- "gate", "content", "design", "campaign", "improvement", "input_needed"
  priority TEXT DEFAULT 'normal',        -- "critical", "normal", "low"
  title TEXT NOT NULL,
  description TEXT,
  data JSONB,                            -- Type-specific payload (images, campaign details, etc.)
  status TEXT DEFAULT 'pending',         -- pending | approved | rejected | deferred
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID REFERENCES floors(id),  -- NULL for system-wide
  tier TEXT NOT NULL,                    -- "critical", "important", "informational"
  title TEXT NOT NULL,
  body TEXT,
  link_to TEXT,                          -- Deep link in the app
  read BOOLEAN DEFAULT FALSE,
  push_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- EMAIL & CUSTOMERS
-- ============================================

CREATE TABLE email_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID REFERENCES floors(id),
  email_hash TEXT NOT NULL,              -- SHA256 hash
  kit_subscriber_id TEXT,               -- Kit (ConvertKit) subscriber ID
  segment TEXT DEFAULT 'new-subscriber',
  tags TEXT[],
  total_orders INT DEFAULT 0,
  total_spent_cents INT DEFAULT 0,
  last_order_at TIMESTAMPTZ,
  last_email_opened_at TIMESTAMPTZ,
  clv_cents INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- AUDIT & SECURITY
-- ============================================

CREATE TABLE command_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID REFERENCES floors(id),
  agent_id UUID REFERENCES agents(id),
  command TEXT NOT NULL,
  tier INT NOT NULL,                     -- 1, 2, or 3
  approved BOOLEAN,
  approved_by TEXT,                       -- "auto", "floor-manager", "owner"
  output TEXT,
  error TEXT,
  exit_code INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID REFERENCES floors(id),
  event_type TEXT NOT NULL,              -- "forbidden_command", "budget_alert", "demotion", "incident"
  severity TEXT NOT NULL,                -- "info", "warning", "critical"
  description TEXT NOT NULL,
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

# PART 2: REVISION SYSTEM

How feedback flows from you through the system to the right agent.

```
REVISION PIPELINE:

  YOU give feedback (via Chat, Review Tab, or inline comments)
     │
     ▼
  FLOOR MANAGER receives and interprets
     │
     ├── Is the feedback clear enough to act on?
     │   YES → route to the right agent
     │   NO → ask you a clarifying question
     │
     ├── Route by feedback type:
     │   Visual/design feedback → Design Agent
     │   Text/copy feedback → Copy Agent
     │   Layout/functionality → Web Agent
     │   Video feedback → Video Agent
     │   Strategy/direction → Strategy Agent (or escalate to CEO Mode)
     │   Pricing feedback → Commerce Agent
     │   Ad feedback → Ads Agent
     │   Technical issue → Web Agent or Launch Agent
     │
     ├── Ambiguous feedback (touches multiple agents):
     │   Floor Manager breaks it into sub-tasks:
     │   "Make the homepage feel more premium" →
     │     1. Design Agent: more whitespace, refined hero image
     │     2. Copy Agent: shorter, more confident headline
     │     3. Web Agent: implement both changes
     │
     └── Agent receives the task with:
         - Your exact feedback (quoted)
         - Floor Manager's interpretation
         - Reference to the specific item being revised
         - Previous version for comparison

REVISION RULES:
  - Max 3 revision rounds per item before escalation
  - If an agent can't satisfy feedback after 3 tries:
    → Floor Manager escalates to CEO Mode
    → CEO Mode may reassign to a different agent or adjust the approach
  - Each revision logged with: version number, feedback, changes made, cost
  - All previous versions preserved (Git-versioned)

SPEED EXPECTATIONS:
  - Text/copy revision: 5-10 minutes
  - Design/image revision: 15-30 minutes
  - Website change: 10-30 minutes (depends on scope)
  - Video revision: 30-60 minutes
  - Strategy revision: 15-30 minutes

VERSION HISTORY:
  Every deliverable has a version trail:
  v1.0 → (your feedback) → v1.1 → (your feedback) → v1.2 → approved
  
  You can revert to any previous version:
  "Actually, I liked v1.0 better" → Floor Manager reverts

POST-LAUNCH REVISIONS:
  Same pipeline, but with urgency levels:
  - URGENT (site broken, wrong price, offensive content): immediate fix
  - STANDARD (design tweak, copy update): queued and handled within 24h
  - LOW (nice-to-have improvement): added to next improvement cycle
```

---

# PART 3: TESTING STRATEGY

```
AGENT OUTPUT TESTING (per agent type):

  COPY AGENT RUBRIC:
  □ Word count within specified limit
  □ Brand voice matches Foundation Package (tone, vocabulary)
  □ Contains required elements (CTA, product name, benefit statement)
  □ Grammar and spelling correct
  □ No placeholder text or hallucinated facts
  □ Platform-appropriate (Instagram vs TikTok vs email)

  DESIGN AGENT RUBRIC:
  □ Uses brand color palette
  □ Typography matches brand guidelines
  □ Image dimensions correct for target format
  □ Print-ready specs met (300 DPI, correct color space)
  □ Text legible at target display size
  □ No watermarks, artifacts, or distortion

  WEB AGENT RUBRIC:
  □ Page loads without errors
  □ TypeScript strict mode passes
  □ Mobile responsive at 375px
  □ All interactive elements work (buttons, forms, navigation)
  □ No console errors
  □ Accessibility basics (semantic HTML, alt text, keyboard nav)
  □ Performance: LCP < 2.5s

  ADS AGENT RUBRIC:
  □ Campaign structure matches approved architecture
  □ Budget within approved limits
  □ Targeting matches audience strategy
  □ All tracking pixels/CAPI configured
  □ Creative passes platform policy (no restricted content)
  □ UTM parameters correctly set

REGRESSION TESTING:
  After any prompt change (from Improvement Engine):
  1. Run 5 standard test tasks with the old prompt → score against rubric
  2. Run 5 standard test tasks with the new prompt → score against rubric
  3. Compare scores
  4. If new prompt scores lower on any rubric item → flag for review
  5. Only commit the change if net score improves

INTEGRATION TESTING:
  Before each gate (Foundation, Launch, Ads):
  - Launch Agent runs the full checklist for that phase
  - Automated checks where possible (page loads, tracking fires, etc.)
  - Manual checks flagged for your review
```

---

# PART 4: ONBOARDING FLOW

```
FIRST-TIME USER EXPERIENCE:

STEP 1: Install EVE PWA
  - Visit eve.yourdomain.com on your phone
  - Prompted to "Add to Home Screen"
  - Tap → app icon appears on home screen
  - Open → magic link login (enter email, tap link in email)

STEP 2: Welcome Wizard (CEO Mode guides you)
  CEO MODE: "Welcome to EVE. Let's set you up.
  I need a few things before we can build anything."

  Screen 1: Connect Services
  ┌──────────────────────────────────────┐
  │ Connect your services:               │
  │                                      │
  │ [✅] Anthropic API key    Connected  │
  │ [  ] Stripe account       Connect → │
  │ [  ] Meta Business        Connect → │
  │ [  ] Kit (ConvertKit)     Connect → │
  │ [  ] Printful             Connect → │
  │                                      │
  │ Skip for now — you can add later    │
  │                                      │
  │ [Continue →]                         │
  └──────────────────────────────────────┘
  
  Only Anthropic API key is required to start.
  Others can be connected when the floor needs them.

  Screen 2: Budget Preferences
  - Set test ceiling (default $200, adjustable)
  - Alert thresholds (default 50/75/90%)
  - Notification preferences (quiet hours, briefing time)

  Screen 3: First Floor
  CEO MODE: "Ready to build something? Tell me your idea."
  → Opens the CEO Mode chat
  → This is Phase 0 of the end-to-end workflow

RETURNING USER:
  - Open app → biometric unlock → Home screen
  - Morning briefing notification at configured time
  - Everything else through normal navigation
```

---

# PART 5: MONITORING & OBSERVABILITY

```
SYSTEM HEALTH MONITORING:

  EVE CORE:
  ├── OpenClaw session health (are agents responding?)
  ├── Lobster pipeline status (any stuck/failed pipelines?)
  ├── Supabase connection health
  ├── API key validity (Anthropic, Stripe, Meta, Kit, Printful)
  └── Mac Mini resource usage (CPU, memory, disk)

  PER-FLOOR HEALTH:
  ├── Agent response times (are agents slower than normal?)
  ├── Error rate (% of agent tasks that fail)
  ├── Cost velocity (is spending higher than projected?)
  ├── Content pipeline throughput (pieces produced per day)
  └── Revenue trend (growing, stable, declining)

  EXTERNAL SERVICES:
  ├── Stripe webhook health (are webhooks delivering?)
  ├── Meta API status (rate limits, errors)
  ├── TikTok API status
  ├── Kit API status
  ├── Printful API status
  ├── Vercel deployment status
  └── Domain/SSL certificate expiry

HEALTH CHECK SCHEDULE:
  - Every 5 minutes: OpenClaw heartbeat, Supabase connection
  - Every hour: API key validity, external service status
  - Every day: Cost velocity, revenue trend, agent performance
  - Every week: Full system audit (CEO Mode weekly cycle)

ALERTING:
  - Agent down for 10+ minutes → Floor Manager notified
  - External API failing → Floor Manager attempts recovery → notifies you if persistent
  - Budget velocity anomaly → Finance Agent flags → notification to you
  - SSL certificate expiring in < 14 days → notification to you
  - Any security event → immediate notification

DASHBOARD SECTION (Settings → System Health):
  Simple traffic light view:
  🟢 All systems operational
  🟡 1 issue detected (details →)
  🔴 Critical issue (details →)
```

---

# PART 6: FLOOR SHUTDOWN / ARCHIVING

When you decide to close a business floor:

```
SHUTDOWN SEQUENCE (Orchestrator, triggered by you):

  1. PAUSE ADS (immediate)
     → Ads Agent pauses all active campaigns via API
     → No more ad spend from this moment

  2. STOP CONTENT (immediate)
     → Social Media Agent stops publishing queued content
     → Scheduled posts cancelled
     → Community responses continue for 7 more days (wind down gracefully)

  3. FULFILL REMAINING ORDERS (1-2 weeks)
     → Any orders already placed continue through fulfillment
     → Commerce Agent monitors until all orders delivered
     → No new orders accepted after a cutoff date you specify

  4. DISABLE CHECKOUT (after order cutoff)
     → Web Agent removes "Add to Cart" and checkout functionality
     → Site stays live as a brand presence but can't transact
     → Or: redirect to a "We've closed" page with a message

  5. ARCHIVE FLOOR (after all orders fulfilled)
     → Floor status → "archived"
     → All agent heartbeats stopped
     → Agent sessions closed in OpenClaw
     → Workspace preserved in Git (tagged: "archived-{date}")
     → Database records preserved (never deleted)
     → Supabase data retained for financial records

  6. OPTIONAL: FULL TEARDOWN
     → Cancel domain renewal (if custom domain)
     → Delete Vercel deployment
     → Remove products from POD provider
     → Unsubscribe email list with final "We're closing" email
     → This is permanent and requires your explicit confirmation

WHAT'S PRESERVED:
  - All Git history (brand, code, content, designs)
  - All financial records (orders, revenue, costs)
  - All analytics data
  - Playbook entries from this floor (knowledge lives on)
  
WHAT'S REMOVED:
  - Active agent sessions
  - Heartbeats
  - Scheduled content and ad campaigns
  - Active email automations
```

---

# PART 7: BACKUP & DISASTER RECOVERY

```
AUTOMATED BACKUPS:

  GIT (primary backup for workspace files):
  - Every floor workspace is a Git repo
  - Orchestrator auto-commits after every significant change
  - Push to remote (GitHub private repo) daily at 2 AM
  - This covers: prompts, brand docs, agent configs, website code, designs

  SUPABASE (database backup):
  - Supabase Pro includes daily automatic backups
  - Point-in-time recovery available (restore to any second in last 7 days)
  - For free tier: Orchestrator exports critical tables as JSON daily
    → stored in __PATH_EVE_BACKUPS__ → included in the Git push to remote

  MAC MINI LOCAL:
  - Time Machine enabled (if external drive attached)
  - Or: rsync to external drive nightly
  - .env.local backed up separately (encrypted, to secure cloud storage)
  - NEVER store API keys in Git

CRON SCHEDULE:
  0 2 * * * cd ~/orion-projects && git push --all origin    # Push all repos daily
  0 3 * * * __PATH_EVE_SCRIPTS__backup-supabase.sh              # Export DB tables
  0 4 * * * __PATH_EVE_SCRIPTS__backup-env.sh                   # Encrypt and upload .env

RECOVERY PROCEDURES:

  Mac Mini dies:
  1. Set up new Mac Mini
  2. Install OpenClaw, Node.js, Redis, PM2
  3. Clone all floor repos from GitHub
  4. Restore .env.local from encrypted backup
  5. Connect to Supabase (cloud — no data lost)
  6. Start Orchestrator: pm2 start eve
  7. Floor Managers check in on next heartbeat → system self-heals
  Estimated recovery time: 2-4 hours

  Supabase outage:
  1. Orchestrator switches to local SQLite fallback
  2. Queues all database writes
  3. When Supabase recovers → sync queued writes
  4. No data loss, brief degraded performance

  Accidental file deletion:
  1. git log to find the last good commit
  2. git checkout {commit} -- {filepath} to restore
  3. Or: git revert {commit} to undo an entire change
```
