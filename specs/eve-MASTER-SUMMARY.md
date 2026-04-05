# EVE — Master Summary & Document Index
## Version 1.0 — March 27, 2026

---

# WHAT EVE IS

EVE is an autonomous system that builds and runs businesses. You describe an idea. EVE evaluates it, assembles a team of AI agents, builds everything (brand, website, products, content, ads), launches the business, then continuously operates and improves it. Your daily involvement after launch: 10-15 minutes from your phone.

**Three systems in one:**
- **CEO Mode** — evaluates ideas, oversees all floors, shares intelligence across businesses
- **Autonomous Floors** — each floor is a complete business with its own team of 13 AI agents
- **Self-Improvement Engine** — learns from every decision, gets smarter over time, within safety guardrails

---

# THE 13-AGENT ROSTER

| Agent | Model | Role |
|---|---|---|
| Floor Manager | Opus | Project Commander — coordinates all other agents |
| Brand Agent | Opus/Sonnet* | Brand Guardian — creates and enforces brand identity |
| Strategy Agent | Opus/Sonnet* | Business Architect — plans and adjusts strategy |
| Finance Agent | Opus/Sonnet* | CFO — budgets, margins, financial tracking |
| Copy Agent | Sonnet | Writer — all text content across all channels |
| Web Agent | Sonnet | Developer — builds and maintains the website |
| Analytics Agent | Haiku | Data tracker — monitors all performance metrics |
| Launch Agent | Sonnet | QA Inspector — verifies everything before go-live |
| Design Agent | Opus/Sonnet* | Visual Designer — images, graphics, mockups |
| Video Agent | Opus/Sonnet* | Video Producer — all video content |
| Commerce Agent | Sonnet | Product Manager — catalog, pricing, fulfillment |
| Social Media Agent | Sonnet | Content Strategist + Publisher + Community Manager |
| Ads Agent | Sonnet | Paid Acquisition Manager — campaigns + optimization |

*Opus for foundation/escalation tasks, Sonnet for routine operations (configurable via Model Router)

Optional: VFX Agent (Sonnet) for 3D/AR. Max 14 agents per floor.

---

# THE JOURNEY (11 Phases)

| Phase | What Happens | Your Involvement | Time |
|---|---|---|---|
| 0 | Describe your idea to CEO Mode | 2-3 messages | 5-15 min |
| 1 | CEO Mode evaluates + presents floor plan | Review + approve | 5 min |
| 2 | Floor initialized, agents registered | None (automated) | 30 sec |
| 3 | Foundation Sprint (brand, strategy, budget) | Pick brand direction (Gate 1) | 2-4 hours |
| 4 | Parallel buildout (all agents working) | Check in, approve designs | 5-7 days |
| 5 | Staging + QA verification | Review preview site (Gate 2) | 1-2 days |
| 6 | Ad campaign activation | Approve each campaign (Gate 3) | 30 min |
| 7 | First 72 hours post-launch | Read reports | Passive |
| 8 | Ongoing operations | 10-15 min/day from phone | Daily |
| 9 | Scaling | Approve budget increases | As needed |
| 10 | Multi-floor operations | Weekly review | Weekly |
| 11 | Continuous improvement | Review weekly proposals | 5 min/week |

---

# TECH STACK

| Layer | Technology |
|---|---|
| Orchestration | Custom TypeScript (Fastify + BullMQ + Redis) |
| Agent Execution | OpenClaw |
| Deterministic Pipelines | Lobster |
| LLM | Anthropic (Opus / Sonnet / Haiku) |
| Website Framework | Next.js 16 (App Router, TypeScript, Tailwind) |
| Database | Supabase (PostgreSQL + Realtime) |
| Payments | Stripe (Checkout + Webhooks) |
| Hosting | Vercel |
| Email (transactional) | Resend |
| Email (marketing) | Kit (ConvertKit) |
| Social APIs | Meta Graph API + TikTok Content Posting API |
| Ads APIs | Meta Marketing API v25.0 + TikTok Marketing API |
| Print on Demand | Printful (primary) |
| Image Generation | fal.ai (gateway) → Flux 2 Max, Nano Banana 2, Recraft V4, Ideogram 3.0 |
| Text-in-Image | OpenAI API → GPT Image 1.5 |
| Video Generation | fal.ai (gateway) → Kling 3.0, Runway Gen-4.5, Seedance 2.0 |
| Voice | ElevenLabs |
| Dashboard | PWA (Next.js, mobile-first) |
| EVE Host | Mac Mini (dedicated) |

