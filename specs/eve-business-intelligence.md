# EVE — Business Intelligence & CEO Mode Knowledge

This defines what EVE knows about building businesses. The other spec files tell EVE HOW to operate. This file gives EVE the intelligence to make smart business decisions.

## Knowledge Architecture

**Two layers:**

1. **Core knowledge** — permanently embedded in CEO Mode's system prompt. Concise reasoning frameworks, always loaded.

2. **Deep knowledge** — stored as reference files that CEO Mode and agents read when working on specific tasks. Detailed playbooks loaded only when relevant.

---

## Part 1: Core Knowledge (in CEO Mode's system prompt)

### Business Model Design

Every business must answer 7 questions before anything gets built:

1. **Who is the customer?** — Specific person, not a demographic. Age, income, problems, desires, where they spend time, what frustrates them about current options.
2. **What problem are you solving?** — Not what you're selling. What pain, desire, or gap exists.
3. **How do you make money?** — Revenue model. Product sales, subscriptions, digital, services. How much per transaction. How often.
4. **Why buy from you?** — Differentiation. Price, quality, speed, brand, experience, niche focus. If the answer is "nothing," the business won't work.
5. **How do you reach customers?** — Acquisition channels. Which ones match where the target customer spends time.
6. **What does the math look like?** — Revenue per customer minus COGS minus acquisition cost minus operating costs = profit per customer. Negative = doesn't work at any scale.
7. **Can this scale?** — What happens at 10x volume? Does fulfillment break? Do margins compress?

### Market Evaluation

**Demand signals:** Search volume, social conversation, competitor presence, trend direction (growing/stable/declining)

**Competition:** Top 3-5 competitors, what they do well, weaknesses, pricing gaps, how they acquire customers, underserved segments they ignore

**Opportunity:** Can we differentiate meaningfully? Market big enough for the revenue target? Timing right? Barrier to entry?

### Pricing Psychology

- **Anchoring:** Higher-priced option first makes the target price feel reasonable
- **Charm pricing:** $29 feels cheaper than $30 (left-digit effect)
- **Bundles:** 15-25% savings vs individual items
- **Three-tier:** Good/Better/Best — most people pick the middle
- **Free shipping threshold:** Set just above AOV to encourage add-ons
- **Scarcity and urgency:** Limited editions, seasonal, countdowns — use sparingly and honestly
- **Price on value, not cost:** A $5 ornament that makes their tree look magazine-worthy is worth $25

### Brand Building Principles

- A brand is a **feeling**, not a logo. Every touchpoint creates the feeling. Consistency is everything.
- **Pick a lane.** Luxury OR affordable. Playful OR serious. Trying to be everything makes you nothing.
- **The best brands have an enemy.** Not a competitor — an idea. Nike vs laziness. Apple vs complexity.
- **Voice > visuals.** You can redesign a website in a week. Inconsistent voice makes the brand feel broken.
- **Consistency beats creativity.** Mediocre brand applied consistently beats brilliant brand applied inconsistently.
- **Premium is about restraint.** More whitespace, fewer words, fewer colors, fewer products. Scarcity of elements signals quality.

### Growth Strategy (default path for every floor)

```
Phase 1: VALIDATE (Week 1-2)
  Launch with 5-15 products. $20-50/day ad budget.
  Track: are people buying? What conversion rate? What CPA?
  If yes → proceed. If no → pivot before investing more.

Phase 2: OPTIMIZE (Week 3-6)
  A/B test checkout, product pages, CTAs.
  Kill losing ads, scale winners. Test pricing.
  Target: ROAS above 3x, net margin above 20%.

Phase 3: SCALE (Week 7+)
  Follow scaling rules in EVE-POST-LAUNCH.md.
  20%/week ad budget increases while ROAS holds.
  New audiences, platforms, content formats, products.

Phase 4: SYSTEMIZE (Month 3+)
  Content on autopilot. Ads optimized daily.
  Customer journey automated. FM handles day-to-day.
  You review weekly reports. CEO Mode monitors cross-floor.
```

### Ecommerce Intelligence

**Product selection:** Small, lightweight, high perceived value, low return rate. Sweet spot $25-75. Test 5-15 products, expand based on what sells.

**Conversion optimization:** Multiple product photos, short descriptions, social proof (reviews), scarcity signals, clear CTA. Under 3 checkout steps. Guest checkout. Mobile-first (70%+ traffic is mobile).

**AOV optimization:** Upsells ("complete the look"), cart upsells ("add X for $Y more"), free shipping threshold above AOV, bundle discounts. Target +20-30% AOV.

### Content Strategy Per Platform

- **Instagram Reels:** Aspirational, aesthetic, satisfying. 7-15 seconds. First frame is everything.
- **TikTok:** Raw, authentic, trend-driven, storytelling. 15-30 seconds. Hook in 1 second.
- **Facebook:** Longer storytelling, emotional triggers, community. 35+ demographic. Retargeting gold.
- **Instagram Carousels:** Educational, swipe-through value. 7-10 slides. Highest save rate.
- **Instagram Stories:** Behind-the-scenes, polls, questions, urgency. Ephemeral.

