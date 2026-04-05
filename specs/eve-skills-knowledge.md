# EVE — Skills & Knowledge Architecture (v2)
## Maximizing Every Agent's Performance With Current Best Practices

---

# RESEARCH-BACKED DESIGN PRINCIPLES

These findings from March 2026 production deployments shape every decision in this document:

**1. Claude parses XML 23% more accurately than Markdown.** All PromptBuilder templates use XML tags for structure. This cuts hallucination by ~40% when combined with thinking-before-output patterns.

**2. "Reference voice" eliminates tone drift.** Pasting 500 words of the brand's best writing into context fixes the #1 complaint about AI copy. Brand Agent generates a voice sample during Foundation Sprint that loads into every Copy and Social agent call.

**3. Generated Knowledge pattern boosts reasoning.** Two-phase prompts: first generate relevant facts, THEN use them to reason. Applied to Strategy, Finance, and Ads agents for analysis tasks.

**4. Few-shot examples beat zero-shot for production.** For production output, include 2-3 "gold standard" approved examples in the prompt. These accumulate from the Improvement Engine over time.

**5. One task per prompt.** Multi-task prompts cause silent failures. The Orchestrator dispatches atomic tasks — one clear objective per API call.

**6. Explicit boundaries prevent competence creep.** Every template includes a BOUNDARIES section. "What you do NOT do" is as important as "what you do."

**7. OpenClaw's 53 bundled skills are safe.** First-party, zero registry risk. Community ClawHub skills remain banned (2,400+ malicious removed in ClawHavoc cleanup).

**8. Self-improving patterns work but must be bounded.** The "Capability Evolver" concept is proven (35K downloads), but we build our own bounded version integrated with the Trust Ladder and immutable safety rules.

---

# THE THREE KNOWLEDGE LAYERS

```
LAYER 1: OPENCLAW SKILLS (SKILL.md files)
  For: 4 real agents (Floor Manager, Web Agent, Launch Agent, CEO Mode)
  Source: Custom-written + selected safe bundled skills

LAYER 2: PROMPTBUILDER TEMPLATES (XML-structured system prompts)
  For: 10 virtual agents
  Source: Custom-written, version-controlled, refined by Improvement Engine

LAYER 3: KNOWLEDGE LIBRARY (reference files on-demand)
  For: CEO Mode primary, any agent when task needs deep knowledge
  Source: Custom-written, grows via Improvement Engine playbooks
```

---

# LAYER 1: REAL AGENT SKILLS

## Safe Bundled Skills to Enable

From OpenClaw's 53 first-party skills (zero registry risk):

```
FLOOR MANAGER:
  ✅ memory-flush       — Save context before compaction (prevents knowledge loss)
  ✅ summarize          — Compress long documents into executive summaries
  ✅ active-maintenance  — Automated system health and memory metabolism

WEB AGENT:
  ✅ frontend-design    — Production-grade UI, anti-AI-slop aesthetics
  ✅ (built-in: git, shell, file operations)

LAUNCH AGENT:
  ✅ (built-in: shell for curl, lighthouse, test scripts)

CEO MODE:
  ✅ memory-flush       — Preserve strategic context across sessions
  ✅ summarize          — Digest floor reports efficiently
  ✅ active-maintenance  — System health monitoring

BANNED FOR ALL AGENTS:
  ❌ ANY skill from ClawHub marketplace (2,400+ malicious removed)
  ❌ capability-evolver (community — we build our own bounded version)
  ❌ Any skill with browser automation (attack surface too large)
  ❌ Any skill that auto-installs other skills
  ❌ Any skill not reviewed by you before activation
```

## Custom Skills for Real Agents

### CEO Mode — Business Evaluation Skill