---

# KEY ARCHITECTURAL DECISIONS

**1. Orchestrator is the most critical component.** Custom TypeScript service that manages ALL coordination — task queues, dependencies, agent dispatch, budget enforcement, notifications. It also calls the Anthropic API directly for 9-10 "virtual" agents that don't need shell access.

**2. Hybrid real/virtual agent model.** Only 3-4 agents per floor are registered with OpenClaw (Floor Manager, Web Agent, Launch Agent — the ones that need shell access, heartbeats, or persistent memory). The other 9-10 agents are "virtual" — the Orchestrator calls the Anthropic API directly with PromptBuilder-constructed prompts. Same quality, much simpler infrastructure.

**3. Orchestrator drives, Floor Manager advises.** The Orchestrator manages task dispatch deterministically (dependency graph, priority queue, concurrency limits). The Floor Manager focuses on what LLMs do best — understanding context, communicating with you, making judgment calls. FM doesn't dispatch work; it reports on and advises about work the Orchestrator manages.

**4. File-based agent coordination.** Agents communicate through shared workspace files, not real-time messaging. Orchestrator writes inputs → agent produces outputs → Orchestrator detects and dispatches next task.

**5. Only Floor Manager gets a heartbeat.** All other agents dispatched on-demand to control costs. Virtual agents are completely stateless — fresh API call every time.

**6. Configurable model tiers.** The Model Router assigns Opus/Sonnet/Haiku per agent per task category. Foundation Sprint gets Opus. Routine operations get Sonnet. Analytics gets Haiku. Configurable via Settings.

**7. Four techniques maximize agent output quality.** (a) XML-structured prompts — Claude parses XML 23% more accurately than Markdown, cutting hallucination by ~40%. (b) Voice Sample — 500-word brand voice reference generated during Foundation Sprint, loaded into every content agent call, eliminates tone drift. (c) Gold Standard Examples — approved outputs accumulate and load as few-shot examples, pushing first-try approval from ~55% to ~85% over 3 months. (d) Generated Knowledge — analysis agents generate facts before reasoning, preventing hallucination in strategy/finance/ads tasks.

**8. Three approval gates.** Gate 1: Foundation Package (includes Voice Sample). Gate 2: Launch (preview site). Gate 3: Ad campaigns. Each requires your explicit approval. Never bypassed, even at Trust Level 4.

**9. Bounded self-improvement.** The system learns and proposes improvements but never self-promotes on the Trust Ladder, never modifies its own safety rules, and never increases budgets without your approval. 10 immutable safety rules that can never be changed.

**10. Git-versioned everything.** Every floor's workspace is a Git repo. Prompts, brand docs, agent configs — all version-controlled. Any change can be reverted.

**11. Dashboard API inside the Orchestrator.** Fastify server runs in the same Node.js process. Dashboard PWA connects directly on localhost. Remote access via Tailscale when needed.

---

# TRUST LADDER

| Level | Name | What's Automatic | What Needs You |
|---|---|---|---|
| 1 | Training Wheels | Technical ops only | Everything else |
| 2 | Supervised | Routine content + ads optimization | Budget, launches, improvements |
| 3 | Autonomous w/ Guardrails | All content + strategy adjustments | Budget, system changes, new platforms |
| 4 | Full Autonomy | Everything except money decisions | New floors, budget ceiling, strategic pivots |

You control promotion. EVE never self-promotes. Kill switch always available.

---

# IMPLEMENTATION TIMELINE