**80/20 rule:** 80% value content (entertaining, educational, inspiring). 20% selling content. The 80% earns the right to do the 20%.

**Algorithm signals:** Watch time, saves (strongest on Instagram), shares (biggest distribution boost), comments (first 30 min matters most), profile visits after viewing.

### Financial Modeling

**Key metrics every floor tracks:** Revenue, gross margin, net margin, CAC, LTV, LTV:CAC ratio, ROAS, break-even point, burn rate.

**Healthy benchmarks:**
- Gross margin: 50%+ physical, 70%+ digital
- Net margin: 20%+ after all expenses
- ROAS: 3x+ for sustainable paid acquisition
- LTV:CAC: 3:1+ minimum
- Break-even: within 30 days for ecommerce
- Conversion rate: 2-4% (above 4% is excellent)

**Red flags (CEO Mode alerts):**
- ROAS below 2x for 7+ days
- Net margin below 10%
- CAC exceeding LTV
- Conversion rate below 1%
- Revenue declining 3+ consecutive weeks
- Ad spend increasing while revenue flat

---

## Part 2: Deep Knowledge (Reference Files)

Detailed playbooks CEO Mode and agents load on demand. Not always in context.

```
eve/knowledge/
  business-models/
    ecommerce-playbook.md
    digital-products-playbook.md
    service-business-playbook.md
    subscription-playbook.md

  market-analysis/
    competitor-research-template.md
    demand-validation-checklist.md
    niche-evaluation-framework.md

  brand/
    brand-archetype-guide.md
    naming-framework.md
    voice-development-guide.md

  pricing/
    pricing-strategies-deep.md
    psychology-of-pricing.md
    competitive-pricing-analysis.md

  growth/
    paid-acquisition-playbook.md
    organic-growth-playbook.md
    email-marketing-playbook.md
    influencer-strategy.md

  conversion/
    landing-page-optimization.md
    checkout-optimization.md
    product-page-framework.md
    ab-testing-guide.md

  content/
    viral-content-frameworks.md
    platform-algorithm-guide.md
    content-repurposing-guide.md
    ugc-strategy.md

  finance/
    unit-economics-calculator.md
    financial-projection-template.md
    cash-flow-management.md
```

CEO Mode reads relevant files per task. Creating an ecommerce floor? → `ecommerce-playbook.md` + `pricing-strategies-deep.md`. Setting up content? → `viral-content-frameworks.md` + `platform-algorithm-guide.md`.

---

## Part 3: The PromptBuilder Pipeline

How knowledge flows from files into agent brains:

```
SKILL REGISTRY (skill catalog)
  + BUSINESS INTELLIGENCE (this file)
  + FOUNDATION PACKAGE (floor-specific brand, strategy, customer)
  + CURRENT TASK (what the agent needs to do right now)
      │
      ▼
  PROMPT BUILDER
      │
      │  Assembles a complete system prompt:
      │
      │  [ROLE] — who this agent is
      │  [MODEL] — Opus / Sonnet / Haiku
      │  [BRAND CONTEXT] — from Foundation Package
      │  [SKILL KNOWLEDGE] — extracted from assigned SKILL.md files
      │  [BUSINESS INTELLIGENCE] — relevant frameworks from this file
      │  [REFERENCE KNOWLEDGE] — deep knowledge if task requires it
      │  [CURRENT TASK] — specific assignment from Floor Manager
      │  [WORKSPACE CONTEXT] — what outputs exist
      │  [RULES] — terminal tier, approval rules, collaboration rules
      │
      ▼
  ANTHROPIC API CALL (via OpenClaw)
      │
      │  model: claude-opus-4-6 / claude-sonnet-4-6 / claude-haiku-4-5
      │  system: [the assembled prompt]
      │  messages: [conversation history]
      │
      ▼
  AGENT OUTPUT → shared workspace
```

### Prompt size management

- **Always included:** Role, brand context, current task, rules (~2,000 tokens)
- **Per assignment:** Skill knowledge (~1,000-3,000 tokens per skill, max 3)
- **When relevant:** Business intelligence frameworks (~500-1,500 tokens)
- **On demand:** Deep knowledge reference files (~1,000-3,000 tokens)
- **Target:** Under 8,000 tokens total. Prioritize: Role > Task > Brand > Skills > Intelligence > References

---

## Part 4: Knowledge Updates

**From playbook library:** Winning strategies from one floor get extracted and added to reference files. Knowledge improves from real results.

**From performance data:** Finance Agent and Analytics Agent data reveals what actually works. Benchmarks adjust upward when floors consistently exceed them.

**From you:** When you give direction that reveals preferences ("I want all my brands to feel premium"), CEO Mode incorporates it into future decisions.

**The knowledge base is a living system, not a static document.**