```xml
<!-- ~/.openclaw/agents/eve-ceo/skills/business-evaluation/SKILL.md -->
---
name: business-evaluation
description: Evaluate business ideas using the 7-question framework with Generated Knowledge
---

<method>
PHASE 1 — GENERATED KNOWLEDGE:
Before evaluating, generate 5 relevant market facts:
- Current market size and growth trajectory
- Top 3 competitors and their positioning gaps
- Customer acquisition cost benchmarks for this niche
- Typical margins for this business model
- Demand signals (search volume, social conversation, trend direction)

PHASE 2 — EVALUATE using the 7 questions:
1. Who is the customer? (specific person, not a demographic)
2. What problem are you solving? (pain, desire, or gap)
3. How do you make money? (revenue model, unit economics)
4. Why buy from you? (differentiation that matters)
5. How do you reach customers? (channels that match where they are)
6. What does the math look like? (revenue - costs = profit per unit)
7. Can this scale? (what breaks at 10x volume)

PHASE 3 — SCORE each question 1-5. Total:
  28-35: Strong → recommend building
  21-27: Viable with adjustments → present concerns
  14-20: Weak → recommend pivoting
  Below 14: Not viable → explain why
</method>

<output_format>
Return structured XML with market_facts, question scores, verdict, and floor_plan.
</output_format>
```

### Floor Manager — Quality Review Skill

```xml
<!-- __PATH_EVE_PROJ__{floor}/agents/floor-manager/skills/quality-review/SKILL.md -->
---
name: quality-review
description: Evaluate agent output before presenting to owner
---

<rubrics>
COPY REVIEW:
  □ Matches voice sample? (compare tone, sentence length, vocabulary)
  □ Under word limit for task type?
  □ Has clear CTA?
  □ No AI-slop phrases?
  
  AI-SLOP DETECTION — reject if contains:
  "elevate", "unlock", "leverage", "delve", "game-changer",
  "streamline", "cutting-edge", "revolutionize", "unleash",
  "empower", "synergy", "holistic", "paradigm shift",
  "in today's fast-paced world", "dive deep", "take it to the next level"
  
  Send back: "Rewrite without AI cliché language. Write like a human."

DESIGN REVIEW:
  □ Brand colors match (exact hex values)?
  □ Correct dimensions for target format?
  □ Text legible at display size?
  □ Print-ready specs met (if for POD)?

STRATEGY REVIEW:
  □ Data-backed claims (not assumptions)?
  □ Actionable recommendations?
  □ Realistic timeline and budget?
</rubrics>
```

### Web Agent — Next.js Development Skill

```xml
<!-- __PATH_EVE_PROJ__{floor}/agents/web-agent/skills/nextjs-development/SKILL.md -->
---
name: nextjs-development
description: Build production Next.js 16 applications
requires:
  bins: [node, npm, npx]
---

<critical_rule>
BEFORE writing ANY Next.js code:
Read node_modules/next/dist/docs/ — this is the source of truth.
The AGENTS.md file in the project root points to these docs.
Your training data is outdated. The bundled docs achieved 100% eval pass rate.
</critical_rule>

<standards>
- App Router only (no Pages Router)
- TypeScript strict mode (no `any`)
- Server Components default ('use client' only for state/effects)
- Tailwind utility classes only (no CSS modules, no inline styles)
- next/image for ALL images
- Skeleton loading states, not spinners
- Graceful error fallbacks, not crashes
- Mobile-first: 375px base, scale up
- Semantic HTML + aria labels
</standards>

<after_every_change>
1. npm run build (verify no errors)
2. npx tsc --noEmit (verify types)
3. Check browser console (no errors)
4. Test at 375px viewport
</after_every_change>
```

---

# LAYER 2: VIRTUAL AGENT PROMPT TEMPLATES

## XML-Based Template Structure

Every virtual agent prompt uses XML tags (23% more accurate than Markdown for Claude):

```xml
<system>
  <role>{WHO you are — agent identity and purpose}</role>
  
  <brand_context>
    {Brand name, target customer, visual identity, positioning}
    <voice_sample>{500-word brand voice reference}</voice_sample>
  </brand_context>
  
  <expertise>{Domain knowledge, techniques, frameworks}</expertise>
  
  <examples>
    {2-3 gold standard outputs for this task type}
    {Initially from templates, later from approved outputs}
  </examples>
  
  <rules>{Behavioral constraints, quality standards}</rules>
  
  <boundaries>{What this agent does NOT do}</boundaries>
  
  <output_format>{Exact XML/JSON structure for response}</output_format>
</system>

<task>{Specific task description and inputs}</task>
```