| Phase | Weeks | Focus |
|---|---|---|
| 0 | 1-2 | Foundation — Mac Mini setup, Floor Manager working, Orchestrator skeleton |
| 1 | 3-4 | Three-agent foundation — FM + Brand + Copy coordinating via Orchestrator |
| 2 | 5-7 | Full roster expansion — add agents one at a time, first test floor |
| 3 | 8-10 | Complete floor build — full 10-phase pipeline, staging, launch |
| 4 | 11-13 | Dashboard PWA + go live with test floor |
| 5 | 14-16 | Improvement Engine — preference learning, playbook library |
| 6 | 17+ | Second floor + scaling — cross-floor intelligence, real businesses |

---

# DOCUMENT INDEX

## Tier 1: Start Here (Architecture & Overview)

| # | Document | What It Covers | Size |
|---|---|---|---|
| 1 | **eve-master-plan.md** | Assessment of original specs, 7 problems, 6 missing pieces, 6-phase roadmap | 20KB |
| 2 | **eve-unified-spec-v2.md** | Complete unified specification (replaces all 9 original spec files) — vision, architecture, agents, operations, pipelines, security, tech stack, database, roadmap | 43KB |
| 3 | **eve-strategic-review.md** | Stress-test against production evidence — 4 critical issues, 6 concerns, 10 things we got right, revised timeline | 17KB |

## Tier 2: Core Systems (How It Works)

| # | Document | What It Covers | Size |
|---|---|---|---|
| 4 | **eve-orchestrator-spec.md** | The central nervous system — task lifecycle, dependency graph, concurrency management, agent dispatch, floor creation, error recovery, API endpoints, model routing. **Build this first.** | 27KB |
| 5 | **eve-revised-agent-roster.md** | 13 agents with roles, model tiers, skills, sub-agent rules, per-goal-type configs | 22KB |
| 6 | **eve-workflow-architecture.md** | 5 workflow layers, 7 critical patterns, Lobster pipeline definitions | 26KB |
| 7 | **eve-promptbuilder-spec.md** | 7-section prompt template, token budgets, brand loading states, sub-agent compression | 27KB |
| 8 | **eve-openclaw-config.md** | File structure, SOUL.md, AGENTS.md, HEARTBEAT.md, dynamic agent registration, cost optimization | 20KB |

## Tier 3: Operational Workflows (What Agents Do)

| # | Document | What It Covers | Size |
|---|---|---|---|
| 9 | **eve-end-to-end-workflow.md** | 11 phases from idea to ongoing operations, FaithForge example throughout, error scenarios, 6 research-backed additions (Guardian Agent, GEO, etc.) | 34KB |
| 10 | **eve-website-build-workflow.md** | 8-stage Next.js build, AGENTS.md integration, component library, handoff chain, quality gates | 19KB |
| 11 | **eve-social-media-workflow.md** | 5-phase content lifecycle, Meta Graph API + TikTok API, engagement rules, trend monitoring, production volume + costs | 25KB |
| 12 | **eve-ads-workflow.md** | Campaign architecture → testing → optimization, Meta Marketing API v25.0 code, Conversions API, Winners Hub, scaling rules | 27KB |
| 13 | **eve-creative-workflows.md** | Multi-model routing for images (8 models) and video (8 models), production pipelines, quality standards | 22KB |
| 14 | **eve-sourcing-fulfillment.md** | POD provider comparison, Printful API integration, product design pipeline, pricing strategy, order fulfillment flow | 21KB |
| 15 | **eve-email-customer-journey.md** | 6 email sequences (welcome, abandoned cart, post-purchase, win-back, VIP, promotional), customer segmentation, CLV tracking | 14KB |

## Tier 4: Safety, Intelligence & Improvement

