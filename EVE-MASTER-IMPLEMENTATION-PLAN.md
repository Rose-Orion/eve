# EVE Master Implementation Plan — The Road to Best-in-Class

**Created:** April 1, 2026
**Baseline:** Orchestrator core 100% complete, pipelines 40-80%, frontend partial, no tests
**Goal:** Complete every spec requirement, harden for production, make EVE the best autonomous business-building system possible

---

## Current State Summary

**What's production-ready:** Orchestrator core (6,335 lines), PromptBuilder (14 validations), security stack (Guardian + TrustLadder + HMAC + budget enforcement), all 13 agent templates, all API clients with cost tracking, 69 REST endpoints, learning engine, event bus.

**What's partially built:** Dashboard PWA (4,764 lines JS — basic views exist), operations pipelines (interfaces + basic logic, missing deep implementation), creative workflows (media generation only), social publishing (feed posts only), floor management.

**What's not built:** Meta Conversions API (CAPI), Instagram Reels/Stories/Carousel publishing, ad set/creative creation flow, email sequence execution engine, abandoned cart detection, CLV tracking, website component library, analytics/tracking integration, full database migrations, test suite, CI/CD, Docker, API docs.

---

## Phase 1: Database Foundation & Schema (Critical Path)
**Why first:** Everything persists to Supabase. Without complete schema + RLS, nothing else works reliably in production.
**Estimated effort:** 2-3 sessions

### Task 1.1: Generate Complete Migration Suite

**What:** Create SQL migrations for all 27 tables defined in Spec 19 (eve-supplementary-specs.md).

**Reference:** `specs/19-supplementary-specs.md` Part 1: Database Schema
**Existing:** `migrations/001_add_extended_columns.sql` (single file)
**Pattern:** Read `src/integrations/supabase.ts` to see what tables/columns the code already expects.

**Tables to ensure exist:**
1. `floors` — id, name, status, phase, budget_ceiling_cents, spent_cents, owner_email, config JSONB
2. `tasks` — id, floor_id, agent_id, status, phase, task_type, prompt, result, cost_cents, retries, depends_on[], approval_token, created_at, updated_at
3. `cost_events` — id, floor_id, task_id, agent_id, model, input_tokens, output_tokens, cost_cents, provider, created_at
4. `agent_performance` — id, floor_id, agent_id, approval_rate, avg_revision_count, avg_cost_cents, task_count, updated_at
5. `content_queue` — id, floor_id, platform, content_type, scheduled_at, status, post_id, engagement JSONB
6. `content_performance` — id, content_id, floor_id, impressions, clicks, likes, shares, saves, comments, conversions, measured_at
7. `products` — id, floor_id, name, description, variants JSONB, printful_sync_id, status, created_at
8. `orders` — id, floor_id, stripe_session_id, printful_order_id, status, total_cents, tracking_url, created_at
9. `ad_campaigns` — id, floor_id, platform, campaign_id, status, daily_budget_cents, lifetime_spend_cents, roas, created_at
10. `ad_daily_performance` — id, campaign_id, date, impressions, clicks, spend_cents, conversions, roas, ctr, cpc_cents
11. `improvement_proposals` — id, floor_id, type, agent_id, proposal JSONB, status, impact JSONB, created_at
12. `preference_patterns` — id, floor_id, pattern_type, data JSONB, confidence, updated_at
13. `playbook_entries` — id, floor_id, category, title, content, source_task_id, effectiveness_score
14. `ab_tests` — id, floor_id, hypothesis, variant_a JSONB, variant_b JSONB, status, winner, metrics JSONB
15. `approval_queue` — id, floor_id, task_id, type, summary, status, decided_at, decision
16. `notifications` — id, floor_id, type, title, body, read, link, created_at
17. `email_subscribers` — id, floor_id, email_hash, segment, tags[], kit_subscriber_id, created_at
18. `command_log` — id, floor_id, agent_id, command, args JSONB, result, created_at
19. `security_events` — id, floor_id, event_type, severity, details JSONB, created_at
20. `chat_messages` — id, floor_id, sender, message, created_at
21. `floor_tokens` — id, floor_id, provider, access_token_encrypted, refresh_token_encrypted, expires_at
22. `gold_standards` — id, floor_id, agent_id, task_type, output, score, created_at
23. `conversation_history` — id, floor_id, agent_id, messages JSONB, token_count, updated_at
24. `webhook_events` — id, provider, event_type, payload JSONB, processed, created_at
25. `floor_config` — id, floor_id, key, value JSONB
26. `phase_gates` — id, floor_id, phase, gate_type, status, approved_at, approver
27. `trust_ladder_history` — id, floor_id, from_level, to_level, reason, created_at

**Implementation:**
1. Read supabase.ts to catalog every table/column the code references
2. Cross-reference with Spec 19 table definitions
3. Generate numbered migration files (002_ through 010_)
4. Include indexes on floor_id, created_at, status for every table
5. Include foreign key constraints

**Anti-patterns:** Do NOT use an ORM. Supabase uses raw SQL migrations. Do NOT create tables the code doesn't reference (spec-only tables can wait).

**Verification:**
- All migration files parse as valid SQL
- Every table referenced in supabase.ts has a migration
- Indexes on high-query columns

### Task 1.2: Row-Level Security (RLS) Policies

**What:** Add RLS policies so each floor's data is isolated. Cross-floor queries must be impossible except through the Orchestrator's service role.

**Reference:** `specs/16-security-deep-spec.md` (cross-floor isolation), `specs/19-supplementary-specs.md`

