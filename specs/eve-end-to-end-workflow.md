# EVE — End-to-End Workflow
## The Complete Journey From Idea to Running Business

---

# OVERVIEW

This document traces the complete lifecycle of a business built by EVE — from the moment you describe an idea to the ongoing daily operations of a profitable floor. Every step references the specific system component that handles it (CEO Mode, Orchestrator, PromptBuilder, Lobster, OpenClaw, Dashboard).

---

# PHASE 0: THE IDEA (5-15 minutes)

## What Happens

You open the EVE app on your phone and tell CEO Mode your idea.

```
YOU: "I want to create a faith-based urban clothing company"
```

## CEO Mode Activates

CEO Mode reads your message and enters the UNDERSTAND phase. It asks 3-5 focused clarifying questions — not a questionnaire, a conversation.

```
CEO MODE: "I like this. Let me understand what you're building.

1. Custom designs by you, or customer-designed (print on demand)?
2. Faith-based how? — scripture-inspired graphics, subtle symbolism, 
   or bold statement pieces?
3. Who's wearing this? — age range, style (streetwear, athleisure, 
   premium casual)?
4. Revenue goal — what do you want this making in 3 months?
5. What platforms do you want to sell on? (Instagram, TikTok, website, all?)"
```

You answer from your phone. Quick, casual responses are fine — CEO Mode interprets.

```
YOU: "print on demand, scripture inspired but urban streetwear style, 
     18-35 young adults, $10K in 3 months, all platforms"
```

## Where This Runs

- **Component:** CEO Mode agent (Opus)
- **OpenClaw:** `eve-ceo` agent, main session
- **Dashboard:** CEO Mode chat in HQ view
- **Notification:** None yet — you initiated the conversation

---

# PHASE 1: EVALUATION (2-5 minutes)

## What Happens

