# EVE — Master Plan
## Spec Assessment + Implementation Roadmap

---

# PART 1: WHAT'S WRONG OR MISSING IN YOUR CURRENT SPECS

## Problems That Will Break Things

### 1. OpenClaw Mismatch
Your infrastructure spec describes a 60-second heartbeat managing a worker pool of parallel agents with concurrent limits, task queues, and automatic dependency detection. OpenClaw doesn't do this. OpenClaw's heartbeat is designed for one agent checking a HEARTBEAT.md file periodically and deciding whether to act. It's a single-agent pulse, not a multi-agent orchestrator.

**What this means:** You need a custom orchestration layer BETWEEN EVE and OpenClaw. OpenClaw can be the runtime that executes individual agent work cycles (calling the Anthropic API, managing conversation history, executing tool actions). But the multi-agent coordination — task queuing, parallel dispatch, dependency tracking, status broadcasting — that's custom code you need to build.

**Fix:** Redefine OpenClaw's role. OpenClaw = the engine that runs each individual agent. The EVE Orchestrator = the custom layer that decides WHICH agents run, WHEN, with WHAT tasks, and tracks their status.

### 2. No PromptBuilder Exists
The PromptBuilder is described in the Business Intelligence doc as the pipeline that assembles each agent's system prompt from role + brand context + skills + task + rules. This is the most critical piece of code in the entire system — it determines how good every agent is. But it's only a diagram. No code, no template, no working prototype.

**What this means:** Without the PromptBuilder, you have no agents. Every agent is just an API call with a system prompt. The PromptBuilder IS the product.

**Fix:** This is the first thing that gets built. Before anything else.

### 3. No Database Schema Implementation
Your infrastructure doc has a high-level schema (floors, agents, tasks, etc.) but no actual migrations, no ORM setup, no connection pooling config. The schema also has gaps — there's no table for the improvement engine proposals, no table for the trust ladder state, no table for UI component configurations per floor.

**Fix:** Expand the schema and implement it as actual Prisma migrations.

### 4. The Agent Roster Is Over-Specified
23 agents for a single ecommerce floor. Each agent is a separate API call with its own conversation history. At Opus pricing, running 6 Opus agents simultaneously means roughly $0.15-0.60 per agent turn (depending on context size). A single build cycle with all 23 agents running multiple turns could cost $50-200 just in API calls.

**What this means:** The system works on paper but the cost of running this many separate agent instances could be prohibitive for small businesses.

**Fix:** Consolidate agents where roles overlap. The Copy Agent, Brand Agent review of copy, and the "Humanizer" step could be one agent with a multi-step prompt instead of three separate API calls. The Video Agent, Video Generator Agent, and Video Editor Agent pipeline makes 3 separate API calls when a single well-prompted agent could handle the full workflow. Target: reduce to 12-15 agents per floor maximum, with clear justification for each separate instance.

### 5. No Mobile UI System
Your dashboards are HTML mockups designed for desktop (glassmorphism, floating gradient orbs, canvas animations). You just told me mobile-first. The current dashboard designs won't work on a phone. Canvas animations drain battery. Glassmorphism with backdrop-filter is performance-heavy on mobile. The information density is too high for a 6-inch screen.

**Fix:** Redesign the UI as a mobile-first progressive web app (PWA). Card-based layout. Notifications as the primary interaction model. Swipe gestures for approvals. The desktop version is the PWA scaled up, not the other way around.

### 6. No Self-Improvement Architecture
You described the most important feature of EVE — continuous improvement — but it's not in any of your spec files. The playbook library in the Post-Launch doc is passive knowledge storage. There's no system for:
- Proposing prompt improvements based on agent performance
- A/B testing different agent configurations
- Tracking which agent prompts produce better outputs
- The trust ladder (Level 1-4 autonomy progression)
- A review/approve flow for system changes

**Fix:** This needs its own spec document and its own subsystem in the architecture.

### 7. No Dynamic Floor UI System
You described EVE building custom UI per floor — image galleries for shirt companies, brand pickers, design review screens. This doesn't exist anywhere in the specs. The current dashboard is a fixed layout. There's no component library, no system for EVE to assemble floor-specific interfaces.

**Fix:** Build a component library of interaction templates (image picker, brand selector, A/B comparator, product mockup viewer, content approval queue, etc.) that the Floor Manager can assemble into a floor-specific review interface.

---

## Things That Are Missing Entirely

### 8. Onboarding Flow
There's no description of how a new user sets up EVE for the first time. What happens when someone installs EVE? How do they enter their API keys? How does the system verify everything is connected? What's the first thing they see?