**Implementation:**
1. Enable RLS on all tables: `ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;`
2. Create service-role policy for Orchestrator (full access): `CREATE POLICY "service_role_all" ON {table} FOR ALL TO service_role USING (true);`
3. Create floor-scoped policies for dashboard reads: `CREATE POLICY "floor_read" ON {table} FOR SELECT USING (floor_id = current_setting('app.current_floor_id')::uuid);`
4. Test: verify a query with one floor_id cannot return another floor's data

**Verification:**
- RLS enabled on all tables
- Service role bypasses RLS
- Dashboard queries are floor-scoped

### Task 1.3: Backup Automation

**What:** Automated daily Supabase backup + Git backup of workspace files.

**Reference:** `specs/19-supplementary-specs.md` Part 6: Backup & DR

**Implementation:**
1. Create `src/config/backup.ts` with `runDailyBackup()` function
2. Use Supabase Management API for database snapshots (or `pg_dump` via Supabase CLI)
3. Git commit workspace files daily with `[auto-backup]` prefix
4. Retain 30 days of backups, prune older
5. Add to PM2 cron: `cron_restart: "0 3 * * *"` (3 AM daily)

**Verification:**
- Backup script runs without error
- Backup files are created
- Restoration procedure documented and tested

### Phase 1 Verification Checklist
- [ ] `ls migrations/*.sql` — 10+ migration files
- [ ] All tables from supabase.ts have corresponding migrations
- [ ] RLS enabled on all tables
- [ ] Backup script runs successfully
- [ ] `npx tsc --noEmit` — zero errors

---

## Phase 2: Meta Conversions API + Full Ad Pipeline (Critical Revenue Path)
**Why second:** Ads drive revenue. Without CAPI, Meta attributes 30-40% fewer conversions → bad optimization → wasted ad spend. This is the #1 revenue-impacting gap.
**Estimated effort:** 2-3 sessions

### Task 2.1: Meta Conversions API (CAPI) — Server-Side Event Tracking

**What:** Implement server-side event forwarding to Meta's Conversions API. Spec 11 (eve-ads-workflow.md) explicitly states this is **mandatory**.

**Reference:** `specs/11-ads-workflow.md` lines 561-580, Meta Conversions API docs
**Existing:** `src/integrations/meta.ts` has `publishPost()` and `createCampaign()` but ZERO CAPI code.

**File to modify:** `src/integrations/meta.ts`

**Implementation:**
1. Add `sendConversionEvent(pixelId, eventName, eventData, userData)` function
2. POST to `https://graph.facebook.com/v21.0/{PIXEL_ID}/events`
3. Hash user data fields with SHA256: email, phone, first_name, last_name, city, state, zip, country
4. Support events: `PageView`, `ViewContent`, `AddToCart`, `InitiateCheckout`, `Purchase`
5. Include `event_id` for deduplication with browser Pixel
6. Include `event_source_url`, `action_source: 'server'`
7. Batch events (up to 1000 per request, flush every 15 seconds or at threshold)
8. Add `floorId` parameter for budget tracking

**Anti-patterns:**
- Do NOT log unhashed PII (only hashed values)
- Do NOT skip the `test_event_code` parameter during development
- Do NOT send events without `event_id` (causes double-counting)

**Verification:**
- `grep "PIXEL_ID\|/events" src/integrations/meta.ts` — CAPI endpoint present
- Hashing function uses SHA256 (not MD5 or plain text)
- Batch flushing mechanism exists

### Task 2.2: Ad Set + Ad Creative + Ad Creation Flow

**What:** Complete the ad creation hierarchy: Campaign → Ad Set → Ad Creative → Ad.

**Reference:** `specs/11-ads-workflow.md` lines 499-550
**Existing:** `src/integrations/meta.ts` has `createCampaign()` only. `src/orchestrator/ads-pipeline.ts` has campaign plan interfaces.

**Files to modify:**
- `src/integrations/meta.ts` — Add `createAdSet()`, `createAdCreative()`, `createAd()`, `uploadAdImage()`, `uploadAdVideo()`
- `src/orchestrator/ads-pipeline.ts` — Wire the full campaign creation flow

**Implementation:**
1. `createAdSet(campaignId, targeting, budget, optimization)` — POST `/act_{AD_ACCOUNT_ID}/adsets`
   - Targeting spec: age_min, age_max, genders, geo_locations, interests, custom_audiences
   - Optimization goal: OFFSITE_CONVERSIONS, LINK_CLICKS, IMPRESSIONS
   - Billing: IMPRESSIONS (for Advantage+)
2. `uploadAdImage(accountId, imageUrl)` — POST `/act_{AD_ACCOUNT_ID}/adimages`
3. `uploadAdVideo(accountId, videoUrl)` — POST `/act_{AD_ACCOUNT_ID}/advideos` + polling for processing
4. `createAdCreative(accountId, spec)` — POST `/act_{AD_ACCOUNT_ID}/adcreatives` with object_story_spec
5. `createAd(adSetId, creativeId, status)` — POST `/act_{AD_ACCOUNT_ID}/ads` with status=PAUSED
6. Wire into ads-pipeline.ts `executeCampaignPlan()`:
   - Create campaign (existing)
   - Create ad sets per audience
   - Upload creatives (images/videos from media-generator)
   - Create ads linking creative + ad set
   - All created PAUSED → Gate 3 approval activates

**Verification:**
- `grep "createAdSet\|createAdCreative\|createAd" src/integrations/meta.ts` — all 3 exist
- ads-pipeline.ts calls the full hierarchy
- All ads created in PAUSED status

### Task 2.3: TikTok Marketing API — Campaign + Ad Group Creation

**What:** Implement TikTok ad campaign creation matching the Meta flow.

**Reference:** `specs/11-ads-workflow.md` lines 599-645
**Existing:** `src/integrations/tiktok.ts` has content posting only, no marketing API.