CEO Mode runs the 7-question business model framework silently (it doesn't show you the framework, just the conclusion).

```
Internal evaluation:
1. Customer: Young adults 18-35, faith-driven, streetwear aesthetic
2. Problem: Want to express faith without looking "churchy" — urban style
3. Revenue: Product sales, $25-45 per shirt, POD margins ~40-50%
4. Differentiation: Faith + streetwear crossover, scripture-inspired but cool
5. Channels: Instagram Reels + TikTok (visual, young audience)
6. Math: $35 avg price × 50% margin = $17.50 profit per sale
         Need ~570 sales in 3 months = ~190/month = ~6-7/day
         At 2.5% conversion, need ~250 visitors/day
         At $15 CPA, ad budget ~$2,850/month for target
7. Scale: POD = infinite scale, no inventory risk
```

CEO Mode also loads relevant deep knowledge: `ecommerce-playbook.md`, `pricing-strategies-deep.md`, `content/viral-content-frameworks.md`.

## The Floor Plan

CEO Mode produces the complete floor configuration:

```
CEO MODE: "Here's what I'd build for this:

FLOOR: FaithForge
GOAL: Launch faith-based urban streetwear brand, $10K revenue in 90 days

TEAM: 13 agents
  Opus (4 core + 2 specialist): Floor Manager, Brand Agent, Strategy Agent, 
            Finance Agent + Design Agent, Video Agent
  Sonnet (3 core + 3 specialist): Copy Agent, Web Agent, Launch Agent
            + Commerce Agent, Social Media Agent, Ads Agent
  Haiku (1 core): Analytics Agent

ESTIMATED COSTS:
  Build: ~$80-120 in API calls over 2-3 weeks
  Monthly operations: ~$150-250 (agents + content generation)
  Ad budget needed: ~$50/day ($1,500/month) to hit target
  POD setup: $0 upfront (pay per order)
  Hosting: ~$20/month (Vercel Pro)
  Total first month: ~$1,800-2,000

TIMELINE:
  Foundation Sprint: 2-4 hours (brand + strategy)
  Build: 5-7 days
  Launch: Day 8-10
  First revenue: Day 10-14 (if ads activated)

Ready to build?"
```

## Where This Runs

- **Component:** CEO Mode agent (Opus) + Business Intelligence knowledge library
- **Lobster:** Not yet — this is conversational, not a pipeline
- **Dashboard:** CEO Mode chat, floor plan appears as a card you can expand

---

# PHASE 2: FLOOR CREATION (30 seconds)

## What Happens

You approve. One tap.

```
YOU: [taps "Build it"]
```

The Orchestrator fires the floor creation sequence:

```
1. Database: Create floor record (FaithForge, goal, config, budget)
2. File system: Create __PATH_EVE_PROJ__faithforge/
3. Create shared workspace directories (brand/, copy/, design/, etc.)
4. For each of 13 agents:
   a. Copy template files from ~/.openclaw/agents/templates/{role}/
   b. Customize SOUL.md with floor name and goal
   c. Customize AGENTS.md with team roster and rules
   d. Register with OpenClaw: openclaw agents add --id {role}-faithforge
5. Set up Telegram notification binding for Floor Manager
6. Create phase records in database (all 10 phases, status: pending)
7. Mark Phase 1 (Foundation) as: active
8. Dispatch Foundation Sprint agents
```

## Floor Manager's First Message

Within 30 seconds of your approval:

```
FLOOR MANAGER: "FaithForge is live. Foundation Sprint starting now.
Brand Agent and Strategy Agent are working on the Foundation Package.
I'll have 3 brand direction options ready for your review in ~2 hours."
```

## Where This Runs

- **Component:** Orchestrator (custom TypeScript)
- **Lobster:** `floor-creation.lobster` pipeline
- **OpenClaw:** `openclaw agents add` for each agent
- **Dashboard:** Floor card appears in sidebar + HQ view
- **Notification:** Push to phone — "FaithForge created. Foundation Sprint started."

---

# PHASE 3: FOUNDATION SPRINT (2-4 hours)

## What Happens

Three agents work simultaneously:

**Brand Agent (Opus)** creates 3 distinct brand directions:
- Option A: Bold & Prophetic — high contrast, gold/black, statement pieces
- Option B: Humble Street — muted earth tones, subtle scripture, minimalist
- Option C: Urban Revival — bright colors, graffiti-inspired scripture art

For each option: name ideas, color palette (hex codes), typography, visual mood, logo direction.

**Plus the Voice Sample** — for the selected brand direction, Brand Agent writes a 500-word reference text that perfectly captures the brand's ideal voice. This includes a sample product description, sample social caption, sample email intro, and sample headline — all in the brand's tone. The Voice Sample loads into every content agent call after approval, eliminating tone drift (the #1 revision cause for copy).

**Strategy Agent (Opus)** creates the business plan:
- Target customer persona
- Competitive landscape (who else does faith + streetwear)
- Product strategy (start with 10 designs, expand based on sellers)
- Go-to-market (Instagram Reels + TikTok → website → conversion)
- Revenue model and projections

**Finance Agent (Opus)** creates the budget:
- Build costs breakdown
- Monthly operating costs
- Revenue scenarios (conservative, moderate, aggressive)
- Break-even analysis
- Ad budget recommendations

## Your Review (The Review Tab)

The Floor Manager compiles everything into the Foundation Package and sends it to you. Your phone gets a red notification:

```
🔴 APPROVAL REQUIRED: FaithForge Foundation Package ready for review
```

You open the app. The **Review Tab** for FaithForge shows:

**Brand Selector** — 3 cards, one per brand direction. Each shows:
- Name + tagline
- Color palette (visual swatches)
- Sample text in the brand voice
- Mood image (generated to represent the vibe)
- Tap to expand full details. Tap to select.

**Voice Sample Preview** — once you select a brand direction, review the 500-word voice reference. This is how every piece of copy will sound. Edit if needed.

**Strategy Summary** — expandable card with business plan highlights

**Budget Overview** — cost breakdown card with scenarios

You tap Brand Option A. Or you type feedback: "I like Option A's energy but Option C's colors." Brand Agent revises. New version appears.

Once you're happy → tap **"Approve Foundation"**

## Where This Runs

- **Component:** Orchestrator dispatches Brand, Strategy, Finance agents in parallel
- **PromptBuilder:** Brand context section = EMPTY (State 1: PRE-FOUNDATION)
- **OpenClaw:** Three agent sessions running concurrently
- **Dashboard:** Review Tab with brand selector, strategy card, budget card
- **Notification:** 🔴 push when Foundation Package is ready

---

# PHASE 4: PARALLEL BUILDOUT (5-7 days)

## What Happens

**Gate 1 passed.** The PromptBuilder loads the approved Foundation Package — including the Voice Sample — into every agent's brand context. All 13 agents activate.

The Orchestrator dispatches work in parallel based on dependencies:

```
IMMEDIATE START (no dependencies):
  ├── Design Agent: wireframes + mockups for website
  ├── Copy Agent: homepage copy, product descriptions, about page
  ├── Commerce Agent: product catalog, sourcing research, pricing
  ├── Ads Agent: audience research, campaign structure planning
  ├── Social Media Agent: platform setup, content calendar planning
  └── Video Agent: brand video concepts, content briefs

STARTS WHEN DESIGN DELIVERS WIREFRAMES:
  └── Web Agent: begins implementing site from wireframes

STARTS WHEN PRODUCTS ARE CATALOGED:
  ├── Design Agent: generates product mockups (shirts with designs on them)
  ├── Copy Agent: writes product descriptions from catalog data
  └── Commerce Agent: connects POD provider (Printful/Gooten)

STARTS WHEN SITE IS FUNCTIONAL:
  ├── Web Agent: Stripe integration, analytics setup, email capture
  ├── Launch Agent: begins QA checklist
  └── Ads Agent: creates campaigns (PAUSED) with creative from production
```

## What You See on Your Phone

The **Build Tab** shows:
- Progress bar: 23% → 45% → 67% → updates in real-time
- Agent status cards: "Design Agent: Building homepage mockup" / "Copy Agent: Writing product descriptions (14 of 30)"
- Cost tracker: "$34.20 of $200 budget used"
- Phase indicator: Phase 3 (Alpha) of 10

## Design Approval Flow

When the Design Agent produces the shirt designs (the images that will go ON the shirts), the Review Tab lights up:

```
🟡 HEADS UP: 30 design concepts ready for review
```

You open the Review Tab. **Image Gallery** component shows all designs in a swipeable grid. You swipe right to approve, left to reject. You can tap to enlarge. You can type feedback on specific ones: "Love this but make the text bigger."

Design Agent revises based on your feedback. Updated designs appear. You approve the final set.

The Commerce Agent takes the approved designs and uploads them to the POD provider with the correct specifications.

## Content Production

While the website is being built, the content pipeline starts producing:

- Design Agent generates social post visuals using the brand templates
- Video Agent produces the first batch of Reels/TikToks (Path B for speed)
- Copy Agent writes captions for each piece
- Brand Agent reviews everything before it enters the publishing queue
- Content accumulates in the queue, ready for launch day

## Floor Manager Communication

Throughout the build, you chat with the Floor Manager as needed:

```
YOU: "The website hero section needs to feel more premium"

FLOOR MANAGER: "Routing to Design Agent. Specifics that would help:
1. More whitespace?
2. Different hero image?
3. Different font weight?
Or screenshot what you'd change and I'll translate."

YOU: "More whitespace, bigger hero image, less text above the fold"

FLOOR MANAGER: "Done. Design Agent updated. Preview will refresh in ~10 min."
```

## Where This Runs

- **Component:** Orchestrator managing parallel agent dispatch + dependency tracking
- **PromptBuilder:** Brand context = ACTIVE (State 3). All agents get brand context.
- **Lobster:** `buildout.lobster` pipeline managing phase transitions
- **OpenClaw:** 6-10 agents running concurrently (within concurrency limits)
- **Dashboard:** Build Tab (progress, agents, costs), Review Tab (design approvals)
- **Notification:** 🟡 when milestones complete or input needed

---

# PHASE 5: STAGING + LAUNCH REVIEW (1-2 days)

## What Happens

Web Agent deploys to Vercel preview URL. Launch Agent runs the full QA checklist:

```
LAUNCH AGENT VERIFICATION:
  ✅ SSL active
  ✅ All pages load (homepage, products, about, FAQ, policies)
  ✅ Mobile responsive (tested at 375px, 390px, 414px widths)
  ✅ Stripe test checkout works (test card → order confirmation)
  ✅ Analytics firing (GA4 pageviews, Meta Pixel, conversion events)
  ✅ Email capture working (test signup → welcome email received)
  ✅ Cookie consent banner functional
  ✅ Privacy policy and terms pages live
  ✅ All product images loading
  ✅ Cart functionality (add, remove, update quantity)
  ✅ Page speed: <3 second load time
  ✅ No console errors
  ⚠️ 2 broken image links on product page 7 (flagged to Web Agent)
```

Web Agent fixes the broken links. Launch Agent re-verifies. All green.

## Gate 2: Your Review

Red notification:

```
🔴 APPROVAL REQUIRED: FaithForge ready for launch
Preview: https://faithforge-preview-abc123.vercel.app
```

You open the preview URL on your phone. You browse the site. You test checkout with a test card. You check every page. Everything looks right.

You tap **"Go Live"**

## Go-Live Sequence

```
1. Deploy to production on Vercel (target: production)
2. Prompt you for custom domain (if configured) — show DNS records
3. Switch Stripe from test to live mode
4. Verify analytics on production URL
5. Create ad campaigns as PAUSED
6. Push launch summary to your phone:
   "FaithForge is LIVE at faithforge.com
    Stripe: active
    Analytics: confirmed
    Ads: created, waiting for your activation
    Content queue: 14 posts ready to publish"
```

## Where This Runs

- **Component:** Launch Agent (verification) + Orchestrator (deployment)
- **Lobster:** `launch.lobster` pipeline — deterministic go-live sequence
- **Dashboard:** Preview URL card, launch checklist, Go Live button
- **Notification:** 🔴 for launch approval, 🟢 for launch confirmation

---

# PHASE 6: AD ACTIVATION (Gate 3)

## What Happens

Ads Agent presents each campaign for your approval individually:

```
🔴 APPROVAL REQUIRED: FaithForge ad campaigns ready

Campaign 1: Broad Interest — Faith + Streetwear
  Platform: Meta (Instagram + Facebook)
  Budget: $25/day
  Audience: 18-35, interests in Christian faith + urban fashion
  Creative: 5 video ads + 3 image ads
  [Preview all creative]

Campaign 2: Retargeting — Site Visitors
  Platform: Meta
  Budget: $15/day
  Audience: Anyone who visited faithforge.com
  Creative: 3 product carousel ads
  [Preview all creative]

Campaign 3: TikTok — Trend Content
  Platform: TikTok
  Budget: $10/day
  Audience: 18-30, streetwear + faith interests
  Creative: 4 UGC-style video ads
  [Preview all creative]
```

You review each campaign. You can approve all, approve some, or request changes to specific ones. Each activation is individual — you're never forced into all-or-nothing.

## Where This Runs

- **Component:** Ads Agent (campaign creation) + Orchestrator (activation)
- **Dashboard:** Ad preview cards with per-campaign approve/reject
- **Notification:** 🔴 for each campaign activation

---

# PHASE 7: THE FIRST 72 HOURS (Post-Launch)

## What Happens

The floor shifts from build mode to operations mode. The Orchestrator changes Floor Manager's heartbeat from 60 seconds to 5 minutes.

**Hour 1-24:**
- Content pipeline publishes first posts (from the pre-built queue)
- Social Media Agent monitors engagement, responds to all comments
- Analytics Agent tracks: site visitors, page views, add-to-carts, purchases
- Ads Agent monitors campaign performance (learning phase — don't touch)

**Hour 24-48:**
- Floor Manager sends you the 24-hour report:
  ```
  FAITHFORGE — 24 HOUR REPORT
  Visitors: 342
  Add to cart: 28 (8.2% rate)
  Purchases: 4 ($156 revenue)
  Conversion: 1.2% (expected range for day 1)
  Ad spend: $50
  ROAS: 3.1x (healthy for learning phase)
  Top product: "Walk by Faith" hoodie
  Content: 3 Reels posted, 12K total views, 340 engagement actions
  ```

**Hour 48-72:**
- Pattern emerges: which products are getting attention, which ads are working
- Ads Agent begins light optimization (shift budget toward winning ad sets)
- Content pipeline continues daily posting
- Social Media Agent engagement builds community

## Where This Runs

- **Component:** All post-launch systems active
- **Lobster:** `ad-optimization.lobster` (daily), `content-production.lobster` (daily)
- **Dashboard:** Overview Tab is now the primary view (revenue, orders, ads, content)
- **Notification:** 🟢 daily reports, 🟡 if anything needs attention

---

# PHASE 8: ONGOING OPERATIONS (Week 2+)

## The Daily Rhythm

```
MORNING (automated):
  7:00 AM — Floor Manager compiles overnight summary
  7:05 AM — CEO Mode includes it in your morning briefing
  7:10 AM — Push notification: "Good morning. FaithForge: $X revenue overnight.
             2 items need your attention."

CONTINUOUS (all day, automated):
  Content pipeline: publishes scheduled posts
  Social Media Agent: responds to comments/DMs within 30 min
  Ads Agent: monitors campaigns, optimizes within rules
  Analytics Agent: tracks everything

EVENING (automated):
  Ads Agent: daily optimization (shift budgets, pause losers)
  Finance Agent: daily P&L update
  Content Strategist: queues tomorrow's content

WEEKLY (automated):
  Monday: Content Strategist creates this week's calendar from trend + performance data
  Friday: Floor Manager sends week summary
  Sunday: CEO Mode's cross-floor report + improvement proposals
```

## What You Actually Do

At Trust Level 1 (where you start), you:
- Read the morning briefing (~2 min)
- Approve or reject content in the Review Tab queue (~5 min)
- Check the dashboard when you want to (~5 min)
- Chat with Floor Manager if something needs direction
- Review improvement proposals when they appear (weekly)

**Total daily time: 10-15 minutes from your phone.**

As you promote to Trust Level 2+, even this decreases because routine decisions become automatic.

---

# PHASE 9: SCALING (Month 2+)

## When Scaling Triggers

CEO Mode monitors all floors and identifies when one is ready to scale:

```
CEO MODE: "FaithForge is ready to scale.

Evidence:
  - ROAS 4.1x for 18 consecutive days (target: 3x)
  - Conversion rate 2.8% (above 2% threshold)
  - Net margin 38% (above 20% threshold)
  - No fulfillment issues
  - Content engagement growing week-over-week

Recommendation:
  Phase 1 scaling — increase ad budget 20% this week ($50/day → $60/day).
  Expected impact: ~$1,200 additional revenue/month at current ROAS.

Approve?"
```

You approve from your phone. Ads Agent implements the increase.

## Scaling Phases

**Phase 1 (Vertical):** More of what works
- 20%/week ad budget increases while ROAS holds
- More content production (daily instead of 3x/week)
- Expand winning audiences
- Finance Agent monitors daily — pause if ROAS drops 15%+

**Phase 2 (Horizontal):** New channels
- Add TikTok ads if only on Meta (or vice versa)
- New product designs based on best sellers
- Email marketing sequences active
- Influencer partnerships (flagged for your decision)

**Phase 3 (Infrastructure):** Handle the growth
- Upgrade hosting
- Expand customer support knowledge base
- Optimize email deliverability for larger list

---

# PHASE 10: MULTI-FLOOR OPERATIONS

## Adding a Second Floor

When you're ready for a second business:

```
YOU: "I want to create a luxury scented candle brand"

CEO MODE evaluates → presents floor plan → you approve → 
new floor initializes alongside FaithForge

Now you have:
  FaithForge — running, scaling
  [New Floor] — building

HQ Dashboard shows both. CEO Mode manages cross-floor strategy.
```

## Cross-Floor Intelligence

CEO Mode identifies opportunities:

```
CEO MODE: "FaithForge's retargeting campaign structure is producing 6.2x ROAS.
Your candle floor has a similar audience profile but hasn't set up retargeting yet.
Recommend applying FaithForge's retargeting playbook to the candle floor.

This is a strategy transfer, not a data transfer — each floor keeps its own
customers and brand. Just the campaign structure gets adapted."
```

## The HQ Dashboard

Once you have multiple floors, the HQ view becomes your primary interface:

```
EVE HQ
  Total revenue: $28,400 this month
  
  FaithForge      $18,200 | ROAS 4.1x | Scaling Phase 1 | ✅ Healthy
  LuxeWick        $6,800  | ROAS 2.8x | Week 3          | 🟡 Watch ROAS
  [+ New Floor]
  
  Pending: 0 approvals
  CEO Mode: "FaithForge ready for Phase 2 scaling. LuxeWick needs creative refresh."
```

---

# PHASE 11: CONTINUOUS IMPROVEMENT

## The Improvement Loop (Weekly)

Every Sunday, the Improvement Engine runs:

```
1. COLLECT: Agent performance data from all floors
   - Approval rates (how often you accept agent output)
   - Revision counts (how many times work is sent back)
   - Cost per task
   - Time to completion

2. ANALYZE: CEO Mode identifies patterns
   - "Copy Agent's product descriptions revised 4/5 times for being too long"
   - "Design Agent's social graphics approved first try 90% of the time"
   - "Video Agent's Path B content gets 2x engagement vs. Path A on TikTok"

3. PROPOSE: Specific, evidence-based improvements
   - "Add to Copy Agent's prompt: 'Keep product descriptions under 50 words'"
   - "Shift TikTok content from Path A to Path B (data shows 2x engagement)"
   - "FaithForge's carousel format converts 3x better than single images —
     increase carousel ratio in content mix"

4. REVIEW: You see proposals in the Improvements section of the dashboard
   Each proposal shows: what changes, why (evidence), expected impact, 
   risk level, rollback plan

5. APPROVE/REJECT: You decide per proposal

6. APPLY: Approved changes are implemented
   - Prompt changes → PromptBuilder updates the agent template
   - Strategy changes → Floor Manager adjusts the content calendar
   - Workflow changes → Lobster pipeline updated

7. TRACK: Impact of each change monitored over the next week
   - Did the change improve the metric it targeted?
   - If not → auto-rollback proposed
```

## Preference Learning

Over time, CEO Mode notices patterns in your decisions:

```
After 20+ brand approvals:
  "You consistently choose bold, high-contrast designs over minimalist ones.
   Confidence: 85%. Propose adjusting Design Agent's default direction to
   lead with bold options first."

After 50+ content approvals:
  "You approve video content 95% of the time but reject 30% of carousels.
   The rejected carousels are usually too text-heavy.
   Propose reducing text per carousel slide to max 15 words."
```

These become proposals in the Improvement section. You approve → they become defaults.

---

# THE COMPLETE TIMELINE (SUMMARY)

| Time | What Happens | Your Involvement |
|---|---|---|
| Minute 0 | You describe your idea | 2-3 messages |
| Minute 5 | CEO Mode evaluates and presents floor plan | Review + approve |
| Minute 6 | Floor initialized, Foundation Sprint starts | Wait |
| Hour 2-4 | Foundation Package ready | Review brand options, approve (Gate 1) |
| Day 1-7 | Parallel buildout (all agents working) | Check in when you want, approve designs |
| Day 7-8 | Staging + QA | Review preview URL, approve launch (Gate 2) |
| Day 8 | GO LIVE | Approve ad campaigns (Gate 3) |
| Day 8-10 | First sales | Read reports, enjoy |
| Week 2+ | Ongoing operations | 10-15 min/day from phone |
| Month 2+ | Scaling | Approve budget increases |
| Ongoing | Improvement loop | Review weekly proposals |

**From idea to first sale: 8-10 days.**
**Your daily involvement after launch: 10-15 minutes.**
**Your involvement decreases as trust level increases.**

---

# ERROR SCENARIOS + RECOVERY

## "The Build Is Taking Too Long"

Floor Manager detects a phase is behind schedule:
```
FLOOR MANAGER: "Content phase is 2 days behind. Root cause: Video Agent 
waiting on product images from Design Agent. Three options:
1. Wait (4 day total delay)
2. Use placeholder images, replace later
3. Prioritize product images, delay brand video
Recommend option 3."
```
You pick an option. Floor Manager adjusts the plan.

## "The Ads Aren't Working"

Ads Agent detects ROAS below target for 3+ days:
```
🟡 FaithForge ad performance declining.
ROAS dropped from 4.1x to 1.8x over 5 days.

Diagnosis: Creative fatigue — CTR declining, frequency at 3.2
Recommended action: Pause fatigued ads, request new creative from content team.
New creative ETA: 24 hours. Estimated recovery: 3-5 days.

Approve creative refresh?
```

## "Something Went Wrong After Hours"

Social Media Agent posts something off-brand at 2 AM (slipped past review):
```
🔴 INCIDENT: Social post on Instagram may not match brand guidelines.
Post ID: [link]. Posted 2:14 AM.
Brand Agent review: "Tone is too casual for this brand. Recommend edit or delete."

Options:
1. Edit caption (Instagram allows this)
2. Delete post
3. Leave it (Brand Agent disagrees but it's your call)
```

## "I Changed My Mind About the Brand"

```
YOU: "I want to change the color palette to more earth tones"

FLOOR MANAGER: "Brand change impacts:
- 42 pieces of content in the queue (need color update)
- Website theme (2-4 hours to update)
- All ad creative (new variations needed)
- Estimated time: 1-2 days for full cascade
- Estimated cost: ~$15-25 in additional API calls

Proceed? Or want to phase it in (new content uses new colors, 
old content stays until replaced naturally)?"
```

## "I'm Over Budget"

```
🔴 BUDGET ALERT: FaithForge at 90% of $200 test ceiling.
Current spend: $180. Remaining: $20.

Active work that will continue spending:
- Floor Manager heartbeat: ~$3/day
- 2 content pieces in production: ~$4

Recommendation: Pause non-essential agents. Keep Floor Manager + 
post-launch monitoring active. Resume when budget is increased.

Increase budget? Or pause?
```

---

# RESEARCH VALIDATION + IMPROVEMENTS

Based on comprehensive research of production autonomous ecommerce systems, multi-agent business builders, and agentic commerce platforms in March 2026, here's what validates our approach and what needs to change.

## What The Research Confirms We Got Right

**1. Specialized agent teams are the winning pattern.** Genstore (TechCrunch, Feb 2026) uses the exact same architecture: Design Agent, Launch Agent, Analyst Agent, Marketing Agent, Support Agent working as a team. Their reported timeline: "one user built a fully functional dropshipping store in just two minutes." Our 8-10 day timeline for a more complete build (with brand development, custom designs, and content production) is realistic.

**2. The "prompt-to-store → agentic operations → full autonomy" progression matches our phased approach.** The industry consensus is that the journey progresses from initial setup to monitored operations to full autonomy. Our Trust Ladder (Level 1-4) directly maps to this.

**3. Human-on-the-loop is the 2026 best practice, not human-in-the-loop.** Deloitte and Gartner both emphasize that the most advanced businesses are shifting toward "human-on-the-loop" — humans monitor and intervene when needed, but don't approve every action. Our Trust Level 2-3 implements this exactly.

**4. Guardrails are non-negotiable.** Every production system that survived scaling has explicit guardrails: what agents CAN'T do matters more than what they can. Our safety rules, terminal tiers, and approval gates align with this.

**5. Starting with one use case and expanding works better than building everything at once.** MindStudio, Alhena, and every successful implementation emphasizes "start with one agent, measure, then add the next." Our approach of building EVE's engine first, then running a test floor, matches this.

## What We Need To Add

### Addition 1: Guardian Agent (Pre-Execution Verification)

Research from Emerline describes a "Guardian Agent" architecture — a separate, deterministic model that scrutinizes every agent action before execution, acting as a compliance officer.

**How to implement in EVE:**

Before any agent takes a real-world action (publishing content, deploying code, making API calls that cost money, sending emails), the action passes through a lightweight verification step:

```
Agent proposes action → Guardian check:
  ├── Is this within the agent's terminal tier? → verify
  ├── Does this match the current task assignment? → verify
  ├── Is the cost within budget? → verify
  ├── Does this violate any safety rules? → verify
  ├── ALL PASS → execute
  └── ANY FAIL → block, log, notify Floor Manager
```

This is NOT a separate Opus agent (too expensive). It's a deterministic code check + a Haiku-level sanity check for ambiguous cases. Cost: near zero for code checks, ~$0.01 for the rare Haiku verification.

**Where it lives:** Built into the Orchestrator, runs automatically on every Tier 2+ action.

### Addition 2: Generative Engine Optimization (GEO)

Research shows that 37% of product discovery now starts with AI agents (ChatGPT, Perplexity, Google Gemini). This means EVE's websites need to be optimized not just for Google Search (SEO) but for AI agent discovery (GEO).

**What this means for our workflow:**

During the website build phase, the Web Agent and Copy Agent should:
- Structure product data so AI shopping assistants can parse it
- Add structured data (JSON-LD) that AI agents can read
- Write product descriptions that answer the questions AI agents ask
- Ensure the site is crawlable by AI agent systems

**Add to the Web Agent's responsibilities:** "Implement Generative Engine Optimization — structured data, AI-parseable product information, schema markup for AI shopping assistants."

### Addition 3: Machine-to-Machine Commerce Readiness

A major 2026 trend is "agentic interoperability" — consumer AI shopping agents negotiating directly with merchant systems. EVE's floors should be ready for this.

**What this means:** The website should expose a machine-readable product catalog (API endpoint or structured data) that consumer AI agents can query. This isn't urgent for v1 but should be planned in the architecture so it can be added without rebuilding.

### Addition 4: Proactive Commerce Agents (Post-Launch)

Research from Alhena shows that "1% of visitors who engage with an AI shopping assistant account for approximately 10% of total revenue" and "brands deploying proactive AI see 5.5x higher engagement."

**What this means for our workflow:**

After launch, the floor should have a customer-facing AI shopping assistant on the website that:
- Proactively engages visitors (not just waits for them to ask)
- Recommends products based on browsing behavior
- Answers questions about products, shipping, returns
- Recovers abandoned carts in real-time
- Hands off complex issues to the human owner

**This is a new capability to add to Phase 8 (ongoing operations).** The Commerce Agent or a dedicated lightweight customer-facing bot handles this. It runs on Haiku (cheap, fast responses) with the product catalog and brand voice as context.

### Addition 5: Version Control Everything

The InfoQ article on ASDLC emphasizes that prompts, tool configs, memory schemas, and evaluation datasets should be versioned like code. 

**Implementation:**

```
__PATH_EVE_PROJ__{floor-name}/
  .git/                          # Git repo for the entire floor
  agents/
    floor-manager/
      SOUL.md                    # Version controlled
      AGENTS.md                  # Version controlled
      HEARTBEAT.md               # Version controlled
  brand/
    foundation-package.md        # Version controlled (with Gate 1 approval tagged)
    foundation-package.v1.md     # Previous versions preserved
  prompts/
    agent-templates/             # Version controlled prompt templates
      floor-manager.xml
      brand-agent.xml
      copy-agent.xml
  
  # Git tags mark key milestones:
  # v0.1-foundation-approved
  # v0.2-design-approved  
  # v1.0-launched
  # v1.1-brand-revision
```

Every change to a prompt template, brand guideline, or agent configuration gets committed. If an improvement proposal goes wrong, we can `git revert` to the previous working state.

### Addition 6: Nondeterministic Testing Strategy

Traditional testing assumes fixed inputs → fixed outputs. Agent systems are nondeterministic — the same prompt can produce different outputs each time. Our testing needs to account for this.

**For EVE, this means:**

- **Behavioral testing, not output testing.** Don't check "did the agent write exactly these words?" Check "did the agent produce a product description that is under 50 words, mentions the brand name, includes a CTA, and matches the brand voice?"
- **Evaluation rubrics.** For each agent type, define what "good output" looks like as a checklist, not a fixed expected output. Brand Agent evaluates creative output against the rubric.
- **Regression testing.** After any prompt change, run the same 5 test tasks and compare quality scores. If quality drops, rollback.
- **A/B prompt testing.** When the Improvement Engine proposes a prompt change, run both the old and new prompt on the same task and compare results before committing.

## Revised Confidence Level

After this research validation, here's my confidence in each phase of the workflow:

| Phase | Confidence | Notes |
|---|---|---|
| 0: The Idea | 95% | Conversational intake is proven across every platform |
| 1: Evaluation | 90% | 7-question framework is solid; add competitor ad research |
| 2: Floor Creation | 95% | Standard agent registration pattern |
| 3: Foundation Sprint | 90% | Multiple brand options is validated; add mood board generation |
| 4: Parallel Buildout | 85% | Dependency management is the hardest part; needs real testing |
| 5: Staging + Launch | 90% | QA checklist is comprehensive; add GEO verification |
| 6: Ad Activation | 90% | Per-campaign approval is the right pattern |
| 7: First 72 Hours | 85% | Add proactive commerce agent for website visitors |
| 8: Ongoing Operations | 80% | Content pipeline needs real-world tuning; add GEO monitoring |
| 9: Scaling | 85% | 20%/week rule is validated; add machine-to-machine readiness |
| 10: Multi-Floor | 80% | Cross-floor intelligence is conceptually right; needs testing |
| 11: Improvement | 75% | Most novel part of the system; needs careful design and testing |

**Overall: the workflow is architecturally sound.** The six additions above strengthen it. The biggest risk areas are Phase 4 (parallel dependency management is complex) and Phase 11 (self-improvement is novel and needs careful safety guardrails).