### 9. Error Recovery for the Human
When an agent produces something bad and it passes through all the review layers, what does the human do? The revision system describes how to fix things DURING the build, but what about after launch? What if the social media agent posts something off-brand at 3am? What's the emergency stop flow?

### 10. Cost Estimation Before Commitment
CEO Mode evaluates a business idea and presents a plan, but the cost estimate is vague ("estimated build cost $380"). The human needs to know: how much will this cost me in API calls during the build? How much per month to run after launch? What's the worst case? The Finance Agent tracks costs after they happen, but there's no upfront cost model.

### 11. Testing and QA Pipeline
The Launch Agent has a checklist, but there's no automated testing. No unit tests for the website code. No visual regression testing. No load testing. No broken link checking. No accessibility testing. The system builds production websites — they need to be tested like production websites.

### 12. Backup and Disaster Recovery
What happens if the database corrupts? What happens if Vercel goes down? What happens if someone accidentally deletes a floor's workspace? There's no backup strategy, no recovery plan, no redundancy.

### 13. Rate Limiting and API Budget Controls
You have `max_api_spend_per_day: 100` in the config, but no mechanism to actually enforce it across 23 agents making parallel API calls. No token counting per agent. No circuit breaker pattern. If 6 agents are running simultaneously and each hits a retry loop, you could blow through $100 in minutes.

---

## Things That Are Good and Should Stay

- **The 3-gate approval system.** Simple, clear, prevents disasters. Keep it.
- **The Foundation Package.** Having every agent read the same brand document is exactly right. Single source of truth.
- **The Floor Manager as single point of contact.** You never talk to agents directly. Clean hierarchy.
- **The 3-tier terminal access system.** Well thought out, practical safety layers.
- **The playbook library concept.** Cross-floor learning is where EVE becomes exponentially more valuable over time.
- **The content pipeline design.** Strategy → Creative Direction → Production → Post-Production → Publishing → Analytics → back to Strategy. This is how real content teams work.
- **The video workflow (Path A/B).** Image-first for quality, text-to-video for speed. Smart.
- **The model tier system.** Opus for thinking, Sonnet for doing, Haiku for mechanical tasks. Good cost optimization.
- **Customer data protection rules.** Agents never seeing PII, working with aggregates only. Correct approach.
- **The skill registry.** Curated, sourced, with clear assignment rules. Solid.

---

# PART 2: IMPLEMENTATION ROADMAP

## Philosophy: Build the Engine, Then the Car

We build EVE in 6 phases. Each phase produces something that works. No phase takes longer than 2-3 weeks. After Phase 2, you can run your first test floor.

---

## Phase 0: Architecture Lock (Week 1)
**Goal:** Finalize the technical architecture so nothing changes underneath us while we build.

### Deliverables:
1. **Revised system architecture diagram** — showing EVE Brain, Orchestrator, PromptBuilder, OpenClaw runtime, Dashboard, and Improvement Engine as separate components with clear interfaces between them.

2. **Revised agent roster** — consolidated from 23 to 12-15 agents with justification for each. Merged roles documented.

3. **Complete database schema** — all tables, relationships, indexes. Including: improvement proposals, trust ladder state, floor UI configurations, cost tracking with token-level granularity, backup metadata.

4. **API budget control design** — token counting, per-agent cost tracking, circuit breakers, spend alerts, hard stops.

5. **Mobile-first UI wireframes** — card-based layout, notification patterns, swipe interactions, approval flows. Phone-screen-sized. Not desktop adapted.

6. **Technology stack confirmation:**
   - Runtime: Node.js + TypeScript
   - Framework: Next.js (for dashboard PWA)
   - Database: PostgreSQL via Supabase
   - Agent runtime: OpenClaw (individual agent execution)
   - Orchestration: Custom (EVE Orchestrator)
   - Mobile: PWA with push notifications
   - Hosting: Vercel (dashboard + floor websites)

### Phase 0 is DONE when:
- You approve the revised architecture
- You approve the consolidated agent roster
- The tech stack is confirmed

---

## Phase 1: The PromptBuilder (Week 2)
**Goal:** Build the engine that makes agents smart.

### What gets built:
1. **PromptBuilder core** — takes role definition, brand context, skill knowledge, current task, and rules → assembles a complete system prompt under 8,000 tokens.

2. **Role templates** — system prompt templates for each agent role (Floor Manager, Brand Agent, Copy Agent, etc.) with placeholder slots for brand context, skills, and task.

