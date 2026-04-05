# EVE — Unified System Specification v2.0

## Document Purpose

This is the single source of truth for what EVE is, how it works, and how it gets built. It replaces all previous spec files (EVE-AGENT-ROSTER.md, EVE-INFRASTRUCTURE.md, EVE-OPERATIONS.md, EVE-SECURITY.md, EVE-BUSINESS-INTELLIGENCE.md, EVE-CONTENT-CREATION.md, EVE-VIDEO-WORKFLOW.md, EVE-POST-LAUNCH.md, SKILL-REGISTRY.md). Those files contained good thinking — this document incorporates all of it with corrections, consolidations, and missing pieces filled in.

---

# SECTION 1: WHAT EVE IS

## The Vision

EVE is an autonomous system that builds and runs businesses. You describe an idea. EVE evaluates it, plans it, assembles a team of AI agents, builds everything (brand, website, products, content, ads, email, support), launches it, and then continuously operates and improves the business.

EVE is three systems in one:

**System 1 — The CEO Brain.** Takes your idea, asks questions, evaluates the business model, plans the floor, assembles the agent team, and oversees everything. This is CEO Mode.

**System 2 — Autonomous Floors.** Each floor is a complete business with its own team of agents, its own brand, its own custom UI for your approvals, its own content pipeline, its own ads, its own everything. A Floor Manager runs the day-to-day. You step in at key decision points.

**System 3 — The Improvement Engine.** EVE and every agent under it get smarter over time. Better prompts, better strategies, better outputs — continuously, based on real results. This is what makes EVE different from a project management tool.

## How You Interact

**Mobile-first.** You manage EVE from your phone. The interface is a PWA (Progressive Web App) — installs like an app, sends push notifications, works offline for cached data. The primary interaction model is notifications that pull you in when decisions need to be made, cards you swipe to approve or reject, and chat with Floor Managers when you need to give direction.

**You never talk to agents directly.** Everything goes through Floor Managers (for floor-level work) or CEO Mode (for EVE-level decisions).

**The Trust Ladder.** You control how much autonomy EVE has, and it earns more over time:

- **Level 1: Training Wheels.** Every decision surfaced to you. You approve or reject everything. This is how it starts.
- **Level 2: Supervised Autonomy.** EVE handles routine decisions automatically but logs everything and shows you a daily digest. You can override anything.
- **Level 3: Autonomous with Guardrails.** Routine operations run without surfacing. You see approval gates, budget alerts, and anything flagged as unusual. Weekly reports replace daily.
- **Level 4: Full Autonomy.** EVE runs the floors. You check in when you want. Notified only for money decisions and strategic pivots.

You decide when to move up a level. You can move back down anytime. EVE never self-promotes. The kill switch is always one tap away — everything pauses instantly.

---

# SECTION 2: ARCHITECTURE

## Five Core Components

```
┌─────────────────────────────────────────────────┐
│                   YOU (Phone)                    │
│              PWA Dashboard + Chat                │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│              EVE BRAIN (CEO Mode)              │
│   Business intelligence, floor creation,         │
│   cross-floor strategy, improvement proposals    │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│              EVE ORCHESTRATOR                   │
│   Task queue, worker pool, dependency tracking,  │
│   status broadcasting, cost tracking,            │
│   sub-agent management                           │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│              PROMPTBUILDER                        │
│   Assembles system prompts from:                 │
│   role + brand + skills + task + rules           │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│         OPENCLAW RUNTIME (per agent)             │
│   Anthropic API calls, conversation history,     │
│   tool execution, action verification            │
└─────────────────────────────────────────────────┘
```

### Component 1: EVE Brain (CEO Mode)

The top-level intelligence. Permanently loaded with business intelligence frameworks (the 7-question business model, market evaluation, pricing psychology, brand principles, growth strategy, ecommerce intelligence, financial modeling).

**Responsibilities:**
- Evaluate business ideas through the 7-question framework
- Ask clarifying questions to understand the goal
- Create floor configurations (agents, skills, models, budget)
- Monitor all floors for cross-floor optimization opportunities
- Maintain the playbook library (proven strategies from successful floors)
- Propose system improvements (prompt changes, workflow optimizations)
- Aggregate financial data across all floors

**Deep knowledge on demand:** CEO Mode reads reference files from the knowledge library when working on specific tasks. Not always loaded — pulled in when relevant.

```
eve/knowledge/
  business-models/     (ecommerce, digital, service, subscription playbooks)
  market-analysis/     (competitor research, demand validation, niche evaluation)
  brand/               (archetypes, naming, voice development)
  pricing/             (strategies, psychology, competitive analysis)
  growth/              (paid acquisition, organic, email, influencer)
  conversion/          (landing pages, checkout, product pages, A/B testing)
  content/             (viral frameworks, algorithms, repurposing, UGC)
  finance/             (unit economics, projections, cash flow)
```

### Component 2: EVE Orchestrator

The custom layer that manages multi-agent execution. This is NOT OpenClaw — this is built on top of OpenClaw.