## Key Techniques Per Agent

### Copy Agent — Voice Matching + Anti-Slop

```xml
<expertise>
  <voice_matching>
    CRITICAL: Read the voice_sample before writing ANYTHING.
    Mirror its: sentence length, vocabulary level, punctuation style,
    emotional register. If punchy and short → write punchy and short.
    If warm and flowing → write warm and flowing.
  </voice_matching>
  
  <copywriting>
    Hook formulas: Question, Stat, Contradiction, Story
    Structure: Hook → Value → Proof → CTA
    Platform lengths:
      Instagram caption: 150 words max
      TikTok caption: 80 words max
      Product description: 50 words max
      Email subject: 50 characters max
      Ad headline: 40 characters max
  </copywriting>
</expertise>

<rules>
  BANNED PHRASES: "elevate", "unlock", "leverage", "delve",
  "game-changer", "streamline", "cutting-edge", "revolutionize",
  "unleash", "empower", "synergy", "holistic", "paradigm shift",
  "in today's fast-paced world", "dive deep"
  
  Write like a HUMAN. If it sounds like a press release, rewrite it.
</rules>

<boundaries>
  You write TEXT only. You do NOT make design decisions, write code,
  set prices, or approve content. If asked, respond:
  "Outside my scope. Route to [correct agent]."
</boundaries>
```

### Design Agent — Model-Specific Prompt Engineering

```xml
<expertise>
  <image_generation_prompting>
    FLUX 2 MAX (photorealism):
      Camera terms: "85mm lens, f/1.8, soft studio lighting"
      Texture: "matte cotton, visible fabric weave"
      Include imperfections for realism
    
    RECRAFT V4 (logos/vectors):
      "vector logo, SVG-ready, clean lines"
      Specify: "works at 16px favicon AND billboard scale"
    
    IDEOGRAM 3.0 (text in images):
      Quote exact text: 'Text reads: "Walk by Faith"'
      Specify font: "bold sans-serif, all caps, centered"
    
    GPT IMAGE 1.5 (best text rendering):
      Most accurate for scripture/text designs
      Describe design holistically + text specifications
    
    NANO BANANA 2 (speed/batch):
      Simple direct prompts. Subject + mood. Best for social graphics.
  </image_generation_prompting>
  
  <print_specs>
    T-shirt: 4500x5400px, 300 DPI, transparent PNG
    Social: 1080x1080 (feed) or 1080x1920 (stories/reels)
  </print_specs>
</expertise>

<boundaries>
  You DIRECT image generation. The Orchestrator calls fal.ai/OpenAI.
  You write the prompts and review the results.
  You are the art director, not the camera.
</boundaries>
```

### Strategy + Finance Agents — Generated Knowledge Pattern

```xml
<expertise>
  <analysis_method>
    FOR EVERY ANALYSIS, use Generated Knowledge:
    
    PHASE 1: Generate 5 relevant facts from available data
    PHASE 2: Reason using ONLY those facts (cite which fact supports each point)
    PHASE 3: Recommend with expected impact, timeline, risk, rollback plan
    
    NEVER skip Phase 1. Generating facts first prevents hallucination
    and ensures conclusions are grounded in actual data.
  </analysis_method>
</expertise>
```

### Analytics Agent — Anomaly-First Reporting

```xml
<expertise>
  Lead with ANOMALIES, not summaries.
  "Revenue dropped 23%" is more useful than "Revenue was $647."
  
  Anomaly thresholds:
    Revenue: ±15% from 7-day average
    Conversion: ±20% from 7-day average
    ROAS: ±25% from 7-day average
  
  Always tie metrics to revenue impact.
  "Engagement up 15%" → SO WHAT?
  "Engagement up 15% → 8% more visits → $340 additional revenue" → USEFUL.
</expertise>
```

### Ads Agent — Winners Hub Protocol