3. **Skill loader** — reads SKILL.md files, extracts the relevant knowledge, compresses it to fit within token budget.

4. **Context manager** — tracks how many tokens each component uses, prioritizes what gets included when approaching limits.

5. **Brand context injector** — takes the Foundation Package and extracts the relevant sections for each agent type (Copy Agent gets voice guidelines, Design Agent gets visual direction, etc.)

### Phase 1 is DONE when:
- You can input a role + brand doc + skills + task and get a well-structured system prompt out
- Token counting is accurate
- Output prompts are under 8,000 tokens

---

## Phase 2: The Orchestrator + First Agent Run (Week 3-4)
**Goal:** Build the system that manages multiple agents and run your first real agent.

### What gets built:
1. **Task queue** — priority-based queue that holds agent tasks with dependencies.

2. **Worker pool** — manages concurrent agent execution. Configurable limits per floor and total.

3. **Agent lifecycle manager** — creates agent instances, manages conversation history, handles status transitions (idle → working → blocked → complete).

4. **Dependency tracker** — knows that Web Agent can't start until Design Agent delivers wireframes. Automatically triggers dependent agents when outputs appear.

5. **Status broadcaster** — every agent's status is visible in real-time.

6. **OpenClaw integration layer** — translates EVE's orchestration commands into OpenClaw agent execution. Each agent task becomes an OpenClaw session with the assembled system prompt.

7. **Cost tracker** — counts tokens per agent per task, calculates cost in real-time, enforces budget limits.

### First Agent Run:
- Create a test floor with just 3 agents: Floor Manager, Brand Agent, Strategy Agent
- Give it a simple goal
- Watch the Foundation Sprint run
- Verify: agents collaborate, outputs appear in workspace, Floor Manager tracks progress, costs are tracked

### Phase 2 is DONE when:
- 3 agents can run a Foundation Sprint for a test goal
- You can see their status and outputs
- Costs are tracked accurately
- The system handles errors gracefully (API failures, timeouts)

---

## Phase 3: CEO Mode + Floor Creation (Week 5-6)
**Goal:** Build the brain that evaluates ideas and creates floors.

### What gets built:
1. **CEO Mode system prompt** — the master prompt incorporating business intelligence, the 7-question framework, market evaluation, agent selection logic, skill assignment logic.

2. **Floor creation workflow** — CEO Mode asks questions → evaluates → creates floor config → selects agents → assigns skills and models → presents plan for approval.

3. **Agent factory** — creates all agents for a floor based on the config, initializes their conversation histories, registers them with the Orchestrator.

4. **Workspace initializer** — creates the floor directory structure, initializes the shared workspace.

5. **Foundation Sprint trigger** — after floor creation and your approval, automatically starts the Brand + Strategy + Finance agents.

### Phase 3 is DONE when:
- You can describe a business idea to CEO Mode
- It asks smart questions
- It produces a floor plan with agents, skills, models, and budget estimate
- You approve and the Foundation Sprint starts automatically

---

## Phase 4: The Dashboard (Week 7-9)
**Goal:** Build the mobile-first interface you actually use.

### What gets built:
1. **PWA shell** — installable on your phone, works offline for cached data, push notifications.

2. **HQ view** — total revenue, floor cards, pending approvals, CEO Mode chat.

3. **Floor view** — three tabs (Overview, Build, Settings) optimized for phone screens.

4. **Notification system** — red (approval required), yellow (heads up), green (informational). Push to phone for red and yellow.

5. **Approval flow** — swipe or tap to approve/reject. Foundation Package review. Launch review. Ad activation review.

6. **Floor Manager chat** — talk to any Floor Manager from your phone. Voice input option.

7. **Dynamic floor UI components:**
   - Image picker (for design approvals — swipe through options)
   - Brand selector (3 options, tap to pick)
   - Content approval queue (swipe left/right)
   - Product mockup viewer
   - A/B comparator (side by side, tap to choose)

### Phase 4 is DONE when:
- You can install the PWA on your phone
- You can create a floor, approve the foundation, and monitor the build from your phone
- Notifications work
- The approval flow feels fast and natural

---

## Phase 5: Full Floor Execution (Week 10-12)
**Goal:** Run a complete floor from idea to launch.

### What gets built:
1. **All agent roles active** — the full consolidated roster can execute.

2. **Content pipeline** — Strategy → Creative Direction → Production → Post-Production → Publishing.

3. **Video pipeline** — Path A and Path B working with real API calls to video generation models.