**Responsibilities:**
- Priority-based task queue with dependencies
- Worker pool with configurable concurrency (default: 6 per floor, 15 total)
- Agent lifecycle management (idle → working → blocked → complete)
- Dependency tracking (auto-triggers agents when upstream outputs appear)
- Status broadcasting (every agent's state visible in real-time)
- Cost tracking with token-level granularity
- Budget enforcement (hard stop at ceiling, alerts at 50/75/90%)
- Sub-agent spawning and management
- Circuit breaker pattern (pause all if spend exceeds 150% of daily budget)
- Runaway detection (50 turns on one task, or 3 repeated identical actions → pause)

**OpenClaw's role:** OpenClaw executes individual agent work cycles — calling the Anthropic API, managing conversation history, executing tool actions (terminal commands, API calls, file writes). The Orchestrator tells OpenClaw WHAT to run and WHEN. OpenClaw handles the HOW.

### Component 3: PromptBuilder

The engine that makes agents smart. Takes inputs and assembles a complete system prompt.

**Inputs:**
- Role template (who this agent is, what it can/can't do)
- Brand context (extracted from Foundation Package, tailored per agent type)
- Skill knowledge (extracted from assigned SKILL.md files, max 3)
- Current task (specific assignment from Floor Manager)
- Workspace context (what outputs exist, what's pending)
- Rules (terminal tier, approval rules, collaboration rules)
- Business intelligence (relevant frameworks, loaded when needed)

**Output:** A complete system prompt under 8,000 tokens.

**Priority order when approaching token limits:**
1. Role + Rules (always included, ~1,500 tokens)
2. Current Task (~500-1,000 tokens)
3. Brand Context (~1,000-1,500 tokens)
4. Skill Knowledge (~1,000-3,000 tokens per skill)
5. Business Intelligence (~500-1,500 tokens)
6. Workspace Context (~500-1,000 tokens)
7. Deep Knowledge References (~1,000-3,000 tokens, loaded on demand)

### Component 4: Dashboard (PWA)

Mobile-first progressive web app. Card-based layout. Notifications as primary interaction.

**Design principles:**
- Phone screen is the primary canvas (375px width)
- Cards, not tables. Swipe actions, not dropdowns.
- Notifications pull you in. You don't have to check constantly.
- Approval flows are one-tap or one-swipe
- Data is glanceable. Details are available on demand.
- Voice input option for chatting with Floor Managers

**Structure:**

```
EVE (PWA)
  ├── Home (HQ Dashboard)
  │   ├── Total revenue (hero number)
  │   ├── Floor cards (status, key metric, health)
  │   ├── Pending approvals (red badges)
  │   ├── CEO Mode chat
  │   └── System health (agents running, cost today)
  │
  ├── Floor View (tap a floor card)
  │   ├── Overview Tab (post-launch)
  │   │   ├── Revenue today (hero)
  │   │   ├── Orders, AOV, conversion rate
  │   │   ├── Revenue chart (24h/7d/30d)
  │   │   ├── Ad performance cards
  │   │   ├── Content queue
  │   │   └── Engagement panel (DMs, comments, response time)
  │   │
  │   ├── Build Tab (during build)
  │   │   ├── Progress % (hero)
  │   │   ├── Current phase + days to launch
  │   │   ├── Agent status cards (tap for detail)
  │   │   ├── Cost tracker
  │   │   ├── Approval gates
  │   │   └── Floor Manager chat
  │   │
  │   ├── Review Tab (dynamic per floor)
  │   │   ├── Brand selector (3 options, tap to pick)
  │   │   ├── Image approval gallery (swipe left/right)
  │   │   ├── Content approval queue
  │   │   ├── Product mockup viewer
  │   │   ├── A/B comparator (side by side)
  │   │   └── Components assembled by Floor Manager based on floor needs
  │   │
  │   └── Settings Tab
  │       ├── Credentials
  │       ├── Domain + hosting
  │       ├── Budget limits
  │       └── Notifications
  │
  ├── Approvals (unified queue across all floors)
  │
  ├── Improvements (proposed system changes — trust ladder)
  │
  └── Settings (global API keys, notifications, account)
```

**Dynamic Floor UI:** The Review Tab is assembled per floor from a component library. A shirt company floor gets an image gallery for design approvals. A service business floor gets different components. The Floor Manager selects which components the floor needs during setup. Components include: image picker, brand selector, A/B comparator, product mockup viewer, content approval queue, video review player, pricing table editor.

### Component 5: Improvement Engine

The system that makes EVE smarter over time.

**Three types of improvement:**

**Knowledge accumulation (automatic, low risk):**
- Stores winning strategies in the playbook library
- Records performance benchmarks that improve over time
- Tracks your approval patterns and preferences

**Strategy improvement (proposed, medium risk):**
- Notices cross-floor patterns and proposes applying them
- Suggests content strategy adjustments based on performance data
- Recommends budget reallocations based on ROAS data

**System improvement (proposed, requires approval):**
- Proposes prompt changes for underperforming agents
- Suggests workflow optimizations
- Recommends agent configuration changes

**Safety guardrails:**
- No improvement can remove approval gates
- No improvement can increase spending limits
- No improvement can change security tiers
- No improvement can modify the trust ladder rules
- All improvements are logged with before/after states
- Every improvement is reversible with one tap
- At Level 1-2, ALL improvements require your approval
- At Level 3-4, only system improvements require approval

---

# SECTION 3: AGENT ROSTER (13 Agents)

## Core Agents (Every floor gets all 8)

### 1. Floor Manager
**Model:** Opus | **Skills:** `biz-pm`, `biz-clevel`, `mkt-launch`

Project Commander. Owns the plan, timeline, quality, and delivery. Breaks the goal into phases with milestones and dependencies. Tracks every agent's status. Unblocks agents proactively. Reviews deliverables against acceptance criteria. Coordinates handoffs. Adapts when plans change. Single point of contact for the human owner. Routes approvals upward. Manages help requests and sub-agent oversight.

Does NOT do the work itself. Does NOT tell agents how to do their work.

Terminal access: None.

### 2. Brand Agent
**Model:** Opus | **Skills:** `design-creative-dir`, `mkt-brand`, `write-brand-voice`

Brand Guardian + Creative Director. Creates brand identity (name, mission, tagline, logo direction, visual language). Defines voice and tone guidelines. Sets visual direction. Defines target customer profile. Creates brand section of Foundation Package. Reviews ALL agent outputs for brand consistency. Approves or rejects creative output.

As Creative Director for content: sets visual and creative standard for all content, defines creative frameworks (color grading, typography, transitions, thumbnails), reviews every piece before publishing, studies top-performing content in the niche.

Terminal access: Tier 1 only.

### 3. Strategy Agent
**Model:** Opus | **Skills:** `mkt-positioning`, `mkt-competitors`, `biz-growth`

Business Architect. Defines business model and revenue targets. Maps product categories and positioning. Creates pricing framework. Analyzes competitors. Defines KPIs. Creates strategy section of Foundation Package.

Phase active: Foundation Sprint primarily. Consulted during pivots.

Terminal access: Tier 1 only.

### 4. Finance Agent
**Model:** Opus | **Skills:** `infra-xlsx`, `biz-growth`

CFO. Builds budget and revenue models. Tracks all costs. Maintains budget vs. actual. Models revenue projections. Calculates break-even. Tracks margins. Monitors ROAS. Flags overspending. Recommends reallocations. Produces P&L summaries. Reviews any agent action that costs money. Cross-checks financial claims from other agents.

Terminal access: Tier 1 only.

### 5. Copy Agent
**Model:** Sonnet | **Skills:** `mkt-copy`, `write-humanizer`, `mkt-seo`

Writer + Support Content. All website copy (homepage, product descriptions, about, FAQ, policies, CTAs). All email copy (templates, sequences, automation). All ad copy. All social captions, hooks, hashtags, text overlays. Video scripts. Carousel text. Support content (knowledge base, chatbot flows, response templates, escalation procedures). Privacy policy, terms of service. SEO content optimization. Adapts voice per platform.

Can spawn sub-agents (Haiku) for bulk product descriptions or batch caption writing.

Terminal access: Tier 1 only.

### 6. Web Agent
**Model:** Sonnet | **Skills:** `design-frontend`, `mkt-landing`, `vfx-motion`

Developer + Technical Infrastructure. Implements website from Design Agent's wireframes. Full Next.js + Tailwind + TypeScript development. Mobile-first responsive design. Stripe integration. Analytics integration. Email capture + automation infrastructure. Cookie consent. Technical SEO. Performance optimization. Accessibility. Dev server, preview system, Vercel deployment. Bug fixes.

Terminal access: Tier 1 for development. Tier 2 for env variables, database ops. Tier 3 for deployment.

### 7. Analytics Agent
**Model:** Haiku | **Skills:** `infra-xlsx`

Data & Performance Tracking. Sets up GA4, Meta Pixel, conversion tracking, UTM system. Tracks per-post and per-campaign performance. Tracks customer journey. Identifies top-performing content. Calculates content ROI. Produces daily/weekly reports. Feeds data back to Social Media Agent and Ads Agent.

Terminal access: Tier 1 only.

### 8. Launch Agent
**Model:** Sonnet | **Skills:** `mkt-launch`

QA Inspector + Go-Live Manager. Independent verification of all deliverables. Full launch checklist (security, privacy, functionality, performance). Manages go-live sequence. Post-launch verification. Produces launch summary.

Terminal access: Tier 2 for testing. Tier 3 for deployment actions.

---

## Specialist Agents (Added based on goal type)

### 9. Design Agent
**Model:** Opus | **Skills:** `design-frontend`, `design-image-gen`, `design-ui-ux`

Visual Designer + Image Generator. Wireframes and mockups. Complete visual system design. Generates all images directly (product mockups, lifestyle, branded graphics, hero images, social visuals, carousel graphics, thumbnails). Selects model per image type (Nano Banana Pro, Flux 2 Max, GPT Image 1.5). Creates 3 variations per visual. Designs email and ad creative layouts. Designs floor-specific UI components.

Can spawn sub-agents (Haiku) for batch image generation from approved briefs.

Terminal access: Tier 1 for files. Tier 2 for image generation APIs.

### 10. Video Agent
**Model:** Opus | **Skills:** `video-cinema`, `edit-postprod`, `edit-toolkit`

Video Director + Producer + Editor. Full pipeline: creative brief → key frame generation (Path A) or direct generation (Path B) → post-production (color grading, audio, captions, pacing, platform formatting, thumbnails) → delivery.

Selects video model per content type: Veo 3.1 (cinematic), Runway Gen-4.5 (product demos), Seedance 2.0 (multi-scene), Kling 3.0 (social volume), Pika 2.5 (drafts).

Handles voiceover (ElevenLabs), music selection, caption styling, hook optimization.

Can spawn sub-agents (Haiku) for batch video production from approved briefs.

Terminal access: Tier 2 (API calls to video/audio services).

### 11. Commerce Agent
**Model:** Sonnet | **Skills:** `mkt-pricing`, `biz-product`

Product Manager + Pricing Strategist. Builds and maintains product catalog. Researches sourcing (print-on-demand, dropship, wholesale). Evaluates suppliers. Manages product data flow. Sets prices using Foundation Package strategy. Calculates margins. Monitors competitor pricing. Recommends pricing adjustments. Sets shipping thresholds and bundle discounts. Integrates with fulfillment APIs. Flags where human action is needed.

Terminal access: Tier 1 for files. Tier 2 for fulfillment API integrations.

### 12. Social Media Agent
**Model:** Sonnet | **Skills:** `mkt-social`, `social-instagram`, `social-tiktok`

Content Strategist + Publisher + Community Manager + Trend Monitor. Builds content calendar. Monitors trends (audio, formats, hooks, challenges). Manages publishing queue and auto-posting via platform APIs. Monitors all comments and DMs 24/7. Responds in brand voice within 30 minutes. Drives engagement. Handles purchase-intent conversations. Escalates complaints. Follows up on warm leads. Filters spam. Coordinates organic ↔ paid alignment with Ads Agent.

Can spawn sub-agents (Haiku) for burst community engagement during critical post windows.

Terminal access: Tier 2 (API access to social platforms).

### 13. Ads Agent
**Model:** Sonnet | **Skills:** `mkt-ads`, `mkt-funnel`

Paid Acquisition Manager. Designs campaign architecture. Defines audiences (target, lookalike, retargeting). Pairs creative with copy into ad units. Manages Meta, TikTok, Google campaigns. Daily optimization loop (analyze → adjust → scale winners → pause losers → refresh creative). Budget management within approved limits. Detects ad fatigue and requests new creative. Follows 20%/week scaling rule.

Can do automatically: rebalance within campaigns, gradual scale, pause losers, create variations from approved creative. Needs your approval: increase total spend cap, new campaigns, new platforms, budget increase.

Terminal access: Tier 2 (API calls to ad platforms).

---

## Sub-Agent System

Any of the 13 agents can spawn temporary sub-agents for bounded, high-volume tasks.

**Rules:**
1. Sub-agents always run at Haiku tier
2. One level deep only — sub-agents cannot spawn their own sub-agents
3. Maximum 3 sub-agents per parent agent at once
4. Maximum 10 API turns per sub-agent task
5. Parent agent reviews all sub-agent output before it goes anywhere
6. Sub-agents inherit parent's brand context (compressed) and terminal access tier (never higher)
7. Sub-agents are terminated after task completion — no persistent state
8. Floor Manager can see all active sub-agents and their costs
9. Floor Manager can kill any sub-agent at any time

**When to spawn:** Batch content production, bulk product descriptions, parallel video rendering, burst community engagement, large-scale data processing.

**When NOT to spawn:** Strategy, planning, quality review, financial decisions, anything requiring full context awareness.

---

## Agent Count by Goal Type

| Goal Type | Core | Specialists | Total |
|---|---|---|---|
| Ecommerce store | 8 | Design, Video, Commerce, Social Media, Ads | 13 |
| Service business | 8 | Design, Social Media, Ads | 11 |
| Content/media brand | 8 | Design, Video, Social Media | 11 |
| TikTok-first brand | 8 | Design, Video, Social Media, Ads | 12 |
| SaaS / digital product | 8 | Design, Commerce, Social Media, Ads | 12 |
| Personal brand | 8 | Design, Social Media | 10 |

Optional addition: VFX Agent (Sonnet, `vfx-threejs`, `vfx-gsap`, `vfx-r3f`) for floors needing 3D, AR, or advanced animations. Max 14 agents.

---

## Model Tier Summary

| Tier | Model | Agents | Purpose |
|---|---|---|---|
| Opus | Claude Opus 4.6 | Floor Manager, Brand Agent, Strategy Agent, Finance Agent, Design Agent, Video Agent | Strategy, creative direction, complex decisions, quality gates |
| Sonnet | Claude Sonnet 4.6 | Copy Agent, Web Agent, Commerce Agent, Social Media Agent, Ads Agent, Launch Agent | Writing, coding, campaign management, execution |
| Haiku | Claude Haiku 4.5 | Analytics Agent, all sub-agents | Data processing, mechanical tasks, batch execution |

Floor Manager can request model upgrades/downgrades through CEO Mode based on agent performance.

---

# SECTION 4: OPERATIONS

## Floor Creation Workflow

```
YOU: "I want to build [business idea]"
  │
  ▼
CEO MODE:
  1. UNDERSTAND — asks clarifying questions
  2. EVALUATE — runs 7-question business model framework
  3. PLAN — creates floor configuration (name, goal, type, budget, platforms, timeline)
  4. SELECT AGENTS — based on goal type (10-13 agents)
  5. ASSIGN MODELS — per tier defaults
  6. ASSIGN SKILLS — per agent from Skill Registry
  7. ESTIMATE COST — upfront build cost + monthly running cost + worst case
  8. PRESENT — floor plan with full breakdown for your approval
  │
  ▼
YOU approve → Floor initialized:
  ├── Database: floor + agent records created
  ├── Workspace: __PATH_EVE_PROJ__{floor-name}/ created
  ├── Orchestrator: agents registered in worker pool
  ├── Dashboard: floor card appears
  ├── Foundation Sprint begins immediately
  └── Floor Manager sends first message to you
```

## The 10-Phase Delivery Pipeline

| Phase | What's Delivered | How You Review |
|---|---|---|
| 1. Foundation | Brand, strategy, business model | Foundation Package in dashboard |
| 2. Design | Wireframes, mockups, visual direction | Clickable prototype in Review tab |
| 3. Alpha | Working site with placeholder content | Preview URL |
| 4. Content | Site with real copy, products, images, video | Preview URL |
| 5. Integration | Stripe, analytics, email, forms | Preview URL with test checkout |
| 6. Staging | Full site on a real URL (not public) | Vercel preview URL |
| 7. Ad Review | Campaign structures, creative, targeting | Ad previews in dashboard |
| 8. Go-Live | Production deployment | Production URL |
| 9. Ad Activation | Each campaign individually | Per-campaign in dashboard |
| 10. Monitoring | Performance data | Reports in dashboard |

## Three Approval Gates

| Gate | Phase | What You Approve | What Happens If You Don't |
|---|---|---|---|
| 1. Foundation | Phase 1 | Brand, strategy, business model | Nothing gets built |
| 2. Final Launch | Phase 8 | Complete site, staging URL | Nothing goes public |
| 3. Ad Activation | Phase 9 | Each ad campaign | No money gets spent |

Everything between gates is autonomous. Agents build, Floor Manager coordinates. You check in when you want.

## Parallel Execution Rules

1. All agents start simultaneously after Foundation Package approval
2. Agents work autonomously — no check-ins between tasks
3. Only pause for hard dependencies (and work on everything else they can)
4. Outputs pushed to shared workspace — any agent picks up what it needs
5. Floor Manager monitors, doesn't micromanage
6. Direct agent-to-agent collaboration for simple handoffs
7. Sub-agents spawned for volume work, terminated after delivery

## The Shared Workspace

```
__PATH_EVE_PROJ__{floor-name}/
  brand/          ← Foundation Package, brand guidelines, logos
  copy/           ← All written content by page/purpose
  design/         ← Wireframes, mockups, visual assets
  product/        ← Product catalog, images, pricing
  video/          ← Raw footage, edited videos by platform
  ads/            ← Campaign structures, creative pairings
  website/        ← The actual Next.js codebase
  analytics/      ← Tracking configs, dashboard setups
  content-queue/  ← Ready-to-post content with metadata
```

## Help Request System

When an agent needs help beyond normal collaboration:

1. Ask a sibling agent directly — no permission needed
2. Structured request to Floor Manager (type, description, what's blocked, suggested solution)
3. Escalation chain: Agent → Floor Manager → CEO Mode → You

Agents cannot create agents or assign skills. Only CEO Mode creates agents.

## Error Handling

**API failures:** 3 retries with exponential backoff → switch provider → Floor Manager notified → escalate to you if unresolved

**Deployment failures:** 2 retries → Web Agent diagnoses → fixes and redeploys → persistent failure → you're notified with details

**Bad agent output:** Brand Agent or Floor Manager rejects with feedback → agent revises → 3 failed rounds → CEO Mode escalates (model upgrade, task reassign, or your input)

**Service outages:** Agents pause affected work, continue other tasks, resume when service recovers. No data loss.

**Agent runaway:** Detected after 50 turns or 3 repeated actions → paused → Floor Manager investigates

**Budget overrun:** Hard stop at ceiling. Alerts at 50%, 75%, 90%. All agents pause if floor exceeds 150% of daily budget.

---

# SECTION 5: CONTENT & VIDEO PIPELINES

## Content Pipeline

```
Trend Monitor (Social Media Agent) → Content Strategist (Social Media Agent)
→ Creative Director (Brand Agent) → Production (Design Agent + Video Agent + Copy Agent)
→ Post-Production (Video Agent) → Publishing (Social Media Agent)
→ Engagement (Social Media Agent) → Performance Tracking (Analytics Agent)
→ feeds back to Strategy
```

This is a continuous loop. After launch, it runs indefinitely.

## Weekly Content Cycle

**Planning:** Trend data + performance data → Content Strategist creates this week's calendar with briefs

**Production:** For each piece — Creative Director writes brief → parallel production (Copy, Design, Video) → post-production → Creative Director review → approved → publishing queue

**Publishing:** Auto-post at optimal times via platform API → Social Media Agent monitors engagement

**Tracking:** Per-post metrics (views, engagement, saves, shares, clicks, conversions) → weekly rollup → feeds back to planning

## Video Workflow

**Path A (Image-First, quality):** Brief → key frame generation (3 variations) → review → image-to-video generation (2-3 takes) → select best → post-production (color, audio, captions, pacing, format, thumbnail) → Creative Director review → publish

**Path B (Text-to-Video, speed):** Brief → direct generation (3-5 variations) → select best → light edit → Creative Director check → publish

**Video model selection (automatic per content type):**
- Cinematic/hero: Veo 3.1
- Product demo: Runway Gen-4.5
- Multi-scene: Seedance 2.0
- Social volume: Kling 3.0
- Drafts: Pika 2.5

**Audio:** Voiceover via ElevenLabs, music from royalty-free library or AI-generated, trending audio for trend content

**Quality checklist (every video):** Hook in 1 second, brand-consistent, audio clean, captions styled, correct format, CTA present, thumbnail works at small size, loops well, looks good on phone

---

# SECTION 6: POST-LAUNCH OPERATIONS

## Ad Management Loop (Daily)

1. **Collect** — Analytics Agent pulls performance data per campaign, ad set, ad
2. **Analyze** — Ads Agent evaluates ROAS, CTR, CPA, conversion rates, fatigue signals
3. **Optimize** — Scale winners (20%/day max), pause losers (below 1.0x for 3+ days), refresh fatigued creative, shift budget to highest-performing platform
4. **Report** — Finance Agent logs spend, Floor Manager gets daily summary
5. **Escalate** — Flags when: spend exceeds cap, ROAS drops below target for 3+ days, creative needs refresh, competitor activity detected

## Customer Journey

Purchase → order confirmation → fulfillment → delivery confirmation → check-in (3 days) → review request (7 days) → cross-sell (14 days) → nurture (ongoing) → win-back (60+ days inactive)

All email sequences managed by Copy Agent (content) + Web Agent (infrastructure).

## Scaling Rules

**Phase 1 (Vertical):** 20%/week ad budget increases while ROAS holds. Expand audiences, add placements, increase content volume. Pause if ROAS drops 15%+.

**Phase 2 (Horizontal, after 30+ days stable):** New ad platforms, new product lines, new content formats, new audience segments, influencer partnerships.

**Phase 3 (Infrastructure):** Upgrade hosting, expand support, optimize email deliverability, consider dedicated fulfillment.

## Multi-Floor Coordination

**CEO Mode shares across floors:** Ad strategies, content formats, email sequences, pricing strategies, technical optimizations. Adapted to each floor's brand.

**Never shared:** Brand identity, product catalog, customer data, brand voice.

**Cross-floor agent assist:** If one floor's agent is idle while another's is overloaded, CEO Mode can temporarily assign the idle agent to help.

**Playbook library:** Proven strategies extracted from successful floors, applied to new floors so they don't start from zero.

---

# SECTION 7: SECURITY

## Terminal Access (3 Tiers)

**Tier 1 — Auto-Allowed:** Package management, dev servers, code quality tools, file ops within project, git, read-only info.

**Tier 2 — Floor Manager Approval:** Global installs, network requests sending data, env variables, Docker, database ops, cross-floor file access, non-standard ports.

**Tier 3 — Human Owner Approval:** Deployment, financial operations, domain/DNS, credential creation, system-level changes, destructive operations, external accounts.

**Permanently Forbidden:** `rm -rf /`, `sudo` (unless whitelisted), reading credentials outside project, crypto mining, opening inbound ports, reverse shells, executing unknown scripts, `eval()` on untrusted input.

All commands logged: timestamp, floor, agent, command, tier, approval, output, exit code.

## Data Protection

**Customer data:** Agents never see PII. Work with aggregates and anonymized segments only. Customer data lives in database and Stripe, not flat files. Stripe handles all payment processing — EVE never touches card numbers.

**Business secrets:** Cross-floor isolation enforced. Floor A's agents cannot access Floor B's data. Playbook library contains abstracted strategies, not raw data. Agent system prompts never exposed externally.

**API keys:** Stored encrypted. Never in source code, git, agent prompts, or logs. Agents call wrapper functions, not raw APIs. Rotation reminders every 90 days.

## Privacy Compliance (CCPA)

Per floor: privacy policy, terms of service, cookie consent banner, unsubscribe flow, data deletion process. All generated during build by Copy Agent + Web Agent. Launch Agent verifies before go-live.

## AI Safety

**Action verification:** Every real-world action goes through tier check.
**Hallucination prevention:** Agents query data, don't guess. Financial claims cross-checked. Destructive actions require stated reasoning.
**Scope enforcement:** Agents can only act within their role. PromptBuilder enforces this.
**Content safety:** Brand Agent reviews all public content. No offensive, discriminatory, or misleading output.

**Incident response:** Contain → Assess → Notify → Remediate → Prevent → Log.

---

# SECTION 8: TECHNOLOGY STACK

| Component | Technology |
|---|---|
| Runtime | Node.js + TypeScript |
| Agent execution | OpenClaw |
| Orchestration | Custom (EVE Orchestrator) |
| LLM provider | Anthropic (Opus, Sonnet, Haiku) |
| Framework | Next.js |
| Styling | Tailwind CSS |
| Database | PostgreSQL via Supabase |
| Payments | Stripe |
| Hosting (dashboard + floors) | Vercel |
| Mobile interface | PWA (native iOS later) |
| Image generation | Nano Banana Pro, Flux 2 Max, GPT Image 1.5 |
| Video generation | Veo 3.1, Runway Gen-4.5, Seedance 2.0, Kling 3.0, Pika 2.5 |
| Voice generation | ElevenLabs |
| Email (transactional) | Resend |
| Email (marketing) | ConvertKit |
| Social posting | Meta Graph API, TikTok API |
| Ad platforms | Meta Ads, TikTok Ads, Google Ads |
| EVE host | Mac Mini (dedicated, always on) |

---

# SECTION 9: DATABASE SCHEMA

```sql
-- Core
floors (id, name, goal, type, status, config, budget, trust_level, created_at, updated_at)
agents (id, floor_id, role, model_tier, skills[], status, current_task_id, created_at)
sub_agents (id, parent_agent_id, floor_id, task, model_tier, turns_used, max_turns, status, created_at, terminated_at)

-- Task management
tasks (id, floor_id, agent_id, description, status, priority, depends_on[], created_at, started_at, completed_at)
task_outputs (id, task_id, agent_id, output_type, file_path, metadata, created_at)

-- Conversations
agent_conversations (id, agent_id, floor_id, messages_json, token_count, updated_at)

-- Build tracking
phases (id, floor_id, phase_number, name, status, started_at, completed_at)
approvals (id, floor_id, gate_number, status, requested_at, approved_at, notes)
revisions (id, floor_id, description, agents_involved[], status, previous_version, new_version, cost, created_at)
command_logs (id, floor_id, agent_id, command, tier, approved_by, output, exit_code, timestamp)

-- Cost tracking
cost_events (id, floor_id, agent_id, sub_agent_id, event_type, model, input_tokens, output_tokens, cost_usd, timestamp)
budget_alerts (id, floor_id, threshold_pct, triggered_at, acknowledged)
daily_cost_summary (id, floor_id, date, total_cost, api_cost, image_gen_cost, video_gen_cost, hosting_cost)

-- Content & publishing
content_queue (id, floor_id, platform, media_url, caption, hashtags, scheduled_at, status, posted_at, post_id)
content_performance (id, content_id, views, likes, comments, shares, saves, clicks, conversions, revenue, tracked_at)

-- Financial
transactions (id, floor_id, type, amount, description, category, timestamp)
revenue_events (id, floor_id, order_id, amount, source, attributed_content_id, attributed_campaign_id, timestamp)

-- Improvement engine
improvement_proposals (id, scope, type, description, current_state, proposed_state, evidence, status, proposed_at, reviewed_at, applied_at, rolled_back_at)
trust_ladder (id, floor_id, current_level, promoted_at, demoted_at, history_json)
playbook_entries (id, category, title, strategy, source_floor_id, performance_data, created_at, times_applied)
preference_patterns (id, pattern_type, description, confidence, evidence_count, last_updated)

-- Floor UI
floor_ui_components (id, floor_id, component_type, position, config_json, created_at)
```

---

# SECTION 10: IMPLEMENTATION ROADMAP

## Decided Parameters

- **Agent roster:** 13 agents (3-4 real OpenClaw agents + 9-10 virtual agents via direct Anthropic API) with sub-agent spawning
- **Mobile interface:** PWA first, native iOS later
- **Hosting:** Mac Mini dedicated, always on
- **Test budget:** $200 ceiling with hard stop + alerts at 50/75/90%
- **Test floor:** To be decided at Phase 2

## Build Phases

### Phase 0: Architecture Lock (Week 1)
- Finalize system architecture diagram
- Implement database schema (Prisma migrations)
- Set up project structure and dev environment on Mac Mini
- Configure OpenClaw base installation
- Set up Supabase database
- Create mobile-first UI wireframes
- Confirm all API accounts and keys

**Done when:** Database is live, OpenClaw is installed, project structure exists, wireframes approved.

### Phase 1: PromptBuilder (Week 2)
- Build PromptBuilder core (role + brand + skills + task + rules → system prompt)
- Create OpenClaw workspace templates for 3 real agents (Floor Manager, Web Agent, Launch Agent)
- Create PromptBuilder templates for all 13 agent roles (real + virtual)
- Build skill loader (reads SKILL.md, extracts knowledge, compresses to token budget)
- Build context manager (token counting, priority-based inclusion)
- Build brand context injector (extracts relevant Foundation Package sections per agent type)
- Test: input role + brand + skills + task → output well-structured prompt under 8,000 tokens

**Done when:** PromptBuilder produces quality system prompts with accurate token counting.

### Phase 2: Orchestrator + First Agent Run (Week 3-4)
- Build task queue with priority and dependency tracking
- Build worker pool with configurable concurrency limits
- Build agent lifecycle manager (status transitions, conversation history)
- Build OpenClaw integration layer (Orchestrator commands → OpenClaw sessions)
- Build cost tracker (per-agent, per-turn, real-time)
- Build budget enforcement (hard stops, alerts)
- Build sub-agent spawning system
- Run first test: 3-agent Foundation Sprint with a real goal

**Done when:** 3 agents complete a Foundation Sprint, costs tracked accurately, errors handled.

### Phase 3: CEO Mode + Floor Creation (Week 5-6)
- Build CEO Mode system prompt (business intelligence, 7-question framework, agent selection)
- Build floor creation workflow (questions → evaluation → config → agent selection → presentation)
- Build agent factory (creates all floor agents, initializes conversations)
- Build workspace initializer (directory structure, Foundation Package template)
- Build upfront cost estimator (API + build + monthly running cost + worst case)
- Auto-trigger Foundation Sprint on approval

**Done when:** Describe an idea → CEO Mode plans it → you approve → Foundation Sprint starts automatically.

### Phase 4: Dashboard PWA (Week 7-9)
- Build PWA shell (installable, push notifications, offline caching)
- Build HQ view (revenue, floor cards, approvals, CEO Mode chat)
- Build Floor view (Overview, Build, Review, Settings tabs)
- Build notification system (red/yellow/green, push for red+yellow)
- Build approval flow (swipe/tap approve/reject)
- Build Floor Manager chat (text + voice input)
- Build dynamic Review tab with component library
- Build Settings (global + per-floor)
- Build Improvements section (proposed changes, approve/reject)

**Done when:** Create a floor, approve foundation, monitor build, chat with FM — all from your phone.

### Phase 5: Full Floor Execution (Week 10-12)
- Register 3 real agents with OpenClaw + configure 10 virtual agents in Orchestrator
- Build content pipeline (strategy → production → post-production → publishing)
- Build video pipeline (Path A + Path B with real API calls)
- Build website pipeline (design → code → preview → staging → production)
- Build integration pipeline (Stripe, analytics, email, social connections)
- Build ad pipeline (campaign creation, creative pairing, audience targeting)
- Build launch checklist and automated QA
- Run complete floor: idea → Foundation → Build → Launch

**Done when:** A complete business is built and deployed through the full 10-phase pipeline.

### Phase 6: Improvement Engine (Week 13-15)
- Build performance tracker (approval rate, revision count, time, cost per agent)
- Build prompt improvement proposals (analyze underperformers, propose changes)
- Build strategy learning (cross-floor pattern extraction → playbook library)
- Build preference learning (track approval patterns, adjust defaults)
- Build trust ladder UI and controls
- Build improvement review flow (see proposals, approve/reject from phone)
- Build rollback system (one-tap revert any improvement)
- Build safety guardrails (immutable rules that improvements can't touch)

**Done when:** EVE proposes real improvements, you review from phone, approved changes apply and track, playbook grows.

---

# SECTION 11: WHAT'S NOT IN V1

These are features that matter but are deferred to avoid scope creep:

- **Native iOS app** — PWA first, native later
- **Multi-user access** — v1 is single owner only
- **Google Ads integration** — Meta and TikTok first
- **Influencer management** — manual for now
- **International/multi-language** — English only in v1
- **App Store submission** — web apps only in v1
- **White-label / selling EVE** — personal use first
- **Voice interface** — text/swipe is primary, voice input for chat only

---

# SECTION 12: SKILL REGISTRY

(Unchanged from original — full registry with skill IDs, descriptions, agent assignments, and sources. See original SKILL-REGISTRY.md for complete listing.)

Key rules:
- Max 3 skills per agent
- Max 10 skills per Floor Manager
- CEO Mode reads registry and assigns — never loads skills itself
- Escalation: Agent → Floor Manager → CEO Mode → Registry → You if skill doesn't exist