| # | Document | What It Covers | Size |
|---|---|---|---|
| 16 | **eve-self-improvement-engine.md** | 3 improvement types, 6-step weekly loop, preference learning, playbook library, A/B testing, Trust Ladder details, 10 immutable rules | 26KB |
| 17 | **eve-security-deep-spec.md** | 3-tier terminal access, customer data protection, GDPR/CCPA compliance, API key security, cross-floor isolation, audit trails | 15KB |
| 18 | **eve-business-intelligence.md** | CEO Mode's knowledge base — 7-question framework, pricing psychology, brand building, growth strategy, ecommerce intelligence | 10KB |

## Tier 5: User Interface & Infrastructure

| # | Document | What It Covers | Size |
|---|---|---|---|
| 19 | **eve-dashboard-ui.md** | Mobile-first PWA, 6 screens with wireframes, 10 dynamic components, notification system, design system, real-time updates | 35KB |
| 20 | **eve-supplementary-specs.md** | Consolidated database schema (18 tables), revision system, testing strategy, onboarding flow, monitoring & observability | 21KB |
| 21 | **eve-api-infrastructure.md** | Every external API (Anthropic, fal.ai, OpenAI, ElevenLabs, Stripe, Meta, TikTok, Printful), model routing code, cost tracking, rate limits, key management, network requirements | 27KB |

## Tier 6: Meta & Process

| # | Document | What It Covers | Size |
|---|---|---|---|
| 22 | **eve-audit.md** | Gap analysis — what's covered, what was missing (now fixed), contradictions (now resolved), consistency checks | 13KB |

**Total specification: ~510KB across 23 documents.**

---

# KEY DECISIONS LOG

Decisions made during planning that should not be revisited without good reason:

| Decision | Why | Document |
|---|---|---|
| 13 agents (not 23) | Original spec had too many agents. Consolidated into 13 with sub-agent spawning for overflow work. Fewer agents = less coordination complexity + lower cost. | agent-roster |
| OpenClaw for agent execution | Open-source, local-first, heartbeat system, community skills, MIT licensed. Runs on Mac Mini. | unified-spec |
| Lobster for deterministic pipelines | Code handles sequencing, LLMs handle creativity. Don't let LLMs decide workflow order. | workflow-architecture |
| Custom TypeScript Orchestrator | OpenClaw's inter-agent coordination is primitive. We need a custom layer for dependency graphs, concurrency, budget enforcement. This is the most important code. | orchestrator-spec |
| Next.js 16 for websites | Agent-friendly (AGENTS.md, bundled docs), SSR, edge deployment, Vercel-native. | website-build |
| Supabase for database | PostgreSQL + Realtime subscriptions + Auth + free tier. One service for multiple needs. | supplementary-specs |
| PWA first (not native app) | 40-60% cheaper than native. Installable on home screen. Push notifications work on Android (iOS requires install). Native app deferred. | dashboard-ui |
| Printful for POD (primary) | Best branding options (custom packaging, neck labels), reliable quality, strong API. Higher price offset by premium positioning. | sourcing-fulfillment |
| Resend + Kit for email | Resend for transactional (fast, reliable). Kit for marketing (automation flows, creator-friendly). Upgrade path to Klaviyo if scaling. | email-customer-journey |
| 3 approval gates (immutable) | Foundation, Launch, Ads. Never bypassed at any Trust Level. Your money, your reputation — always your call on the big decisions. | end-to-end-workflow |
| Bounded self-improvement | System proposes changes with evidence. You approve or reject. No autonomous self-modification beyond approved boundaries. 10 immutable safety rules. | self-improvement-engine |
| File-based coordination | Agents write to shared workspace files. Orchestrator detects output and dispatches next agent. Proven OpenClaw pattern. | orchestrator-spec |
| Only FM gets heartbeat | Other agents dispatched on-demand. Controls cost (~$50-80/month for FM heartbeat vs. $1,100+/month for all agents). | strategic-review |
| Hybrid real/virtual agents | Only 3-4 real OpenClaw agents (FM, Web, Launch) that need shell access. Other 9-10 are virtual — Orchestrator calls Anthropic API directly. Dramatically simpler OpenClaw config, lower overhead, full cost control. | orchestrator-spec |
| Orchestrator drives dispatch | Orchestrator handles task management deterministically. Floor Manager is advisory (reports status, communicates with you, makes judgment calls) but doesn't control the task queue. | orchestrator-spec |
| Dashboard API inside Orchestrator | Fastify server in same process. Start simple, add Tailscale for remote access later. Migrate to Vercel-hosted PWA + Tailscale API tunnel when ready. | orchestrator-spec |
| Direct Anthropic API (not OpenRouter) | OpenClaw handles it natively. OpenRouter adds 5.5% markup solving a problem we don't have (we only use Claude). No model-switching needed. | api-infrastructure |
| fal.ai for image + video generation | 50% market share, 985 endpoints, cheapest pricing, unified SDK. One integration instead of 8+ separate provider APIs. | api-infrastructure |
| GPT Image 1.5 for text-in-images | Only model that renders text accurately in images. Critical for POD shirt designs with scripture. Called via direct OpenAI API alongside fal.ai. | api-infrastructure |