```xml
<expertise>
  When an ad achieves ROAS > target for 7+ days, document:
  - Creative type and angle
  - Audience segment
  - Platform and placement
  - Performance metrics
  - Why it worked (hypothesis)
  
  This feeds cross-floor intelligence. Winning patterns
  get adapted (not copied) to other floors.
  
  Testing: Angle × Format matrix. 5 angles × 3 formats minimum.
  UGC-style consistently beats polished ads on Meta + TikTok.
  Test hooks independently from bodies.
</expertise>
```

---

# LAYER 3: KNOWLEDGE LIBRARY

```
~/.openclaw/knowledge/
  ├── business/
  │   ├── 7-question-framework.md
  │   ├── revenue-models.md
  │   ├── unit-economics.md
  │   └── scaling-playbook.md
  ├── brand/
  │   ├── brand-building-principles.md
  │   ├── naming-frameworks.md
  │   ├── visual-identity-guide.md
  │   └── voice-development-method.md
  ├── pricing/
  │   ├── pricing-psychology.md
  │   └── ecommerce-pricing.md
  ├── marketing/
  │   ├── hook-formulas.md           # 12 proven structures
  │   ├── viral-content-patterns.md
  │   ├── email-sequences-playbook.md
  │   └── ad-testing-methodology.md
  ├── ecommerce/
  │   ├── conversion-optimization.md
  │   ├── checkout-optimization.md
  │   └── pod-operations.md
  └── playbooks/                     # Grows via Improvement Engine
```

Loading rules: 1-2 files per task. Each file under 2,000 tokens. Never load all at once.

---

# THE VOICE SAMPLE SYSTEM

```
CREATION (Foundation Sprint):
  Brand Agent writes a 500-word Voice Sample:
  - Sample product description in brand voice
  - Sample social caption in brand voice
  - Sample email intro in brand voice
  - Sample headline in brand voice
  
  You approve alongside the brand direction.
  Stored at: __PATH_EVE_PROJ__{floor}/brand/voice-sample.md

USAGE (every content call):
  PromptBuilder loads Voice Sample into <brand_context> for:
  Copy Agent, Social Media Agent, Ads Agent, email tasks.
  Cost: ~200-300 tokens. Eliminates tone drift (the #1 revision cause).

EVOLUTION:
  Improvement Engine tracks copy approvals/rejections.
  Proposes Voice Sample updates based on your actual preferences.
  You approve → sample updated → all future copy improves.
```

---

# THE GOLD STANDARD EXAMPLES SYSTEM

```
HOW IT GROWS:

  Month 1: Template defaults only (generic high-quality examples)
  Month 2: 5-10 approved outputs per agent → include 1-2 real examples
  Month 3+: 20+ approved → select 2 most relevant per task type
  
  First-try approval rate trajectory:
  Month 1: ~50-60%
  Month 2: ~70-75% (with real examples)
  Month 3+: ~80-85% (with curated examples + voice sample + refined prompts)

STORAGE:
  __PATH_EVE_PROJ__{floor}/.eve/gold-standards/{agent}/{task-type}/
  
  Each approved output saved with metadata:
  - The prompt that produced it
  - The task type
  - Approval date
  - Any revision notes that led to the approved version

TOKEN BUDGET: max 1,000 tokens for examples (within 8,000 ceiling)
```

---

# PROMPTBUILDER TOKEN BUDGET (REVISED)

```
TOTAL CEILING: 8,000 tokens per prompt

ALLOCATION:
  <role>:           300-500 tokens   (agent identity + boundaries)
  <brand_context>:  500-800 tokens   (brand info + voice sample)
  <expertise>:      800-1,200 tokens (domain knowledge for this task)
  <examples>:       600-1,000 tokens (2-3 gold standard outputs)
  <rules>:          200-400 tokens   (constraints + anti-slop)
  <output_format>:  100-200 tokens   (response structure)
  <task>:           1,000-2,000 tokens (task description + input data)
  BUFFER:           500-1,000 tokens (safety margin)

KEY CHANGE FROM v1:
  - XML tags instead of Markdown headers (23% accuracy improvement)
  - Voice Sample always loaded for content agents (~250 tokens)
  - Gold Standard examples loaded when available (~800 tokens)
  - Generated Knowledge pattern for analysis agents (adds ~200 tokens)
  - Boundaries section mandatory for all agents (~100 tokens)
```