4. **Website build pipeline** — Design → Web Agent builds Next.js site → Preview system → Staging → Production deploy.

5. **Integration pipeline** — Stripe, analytics, email capture, social platform connections.

6. **Ad pipeline** — campaign creation, creative pairing, audience targeting — all created as PAUSED.

7. **Launch checklist** — automated QA, security checklist, Launch Agent verification.

### Phase 5 is DONE when:
- A complete floor can go from idea → Foundation → Build → Launch
- All 10 phases of the delivery pipeline work
- All 3 approval gates work
- A real website is deployed to Vercel
- Ad campaigns are created (paused) on Meta

---

## Phase 6: The Improvement Engine (Week 13-15)
**Goal:** Build the system that makes EVE smarter over time.

### What gets built:
1. **Performance tracker** — measures agent output quality based on: approval rate (how often you accept vs reject), revision count, time to complete, cost per task.

2. **Prompt improvement proposals** — analyzes which agents are underperforming and proposes specific prompt changes. Example: "Copy Agent's product descriptions have been revised 4 out of 5 times for being too long. Proposed change: add 'Keep descriptions under 50 words' to the role template."

3. **Strategy learning** — extracts winning patterns from floor performance data into the playbook library. Automatically suggests applying proven strategies to new floors.

4. **Preference learning** — tracks your approval patterns. "You've approved bold, high-contrast designs 9 out of 10 times. Adjusting Design Agent's default direction."

5. **Trust ladder** — Level 1 (review everything) through Level 4 (full autonomy). You control when to promote. EVE never self-promotes.

6. **Improvement review UI** — a section in the dashboard where you see all proposed improvements, what they'd change, why, and approve/reject them.

7. **Safety guardrails:**
   - No improvement can remove approval gates
   - No improvement can increase spending limits
   - No improvement can change security tiers
   - All improvements are logged and reversible
   - A "rollback" button that undoes any improvement

### Phase 6 is DONE when:
- EVE proposes real improvements based on real data
- You can review and approve them from your phone
- Approved improvements are applied and tracked
- The playbook library grows from floor results
- You can see EVE getting smarter

---

## Timeline Summary

| Phase | What | Duration | Milestone |
|---|---|---|---|
| 0 | Architecture Lock | Week 1 | Approved architecture + revised roster |
| 1 | PromptBuilder | Week 2 | Working prompt assembly engine |
| 2 | Orchestrator | Week 3-4 | First 3-agent Foundation Sprint runs |
| 3 | CEO Mode | Week 5-6 | Create a floor from an idea through chat |
| 4 | Dashboard | Week 7-9 | Mobile app you can manage from your phone |
| 5 | Full Floor | Week 10-12 | Complete business built and launched |
| 6 | Improvement Engine | Week 13-15 | EVE starts getting smarter |

**After Phase 6**, EVE is a working system that:
- Takes a business idea and builds it autonomously
- You manage from your phone
- Gets smarter with every floor it builds
- Learns your preferences
- Shares strategies across floors
- Earns more autonomy as you build trust

---

# PART 3: WHAT TO BUILD FIRST (RIGHT NOW)

Phase 0 is where we start. The single most important thing to do right now is:

1. **Consolidate the agent roster** — decide which of the 23 agents merge and which stay separate
2. **Design the PromptBuilder template** — the actual structure of a system prompt
3. **Design the mobile dashboard** — card layouts, approval flows, notification patterns
4. **Define the Orchestrator's API** — how does a "run this agent with this task" call work?

These four things unlock everything else. Without them, we're building on sand.

---

# PART 4: DECISIONS YOU NEED TO MAKE

Before we start building, you need to decide:

1. **Agent consolidation** — are you okay merging some of the 23 agents into fewer, more capable agents? This saves cost and complexity but means each agent does more.

2. **PWA or native app** — a PWA works on both iPhone and Android, installs like an app, and is faster to build. A native iOS app looks better but takes longer and only works on iPhone. Recommendation: PWA first, native later if needed.

3. **Hosting the EVE engine** — the Orchestrator needs to run 24/7. Options: your Mac (free but depends on your machine being on), a VPS like DigitalOcean ($20-50/month), or a serverless approach (more complex but scales). Recommendation: VPS to start.

4. **Budget ceiling for the first test floor** — how much are you willing to spend on API calls to prove the system works? The Foundation Sprint alone (3 Opus agents) will cost $5-15. A full floor build could be $50-200.

5. **First test floor idea** — even though you said "build EVE first," we need a real goal to test against by Phase 2. It can be a throwaway test. What should it be?