**File to modify:** `src/integrations/tiktok.ts`

**Implementation:**
1. `createTikTokCampaign(name, objective, budget)` — POST `/open_api/v1.3/campaign/create/`
2. `createTikTokAdGroup(campaignId, targeting, budget, schedule)` — POST `/open_api/v1.3/adgroup/create/`
3. `createTikTokAd(adGroupId, creativeId)` — POST `/open_api/v1.3/ad/create/`
4. `getTikTokAdInsights(campaignId, dateRange)` — POST `/open_api/v1.3/report/integrated/get/`
5. Support Spark Ads: `enableSparkAd(videoId)` — promote organic posts

**Verification:**
- `grep "campaign/create\|adgroup/create" src/integrations/tiktok.ts` — endpoints present
- TikTok ad creation mirrors Meta flow

### Task 2.4: Daily Ad Optimization Loop

**What:** Automated daily COLLECT → ANALYZE → OPTIMIZE → REPORT cycle.

**Reference:** `specs/11-ads-workflow.md` lines 261-323
**Existing:** `src/orchestrator/ads-pipeline.ts` has campaign plan execution but no daily optimization.

**File to modify:** `src/orchestrator/ads-pipeline.ts`

**Implementation:**
1. `runDailyOptimization(floorId)` — called by Orchestrator daily for launched floors
2. COLLECT: Pull insights from Meta + TikTok for all active campaigns
3. ANALYZE: Calculate ROAS, CPA, CTR, frequency for each ad set
4. OPTIMIZE: Apply rules:
   - ROAS < 1x for 3+ days → pause ad set
   - ROAS > 3x for 3+ days → increase budget 20%
   - CTR declining 3 consecutive days → flag creative fatigue
   - Frequency > 3.0 → rotate creative
   - Never modify during first 7-day learning phase
5. REPORT: Emit `ads:daily-report` event with summary for Dashboard
6. Record all changes to `ad_daily_performance` table

**Anti-patterns:**
- Do NOT pause ads during learning phase (first 7 days)
- Do NOT increase budget more than 20% per day
- Do NOT make changes to campaigns in REVIEW status

**Verification:**
- `grep "runDailyOptimization\|ROAS.*pause\|budget.*20" src/orchestrator/ads-pipeline.ts`
- Circuit breaker rules match spec thresholds

### Task 2.5: Creative Fatigue Detection + Winners Hub

**What:** Track creative performance decay and document winning elements.

**Reference:** `specs/11-ads-workflow.md` lines 344-433

**Files to create:**
- `src/orchestrator/creative-intelligence.ts` (NEW)

**Implementation:**
1. `detectFatigue(adId, metrics[])` — flag if CTR declines 3 consecutive days OR frequency > 3.0
2. `triggerCreativeRefresh(floorId, adSetId)` — queue new creative generation task
3. `recordWinner(floorId, creative)` — save winning headline, image angle, hook, audience to `playbook_entries`
4. `getWinningPatterns(floorId)` — retrieve winners for cross-floor intelligence

**Verification:**
- `grep "detectFatigue\|recordWinner" src/orchestrator/creative-intelligence.ts`
- Winners stored in Supabase

### Phase 2 Verification Checklist
- [ ] `npx tsc --noEmit` — zero errors
- [ ] Meta CAPI sends server-side events with hashed user data
- [ ] Ad creation hierarchy: Campaign → Ad Set → Creative → Ad
- [ ] TikTok campaign creation works
- [ ] Daily optimization loop with ROAS-based circuit breakers
- [ ] Creative fatigue detection active
- [ ] Winners Hub records winning elements

---

## Phase 3: Instagram + Social Media Deep Implementation
**Why third:** Social media is the primary organic growth engine. Currently only supports basic feed posts — missing Reels, Stories, Carousels, engagement automation.
**Estimated effort:** 2-3 sessions

### Task 3.1: Instagram Media Container API (Reels, Stories, Carousels)

**What:** Replace basic `publishPost()` with full Instagram Content Publishing API.

**Reference:** `specs/10-social-media-workflow.md`, Meta Graph API Content Publishing docs
**Existing:** `src/integrations/meta.ts` lines 35-54 — only `/{PAGE_ID}/photos` and `/{PAGE_ID}/feed`

**File to modify:** `src/integrations/meta.ts`

**Implementation:**
1. `createMediaContainer(igAccountId, mediaType, mediaUrl, caption, options)`:
   - Image: POST `/{IG_ACCOUNT_ID}/media` with `image_url`, `caption`
   - Reel: POST `/{IG_ACCOUNT_ID}/media` with `video_url`, `media_type=REELS`, `caption`, `share_to_feed=true`
   - Carousel: POST `/{IG_ACCOUNT_ID}/media` with `children[]` (each child is a container), `media_type=CAROUSEL`
   - Story: POST `/{IG_ACCOUNT_ID}/media` with `media_type=STORIES`
2. `publishMediaContainer(igAccountId, containerId)` — POST `/{IG_ACCOUNT_ID}/media_publish` with `creation_id`
3. `checkContainerStatus(containerId)` — GET `/{CONTAINER_ID}?fields=status_code` (poll until FINISHED)
4. Add retry logic: container processing can take 30-120 seconds for video