---

# WHAT TO READ WHEN

**"I want to understand the whole system in 20 minutes"**
→ Read this document (you're here)

**"I want to start building"**
→ Read: orchestrator-spec → openclaw-config → promptbuilder-spec

**"I want to understand how a floor gets built"**
→ Read: end-to-end-workflow → website-build-workflow

**"I want to understand how content and ads work"**
→ Read: social-media-workflow → ads-workflow → creative-workflows

**"I want to understand safety and improvement"**
→ Read: security-deep-spec → self-improvement-engine

**"I want to understand what the user experience looks like"**
→ Read: dashboard-ui → end-to-end-workflow (the Review Tab sections)

**"I want the database schema"**
→ Read: supplementary-specs (Part 1)

**"I'm worried about costs"**
→ Read: strategic-review (Issues 2 + 5) → orchestrator-spec (Model Routing)

---

# KNOWN RISKS & MITIGATIONS

| Risk | Severity | Mitigation |
|---|---|---|
| Rate limits with multiple Opus agents | High | Only FM gets heartbeat. Model Router downgrades routine tasks to Sonnet. Exponential backoff. | 
| Agent coordination complexity at 13 agents | High | File-based coordination. Orchestrator manages all dispatch. Add agents incrementally during testing. |
| OpenClaw security vulnerabilities (malicious skills) | High | No ClawHub skills. Custom-only. Sandbox mode. Dedicated Mac Mini. |
| Token costs exceeding budget | Medium | Stateless specialists. PromptBuilder enforces 8K token ceiling. Cost tracking per task. Budget enforcer pauses work at ceiling. |
| Agent "competence creep" (doing things outside scope) | Medium | Explicit BOUNDARIES section in every SOUL.md. Guardian Agent checks. |
| First floor takes longer than estimated | Medium | Set expectations: 3-4 weeks for first floor, not 8-10 days. Speed improves with each subsequent floor. |
| Kit email limitations at scale | Low | Works for v1. Document upgrade path to Klaviyo/Omnisend if needed. |
| Mac Mini hardware failure | Low | Daily Git backups to cloud. Supabase has point-in-time recovery. Can rebuild on new hardware from Git + Supabase. |

---

# BUDGET OVERVIEW

| Item | Test Phase (Monthly) | Production Phase (Monthly) |
|---|---|---|
| Floor Manager heartbeat (Opus) | $50-80 | $50-80 |
| Agent tasks (build phase) | $80-120 one-time | — |
| Agent tasks (operations) | — | $100-200 |
| Content generation (images + video) | $30-65 | $120-265 |
| Hosting (Vercel) | $0-20 | $20 |
| Database (Supabase) | $0 (free tier) | $25 |
| Email (Resend + Kit) | $0 (free tiers) | $30-50 |
| Ads budget | $0-200 (test) | $300-1,500+ |
| POD fulfillment | $0 upfront | Per order (built into margins) |
| **Total** | **$200-500** | **$650-2,200+** |

Test ceiling: $200 (adjustable). Hard stop + alerts at 50/75/90%.