**Anti-patterns:**
- Do NOT publish before container status is FINISHED
- Do NOT skip the 2-step container→publish flow
- Do NOT use `/{PAGE_ID}/photos` for Instagram (that's Facebook Pages)

**Verification:**
- `grep "media_publish\|REELS\|CAROUSEL\|STORIES" src/integrations/meta.ts`
- Two-step publish flow (create container → poll → publish)

### Task 3.2: Content Calendar + Weekly Planning

**What:** Generate weekly content calendars with 20-30 briefs per platform.

**Reference:** `specs/10-social-media-workflow.md` Phase 1
**Existing:** `src/orchestrator/content-scheduler.ts` handles publishing queue but not calendar creation.

**File to modify:** `src/orchestrator/content-scheduler.ts`

**Implementation:**
1. `generateWeeklyCalendar(floorId)` — dispatches Strategy Agent to create content plan
   - Input: brand voice, recent performance data, trending topics, product catalog
   - Output: 20-30 content briefs with platform, format, topic, posting time, hashtags
2. `queueCalendarItems(floorId, calendar)` — create tasks for each content brief
3. Platform-specific posting frequencies:
   - Instagram: 1 Reel/day, 3-4 Stories/day, 2 Carousels/week
   - TikTok: 1-2 videos/day
   - Facebook: 1 post/day
4. Optimal posting times with ±5-15min variance (avoid bot-like patterns)

**Verification:**
- `grep "generateWeeklyCalendar\|queueCalendarItems" src/orchestrator/content-scheduler.ts`
- Calendar creates tasks for multiple platforms

### Task 3.3: Cross-Platform Content Adaptation

**What:** Adapt one piece of content for each platform (different captions, hashtags, formats).

**Reference:** `specs/10-social-media-workflow.md` Cross-Posting Strategy

**File to modify:** `src/orchestrator/content-scheduler.ts`

**Implementation:**
1. `adaptForPlatform(content, targetPlatform)` — dispatches Copy Agent to rewrite
   - Instagram: shorter caption, 20-30 hashtags, CTA in bio
   - TikTok: informal tone, trending audio reference, 3-5 hashtags
   - Facebook: longer form, question-based CTA, 2-3 hashtags
2. Never copy-paste across platforms — each gets unique adaptation
3. Track which adaptations perform best for future learning

### Task 3.4: Comment Monitoring + Engagement Automation

**What:** Monitor and triage incoming comments/DMs on published content.

**Reference:** `specs/10-social-media-workflow.md` Phase 4

**File to create:** `src/orchestrator/engagement-manager.ts` (NEW)

**Implementation:**
1. `pollComments(floorId)` — check for new comments every 2 minutes via Meta Graph API + TikTok API
2. `triageComment(comment)` — classify: purchase-intent, complaint, question, compliment, spam
3. `generateResponse(comment, type)` — dispatch Social Media Agent for response
4. Response rules:
   - Purchase intent → respond within 15 min with product link
   - Complaint → escalate to owner if serious, respond with empathy
   - Question → answer using brand knowledge
   - Compliment → thank + engage
   - Spam → hide/delete
5. DM responses: same triage but with longer-form answers
6. Never respond to comments > 48 hours old

**Anti-patterns:**
- Do NOT auto-respond without brand voice alignment
- Do NOT engage with obvious trolls
- Do NOT respond faster than 2 minutes (looks like a bot)

### Task 3.5: Social Performance Analytics + Trend Monitoring

**What:** Track engagement metrics and detect trending content/topics.

**Reference:** `specs/10-social-media-workflow.md` Phase 5

**File to create:** `src/orchestrator/social-analytics.ts` (NEW)

**Implementation:**
1. `collectPerformanceMetrics(floorId)` — pull 1hr, 24hr, 7day rollups per post
2. `detectTopPerformers(floorId)` — identify posts exceeding 2x average engagement
3. `suggestBoost(postId)` — recommend organic → paid promotion for top performers
4. `monitorTrends()` — track trending audio, hashtags, formats on TikTok/Instagram
5. `generateWeeklyReport(floorId)` — summary with conversion attribution
6. Store all metrics in `content_performance` table

### Phase 3 Verification Checklist
- [ ] `npx tsc --noEmit` — zero errors
- [ ] Instagram Reels, Stories, Carousels publishing works (2-step container flow)
- [ ] Weekly content calendar generation
- [ ] Cross-platform content adaptation
- [ ] Comment monitoring with triage + response
- [ ] Performance analytics with weekly rollups
- [ ] Trend monitoring active

---

## Phase 4: Email Sequence Execution Engine
**Why fourth:** Email drives 30-40% of ecommerce revenue. Interfaces exist but zero execution logic — sequences don't actually run.
**Estimated effort:** 2 sessions

### Task 4.1: Sequence Execution Engine

**What:** Build the runtime that actually sends emails on schedule.

**Reference:** `specs/14-email-customer-journey.md`
**Existing:** `src/orchestrator/email-automation.ts` has `EmailSequenceConfig` and `EmailStep` interfaces but no `enrollSubscriber()`, `sendNextStep()`, or delay logic.

**File to modify:** `src/orchestrator/email-automation.ts`

**Implementation:**
1. `enrollSubscriber(floorId, email, sequenceName, metadata)` — start a subscriber in a sequence
   - Create enrollment record with current step = 0, next_send_at
   - Check for exclusion rules (already in sequence, recently unsubscribed)
2. `processEnrollments()` — called every 5 minutes by Orchestrator timer
   - Query all enrollments where next_send_at <= now
   - For each: render email template → send via Resend (transactional) or Kit (marketing)
   - Advance to next step, calculate next_send_at based on delay
   - If final step: mark enrollment complete
3. `exitSequence(email, sequenceName, reason)` — early exit (e.g., purchase during welcome sequence)
4. Template variable substitution: `{{firstName}}`, `{{businessName}}`, `{{productName}}`, `{{discountCode}}`
5. Support both Resend (transactional: order confirmation, shipping) and Kit (marketing: welcome, nurture)

### Task 4.2: Define All 6 Email Sequences

**What:** Implement the 6 sequences from spec with exact timing and content triggers.

**Reference:** `specs/14-email-customer-journey.md` Sequences 1-6

**Implementation:**
1. **Welcome** (5 emails, 9 days): Trigger on email capture → Brand story (Day 0) → Bestsellers (Day 2) → Social proof (Day 4) → 15% discount (Day 7) → Reminder (Day 9). Exit on purchase.
2. **Abandoned Cart** (3 emails, 48hrs): Trigger 1hr after cart add without checkout → Reminder (1hr) → Benefits (24hr) → 10% off (48hr). Exit on purchase.
3. **Post-Purchase** (5 emails, 14 days): Trigger on checkout.session.completed → Confirmation (immediate, Resend) → Shipped (on ship, Resend) → Check-in (Day 5, Kit) → Review request (Day 10, Kit) → Cross-sell (Day 14, Kit)
4. **Win-Back** (3 emails, 14 days): Trigger on 90 days inactive → Miss you (Day 0) → 15% discount (Day 7) → Last call (Day 14). Exit on re-engagement.
5. **VIP** (ongoing): Auto-enroll at 3+ purchases or $150+ LTV → Early access 24hr before launches → 10% permanent discount → Priority support flag
6. **Broadcast** (on-demand): Segmented sends max 2/week → Different versions for VIP, Active, New, Win-back

### Task 4.3: Abandoned Cart Detection

**What:** Detect when a visitor adds to cart but doesn't complete checkout within 1 hour.

**Reference:** `specs/14-email-customer-journey.md` Sequence 2

**File to create:** `src/orchestrator/cart-tracker.ts` (NEW)

**Implementation:**
1. `trackCartEvent(floorId, sessionId, email, items)` — record cart state on add-to-cart webhook
2. `checkAbandonedCarts()` — runs every 15 minutes, finds carts > 1 hour old without matching order
3. `triggerAbandonedCartSequence(floorId, email, items)` — enroll in abandoned-cart sequence
4. Webhook integration: listen for Stripe checkout.session.completed to cancel pending sequences

### Task 4.4: Subscriber Segmentation + CLV Tracking

**What:** Maintain lifecycle segments and calculate customer lifetime value.

**Reference:** `specs/14-email-customer-journey.md` lines 309-363

**File to create:** `src/orchestrator/subscriber-intelligence.ts` (NEW)

**Implementation:**
1. Lifecycle segments: `new-subscriber`, `engaged`, `first-time-buyer`, `repeat-buyer`, `vip`, `at-risk`, `lapsed`
2. Auto-tagging rules:
   - 3+ purchases → `vip`
   - No open in 60 days → `at-risk`
   - No purchase in 90 days → `lapsed`
   - $150+ total spend → `vip`
3. CLV calculation: AOV × Purchase Frequency × Average Lifespan
4. Segment by acquisition source (organic, paid, email, social)
5. Store in `email_subscribers` table with tags and segment fields

### Phase 4 Verification Checklist
- [ ] `npx tsc --noEmit` — zero errors
- [ ] Sequence execution sends emails on schedule
- [ ] All 6 sequences defined with correct timing
- [ ] Abandoned cart detection triggers at 1 hour
- [ ] Subscriber segmentation auto-updates
- [ ] CLV calculated per subscriber
- [ ] Template variable substitution works

---

## Phase 5: Website Build Pipeline + Component Library
**Why fifth:** Websites are the revenue engine. Scaffold generator exists but produces a shell — needs components, Stripe checkout, analytics, SEO.
**Estimated effort:** 2-3 sessions

### Task 5.1: Pre-Built Component Library for Scaffold Generator

**What:** Expand scaffold-generator.ts to output complete, functional components.

**Reference:** `specs/09-website-build-workflow.md` Stage 3
**Existing:** `src/orchestrator/scaffold-generator.ts` generates package.json, next.config, tailwind.config, layout.tsx

**File to modify:** `src/orchestrator/scaffold-generator.ts`

**Implementation:** Add template generation for:
1. **Layout components:** Header, Footer, Navigation, MobileMenu
2. **UI primitives:** Button, Input, Badge, Card, Modal, Toast
3. **E-commerce components:** ProductCard, ProductGallery, CartDrawer, CheckoutButton, PriceDisplay
4. **Content components:** HeroSection, FeatureGrid, Testimonials, FAQ, Newsletter signup
5. All components use Tailwind CSS with brand colors from Foundation Package
6. Accessibility: aria-labels, keyboard navigation, focus management
7. Loading states, error boundaries, empty states

### Task 5.2: Stripe Checkout Integration for Generated Sites

**What:** Generated websites need working checkout flow.

**Reference:** `specs/09-website-build-workflow.md` Stage 5
**Existing:** `src/integrations/stripe.ts` has webhook handling but no checkout session creation template.

**Implementation:**
1. Add checkout template to scaffold-generator: `/app/api/checkout/route.ts`
2. Create Stripe Checkout session with line items from cart
3. Include `floor_id` in session metadata for routing webhooks
4. Success/cancel URL handling
5. Webhook handler template for `checkout.session.completed`

### Task 5.3: Analytics + Tracking Integration

**What:** Generated websites need GA4, Meta Pixel, and cookie consent.

**Reference:** `specs/09-website-build-workflow.md` Stage 6

**Implementation:**
1. Add analytics scaffold: `/app/components/Analytics.tsx`
   - GA4 pageview tracking
   - Meta Pixel with standard events: PageView, ViewContent, AddToCart, InitiateCheckout, Purchase
   - Event deduplication ID (shared with CAPI from Phase 2)
2. Cookie consent banner component (GDPR/CCPA compliant)
3. UTM parameter capture and storage
4. Structured data (JSON-LD) templates: Product, Organization, BreadcrumbList

### Task 5.4: SEO + Performance Optimization Templates

**What:** Generated websites need proper SEO and performance.

**Reference:** `specs/09-website-build-workflow.md` Stages 7-8

**Implementation:**
1. Dynamic metadata per page (title, description, og:image)
2. Sitemap generation (`/app/sitemap.ts`)
3. robots.txt template
4. Next.js Image component with blur placeholders
5. ISR (Incremental Static Regeneration) for product pages
6. Mobile-first responsive layout
7. Core Web Vitals optimization (LCP < 2.5s, FID < 100ms, CLS < 0.1)

### Phase 5 Verification Checklist
- [ ] `npx tsc --noEmit` — zero errors
- [ ] Scaffold generates 15+ component files
- [ ] Stripe checkout flow works end-to-end
- [ ] GA4 + Meta Pixel tracking included
- [ ] Cookie consent banner present
- [ ] SEO metadata and sitemap generated
- [ ] Next.js Image optimization used

---

## Phase 6: Creative Workflows + Multi-Model Pipeline
**Why sixth:** Elevates creative output from "generates images" to "produces brand-consistent, platform-optimized, multi-variation creative at scale."
**Estimated effort:** 2 sessions

### Task 6.1: Intelligent Model Routing for Creative Tasks

**What:** Route each creative task to the optimal model based on content type, not just random selection.

**Reference:** `specs/12-creative-workflows.md` Section 1

**File to modify:** `src/orchestrator/media-generator.ts`

**Implementation:**
1. Routing table:
   - Product photography → Flux 2 Pro (photorealistic)
   - Logo/brand assets → Recraft V4 (vector-style)
   - Text-in-image → GPT Image 1.5 (best text rendering)
   - Social content → Flux Schnell (fast, good enough)
   - Hero images → Ideogram V3 (cinematic)
   - UGC-style → Flux Dev with LoRA (authentic feel)
2. Always generate 3 variations per request
3. Brand Agent quality review gate before publishing

### Task 6.2: Video Production Pipeline (Path A + Path B)

**What:** Two-path video production: quality path (keyframes → video) and speed path (direct text-to-video).

**Reference:** `specs/12-creative-workflows.md` Section 2

**File to modify:** `src/orchestrator/media-generator.ts`

**Implementation:**
1. **Path A (Quality):** Generate key frames as images → Image-to-video with Veo/Runway → Add voiceover (ElevenLabs) → Add captions
2. **Path B (Speed):** Direct text-to-video with Kling 3.0 → Light editing → Publish
3. Route based on content purpose: ads/hero → Path A, social/daily → Path B
4. Video model routing: Veo 3.1 (cinematic), Runway Gen-4.5 (product demos), Kling 3.0 (social/UGC)
5. Cost optimization: Draft with cheap models, finish with premium

### Task 6.3: UGC-Style Ad Creative Production

**What:** Generate user-generated-content-style ads (highest converting format).

**Reference:** `specs/12-creative-workflows.md` Section 3

**Implementation:**
1. 3 UGC production options:
   - AI Avatar with script + product B-roll
   - AI-generated UGC-style (raw, authentic feel)
   - Product showcase + voiceover
2. Generate 50-100 ad variations per campaign launch
3. A/B test variations, scale winners, retire losers

### Phase 6 Verification Checklist
- [ ] `npx tsc --noEmit` — zero errors
- [ ] Model routing table assigns specific models to content types
- [ ] 3 variations generated per creative request
- [ ] Video Path A (quality) and Path B (speed) both functional
- [ ] UGC ad production workflow exists

---

## Phase 7: Dashboard PWA Expansion
**Why seventh:** Backend is 100% ready, all pipelines built. Now the owner needs to see and control everything.
**Estimated effort:** 3-4 sessions

### Task 7.1: Assess + Expand Existing Dashboard

**What:** The dashboard already has 4,764 lines of JS (public/app.js) + 1,796 lines CSS + HTML shell. Assess what exists, then expand.

**Reference:** `specs/18-dashboard-ui.md`
**Existing:** `public/app.js` (4,764 lines), `public/styles.css` (1,796 lines), `public/index.html`

**Implementation:**
1. Read existing app.js to catalog current views and functionality
2. Identify gaps against Spec 18's 6 screens:
   - Home/HQ Dashboard (floor overview, health, notifications)
   - Floor Dashboard (phase progress, task list, agent status)
   - Build Tab (design review, content preview, website preview)
   - Review Tab (approval queue with approve/reject)
   - Operations Tab (ads performance, email metrics, fulfillment tracking)
   - Settings (API keys, budget, trust level, notification preferences)
3. Implement missing screens/components
4. Wire Supabase Realtime for live updates
5. Wire Web Push for notifications

### Task 7.2: Approval Queue UI

**What:** The most critical dashboard feature — owners approve/reject tasks here.

**Implementation:**
1. List of pending approvals with: task summary, agent output preview, estimated cost
2. Approve button → generates HMAC approval token → advances task
3. Reject button → sends feedback → queues revision
4. Bulk approve for routine items
5. Real-time: new approvals appear without refresh

### Task 7.3: Cost Dashboard

**What:** Visualize spending across all dimensions.

**Implementation:**
1. Budget overview: spent vs. allocated, daily burn rate, projected runway
2. Cost by agent (pie chart)
3. Cost by model tier (stacked bar)
4. Cost by phase (timeline)
5. Daily cost trend (line chart, 30 days)
6. Alert indicators at 75% and 90% thresholds

### Task 7.4: PWA Setup

**What:** Make the dashboard installable and work offline.

**Implementation:**
1. Web App Manifest (`manifest.json`)
2. Service Worker for offline caching
3. Install prompt on first visit
4. Push notification permission flow
5. Mobile-responsive layout (already partially done in CSS)

### Phase 7 Verification Checklist
- [ ] All 6 dashboard screens implemented
- [ ] Approval queue works (approve → HMAC token → task advances)
- [ ] Cost charts render with real data
- [ ] Supabase Realtime updates the UI live
- [ ] Web Push notifications work
- [ ] PWA installable on mobile/desktop
- [ ] WCAG 2.1 AA accessibility

---

## Phase 8: Testing, CI/CD & Production Hardening
**Why eighth:** Everything is built. Now make it bulletproof.
**Estimated effort:** 2-3 sessions

### Task 8.1: Test Framework Setup + Critical Path Tests

**What:** Add Vitest and write tests for the highest-risk code paths.

**Implementation:**
1. Install Vitest + testing utilities
2. Unit tests for:
   - PromptBuilder: template assembly, token budgeting, validation (13+ checks)
   - BudgetEnforcer: canAfford(), updateSpend(), threshold alerts
   - TaskManager: state transitions (all valid + invalid paths)
   - Guardian: 5-stage verification, PII detection, approval token validation
   - TrustLadder: level promotion/demotion rules
   - DependencyGraph: getReadyTasks(), cycle detection
   - OutputParser: JSON extraction, fallback parsing
3. Integration tests for:
   - Floor creation → Foundation Sprint dispatch
   - Task lifecycle: CREATED → QUEUED → DISPATCHED → COMPLETED
   - Budget exceeded → task blocked
   - Approval flow: review → approve → HMAC → continue

### Task 8.2: CI/CD Pipeline

**What:** GitHub Actions for automated quality gates.

**Implementation:**
1. `.github/workflows/ci.yml`:
   - `npx tsc --noEmit` — TypeScript check
   - `npx vitest run` — Test suite
   - Lint check (add ESLint if not present)
2. PR checks: require passing CI before merge
3. Deployment: PM2 reload on main branch push (or manual trigger)

### Task 8.3: Docker Containerization

**What:** Docker setup for reproducible deployments.

**Implementation:**
1. `Dockerfile` — Node.js 24, copy src, install deps, build, run
2. `docker-compose.yml` — Orchestrator + Redis
3. Health check endpoint in container
4. Environment variable injection via `.env`
5. Volume mount for workspace data persistence

### Task 8.4: Orchestrator Refactoring

**What:** `orchestrator/index.ts` is 6,335 lines — a maintenance risk. Extract coherent modules.

**Implementation:**
1. Extract floor management methods → `orchestrator/floor-operations.ts`
2. Extract dispatch logic → `orchestrator/dispatch-engine.ts`
3. Extract phase gate logic → `orchestrator/gate-controller.ts`
4. Extract budget investigation methods → `orchestrator/budget-operations.ts`
5. Keep `index.ts` as a thin coordinator that delegates to extracted modules
6. Target: `index.ts` under 2,000 lines

### Task 8.5: Structured Logging + Monitoring

**What:** Replace `console.log` with structured logging for production observability.

**Implementation:**
1. Add `pino` logger (Fastify's default)
2. Structured JSON logs with: timestamp, level, module, floorId, taskId, message
3. Log levels: DEBUG (dev only), INFO (operations), WARN (degraded), ERROR (failures)
4. Log rotation via PM2 or pino-roll
5. Key metrics to track: tasks/minute, avg dispatch latency, budget utilization, error rate
6. Health dashboard endpoint with system metrics

### Task 8.6: API Documentation (OpenAPI)

**What:** Auto-generate API docs from route definitions.

**Implementation:**
1. Add `@fastify/swagger` + `@fastify/swagger-ui`
2. Annotate all 69 endpoints with request/response schemas
3. Serve Swagger UI at `/docs`
4. Include authentication requirements

### Phase 8 Verification Checklist
- [ ] `npx vitest run` — all tests pass
- [ ] GitHub Actions CI passes on every PR
- [ ] Docker build succeeds + container runs
- [ ] orchestrator/index.ts under 2,000 lines
- [ ] Structured logging active (no raw console.log in production paths)
- [ ] Swagger UI accessible at /docs
- [ ] `npx tsc --noEmit` — still zero errors

---

## Phase 9: CEO Mode Deployment + OpenClaw Integration
**Why ninth:** CEO Mode is the user's primary conversational interface. Needs OpenClaw installed and running.
**Estimated effort:** 1-2 sessions

### Task 9.1: Create CEO Mode Agent Files

**What:** Generate the OpenClaw agent directory structure.

**Reference:** `specs/20-openclaw-config.md`

**Implementation:**
1. Create `~/.openclaw/agents/eve-ceo/`:
   - `SOUL.md` — Personality, values, communication style (from spec)
   - `AGENTS.md` — Operational rules, 7-question evaluation framework
   - `HEARTBEAT.md` — 5-minute check-in schedule
   - `USER.md` — Owner preferences (learned over time)
2. Register agent: `openclaw agents add eve-ceo`
3. Test: `openclaw chat --agent eve-ceo --message "test" --json`

### Task 9.2: Floor Manager Agent Files

**What:** Create Floor Manager OpenClaw agent (the real agent that coordinates builds).

**Reference:** `specs/20-openclaw-config.md`

**Implementation:**
1. Create `~/.openclaw/agents/eve-floor-manager/`:
   - `SOUL.md` — Task coordinator personality
   - `AGENTS.md` — Phase management rules, quality review guidelines
   - `HEARTBEAT.md` — Status check every 5 minutes
2. Register and test

### Task 9.3: Wire OpenClaw Heartbeat to Orchestrator

**What:** Floor Manager's 5-minute heartbeat should trigger processQueue and status updates.

**Implementation:**
1. OpenClaw heartbeat calls `/api/health` endpoint
2. If heartbeat includes pending tasks, trigger `processQueue()` immediately
3. Heartbeat response includes: active tasks count, pending approvals, budget status

### Phase 9 Verification Checklist
- [ ] CEO Mode agent registered in OpenClaw
- [ ] Floor Manager agent registered
- [ ] `openclaw chat --agent eve-ceo --message "test"` returns valid response
- [ ] Heartbeat triggers processQueue

---

## Phase 10: End-to-End Integration Testing + Launch Readiness
**Why last:** Everything is built. Now prove it works together.
**Estimated effort:** 2 sessions

### Task 10.1: Smoke Test — Create a Floor End-to-End

**What:** Boot the Orchestrator, create a floor via API, and verify the full lifecycle works.

**Implementation:**
1. Boot orchestrator: `npx tsx src/index.ts`
2. Verify health: `GET /api/health` returns OK
3. Verify integrations: `GET /api/health/integrations` shows connected services
4. Create floor: `POST /api/floors` with test business idea
5. Verify: Floor created in Supabase, agents registered, Phase 1 tasks queued
6. Approve Foundation: `POST /api/approvals/:taskId/approve`
7. Verify: Brand Agent, Strategy Agent, Finance Agent dispatched
8. Check costs: `GET /api/costs/summary` shows API spend
9. Check dashboard: All views render with real data

### Task 10.2: Error Recovery Testing

**What:** Verify the system handles failures gracefully.

**Implementation:**
1. Kill Redis mid-task → verify graceful degradation
2. Exhaust budget → verify hard stop
3. Invalid API key → verify health endpoint flags it
4. Network timeout → verify retry logic
5. Concurrent floor creation → verify isolation
6. Orchestrator restart → verify state recovery from Supabase

### Task 10.3: Performance Baseline

**What:** Establish baseline metrics for normal operation.

**Implementation:**
1. Measure: tasks dispatched per minute, average completion time, cost per task
2. Measure: API response times for all 69 endpoints
3. Measure: Memory usage, CPU usage under load
4. Document baselines for future comparison
5. Set alerting thresholds at 2x baseline

### Task 10.4: Security Audit

**What:** Final security review before production floors.

**Implementation:**
1. Verify no PII in logs (grep for email patterns in log output)
2. Verify cross-floor isolation (attempt cross-floor query)
3. Verify HMAC tokens cannot be forged
4. Verify budget enforcement blocks over-limit
5. Verify immutable rules cannot be bypassed
6. Verify API keys not exposed in any response

### Task 10.5: Documentation + Runbook

**What:** Operational documentation for running EVE in production.

**Files to create:**
- `docs/OPERATIONS.md` — Daily operations guide
- `docs/TROUBLESHOOTING.md` — Common issues and fixes
- `docs/API.md` — Endpoint reference (supplement Swagger)
- `docs/ARCHITECTURE.md` — System overview with diagrams

### Phase 10 Verification Checklist
- [ ] Full floor lifecycle tested end-to-end
- [ ] Error recovery works for all failure modes
- [ ] Performance baseline documented
- [ ] Security audit passes (zero findings)
- [ ] Operations documentation complete
- [ ] **EVE is ready for production floors**

---

## Summary: 10 Phases, ~20-25 Sessions

| Phase | Focus | Sessions | Depends On |
|-------|-------|----------|------------|
| **1** | Database schema + migrations + RLS | 2-3 | Nothing |
| **2** | Meta CAPI + full ad pipeline | 2-3 | Phase 1 |
| **3** | Instagram + social media deep | 2-3 | Phase 1 |
| **4** | Email sequence execution engine | 2 | Phase 1 |
| **5** | Website components + checkout + analytics | 2-3 | Phase 2 (CAPI dedup) |
| **6** | Creative workflows + multi-model | 2 | Phase 3 |
| **7** | Dashboard PWA expansion | 3-4 | Phases 2-6 (data to show) |
| **8** | Testing + CI/CD + Docker + refactoring | 2-3 | Phase 7 |
| **9** | CEO Mode + OpenClaw deployment | 1-2 | Phase 8 |
| **10** | E2E testing + launch readiness | 2 | Phase 9 |

**Phases 1-4 can partially overlap** (database, ads, social, email are independent after schema exists).
**Phase 7 benefits from waiting** until pipelines are complete (more data to display).
**Phase 10 is the final gate** before production floors.

---

## What Makes EVE Best-in-Class

Beyond closing spec gaps, this plan includes:

1. **Server-side conversion tracking (CAPI)** — Most competitors rely on browser pixels alone, losing 30-40% of attribution data. EVE tracks server-side.

2. **Multi-model creative intelligence** — Not just "generate an image" but routing to the optimal model per content type, generating 3 variations, and learning which styles convert.

3. **Full email lifecycle automation** — From welcome to win-back, with abandoned cart detection, CLV tracking, and A/B tested subject lines. Most tools stop at "send email."

4. **Self-improving system** — Performance tracking, gold standards, cross-floor intelligence, trust ladder progression. EVE gets better with every floor it builds.

5. **Budget enforcement at every layer** — Pre-dispatch estimate, client-level validation, daily ceiling, threshold alerts. No runaway spending is possible.

6. **Cryptographic approval flow** — HMAC tokens for high-risk actions, not just a checkbox. Spoofing an approval is mathematically infeasible.

7. **Config-driven operations** — Boot patches, model routing, trust levels — all configurable without code changes.

8. **Production-grade infrastructure** — Docker, CI/CD, structured logging, automated backups, health monitoring, API documentation.
