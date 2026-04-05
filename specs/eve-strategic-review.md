# EVE — Comprehensive Strategic Review
## Stress-Testing Every Major Decision

---

# PURPOSE

This isn't a document audit — it's a hard look at whether our architecture, workflows, and assumptions will survive contact with reality. Based on fresh research into OpenClaw production deployments, multi-agent scaling challenges, and what's actually failing in 2026.

---

# 🔴 CRITICAL ISSUES (Must Address Before Building)

## ISSUE 1: OpenClaw Multi-Agent Scaling Reality

**What we designed:** 13 agents per floor, all running through OpenClaw with heartbeats, parallel execution, and inter-agent coordination.

**What production evidence shows:**
- "Fewer than 10% of teams successfully scale beyond a single-agent deployment" (LumaDock, March 2026)
- "Unoptimized multi-agent deployments leading to $3,600+ monthly bills" (ClawFlow project)
- "Most developers running AI agents make the same mistake: they jump straight to complex multi-agent architectures before understanding what a single agent actually needs"
- "If you're orchestrating it by hand, it's not really a multi-agent system — it's just multiple chatbots"

**The uncomfortable truth:** We designed a 13-agent system on paper without proving a single agent works first. The best practitioners in the OpenClaw community explicitly say: "Build individual agents, verify they work, then add coordination."

**RECOMMENDATION:**
Phase 0 should NOT be "set up 13 agent templates." It should be:
1. Get ONE agent (Floor Manager) working reliably on OpenClaw
2. Add a second agent (Brand Agent) and prove they can coordinate
3. Add a third (Copy Agent) and prove the three-agent foundation works
4. THEN expand to the full roster, one agent at a time

This changes our Phase 0-2 timeline but dramatically reduces the risk of building an architecture that collapses under its own complexity.

## ISSUE 2: API Rate Limits Will Kill 13 Simultaneous Opus Agents

**What we designed:** 6 Opus agents running simultaneously during the build phase, each on heartbeats.

**What production evidence shows:**
- "If you're seeing 'API Error: Rate limit reached' while running OpenClaw sessions — especially during long agentic workflows — you're not alone. Rate limit errors are one of the top friction points for OpenClaw users in 2026."
- "As of early 2026, many developers report Anthropic's Opus quotas are effectively tighter than in late 2025"
- "OpenClaw agents typically chain 10–50 API calls per complex task"
- Monthly cost for a single Claude Opus 4.6 agent with heartbeats: ~$188/month. Six Opus agents: ~$1,128/month JUST for heartbeats.

**The math doesn't work at our $200 test ceiling.** Six Opus agents with heartbeats would blow the budget in 5-6 days before producing any actual work.

**RECOMMENDATION:**
1. **Only Floor Manager gets a heartbeat.** All other agents are dispatched on-demand by the Floor Manager (this is already in our spec but needs to be enforced rigorously).
2. **Aggressive model tiering.** Move more agents to Sonnet. The difference between Opus and Sonnet has narrowed significantly. Brand Agent and Strategy Agent probably don't need Opus for every task — use Opus for foundation sprint, Sonnet for ongoing operations.
3. **Budget the heartbeat cost separately.** Floor Manager heartbeat at 5-minute intervals on Opus during build = ~$50-80/month. Account for this explicitly in the budget.
4. **Consider model routing.** Route routine agent tasks through cheaper models (Sonnet or even Haiku for simple lookups), save Opus for complex reasoning. The TeamoRouter pattern from the OpenClaw community does this.

## ISSUE 3: Inter-Agent Communication Is Primitive in OpenClaw

**What we designed:** Agents sharing workspace files, Floor Manager coordinating, agents reading each other's outputs.

**What production evidence shows:**
- Inter-agent communication in OpenClaw is basically "passing text over an internal channel"
- "For the scope of initial setup, we recommend keeping agents logically separate — essentially serving as parallel specialists rather than a tightly coupled team"
- There's no built-in "message_agent(agent_id, content)" tool yet — it's proposed as a future feature
- File-based coordination (shared workspace) is the recommended pattern

**GOOD NEWS:** Our shared workspace approach (agents write to files, other agents read those files) is actually the recommended pattern for OpenClaw multi-agent coordination. We got this right.

**BAD NEWS:** The "Floor Manager dispatches tasks and agents report back" pattern requires more custom orchestration code than we initially assumed. The Orchestrator (our custom TypeScript layer) is more important than we thought — it's not supplementary to OpenClaw, it's the critical coordination layer.

**RECOMMENDATION:**
1. The Orchestrator is the most important piece of code we build. It needs to be rock-solid before we add agents.
2. Inter-agent coordination should be strictly file-based (not real-time messaging). Agent A writes output → Orchestrator detects completion → Orchestrator dispatches Agent B.
3. Build the Orchestrator in Phase 1 (not Phase 2 as currently planned). PromptBuilder is important but the Orchestrator is the foundation everything depends on.

## ISSUE 4: Security Vulnerabilities in OpenClaw Ecosystem

**What we designed:** Agents with terminal access, API integrations, and ability to deploy code.

**What production evidence shows:**
- "In February 2026, security researchers discovered 341 malicious skills on ClawHub designed to steal credentials via prompt injection and hidden payloads"
- "Because OpenClaw grants LLMs direct access to operating system commands and external APIs via skill.md files, it became a prime target for attackers"
- "Run it in isolation. Use a dedicated device or VM, not your primary machine. If something goes wrong, you want a kill switch you can physically reach."

**Our mitigation:** We already have a 3-tier terminal access system in the security spec. But we need to be even more paranoid.

**RECOMMENDATION:**
1. Run EVE on the Mac Mini with NO personal data. Dedicated machine only.
2. Use OpenClaw's sandbox mode for all agents except Floor Manager.
3. No skills from ClawHub — only custom skills we write ourselves.
4. Agent API keys should be scoped to minimum permissions needed.
5. All external API calls must go through the Orchestrator, not directly from agents.

---

# 🟡 SIGNIFICANT CONCERNS (Should Address During Phase 0-1)

## CONCERN 5: Token Cost Management

**Evidence:** "Token costs in multi-agent systems scale with the number of agents, the verbosity of inter-agent communication, and how much context each agent carries."

**Key optimization from research:**
- "Keep specialists stateless. No persistent memory, no history across tasks. Each run starts clean. This is the biggest single lever for controlling costs."
- "Summarize before storing. Write concise summaries, not transcripts."
- "Return structured output, not prose summaries."

**Impact on our design:**
Our PromptBuilder already manages context loading. But we need to be MORE aggressive about:
1. Specialist agents (Copy, Design, Web, etc.) should be stateless — no conversation history between tasks. Clean context every dispatch.
2. The Floor Manager is the only agent that maintains state across tasks.
3. Agent outputs should be structured JSON, not prose. The Floor Manager converts to human-readable when needed.
4. The PromptBuilder's 8,000 token ceiling is the right constraint, but enforce it strictly.

## CONCERN 6: "Competence Creep" — Agents Doing Things Outside Their Scope

**Evidence:** From the GitHub issue on OpenClaw scaling: "avoiding 'competence creep' (agents doing things outside their scope)" is one of the top challenges.

**Risk for EVE:** Brand Agent starts writing code. Copy Agent starts making design decisions. Agents gradually drift beyond their defined roles.

**Our mitigation:** SOUL.md files define each agent's role. But do they explicitly say what agents should NOT do?

**RECOMMENDATION:**
Add a "BOUNDARIES" section to every SOUL.md template:
```
## BOUNDARIES
You are the Copy Agent. You write text.
You do NOT:
- Make design decisions (visual style, colors, layout)
- Write or modify code
- Make pricing decisions
- Approve content (that's Brand Agent's job)
- Communicate directly with the human owner (that's Floor Manager's job)
If a task falls outside your role, respond with:
"This task is outside my scope. Recommend routing to [Agent Name]."
```

## CONCERN 7: Build Phase Duration May Be Optimistic

**What we estimated:** 8-10 days from idea to first sale.

**Reality check:** This assumes:
- All 13 agents work correctly on first deployment
- No rate limiting interruptions
- Foundation Sprint produces usable output in 2-4 hours
- Website build completes in 5-7 days
- POD integration works first try
- Stripe integration works first try

For the FIRST floor ever built by EVE (before the system has learned anything), 3-4 weeks is more realistic. The 8-10 day estimate may be achievable for the second or third floor, once patterns are established.

**RECOMMENDATION:** Set expectations honestly:
- First floor: 3-4 weeks (includes debugging, iteration, learning)
- Second floor: 2-3 weeks (patterns established)
- Third+ floor: 8-14 days (system is proven and optimized)

## CONCERN 8: Dependency on Kit (ConvertKit) for Email

**Research finding:** Kit (ConvertKit) recently rebranded and has limitations for ecommerce:
- "While Kit offers an abandoned cart template, it requires manual setup with integrated stores rather than working out of the box"
- "If you need purchase behavior segmentation, multichannel campaigns, or enterprise-level personalization" → Kit falls short
- Klaviyo or Omnisend are better for ecommerce-specific email automation

**Our spec says:** Resend (transactional) + Kit/ConvertKit (marketing).

**RECOMMENDATION:**
For EVE v1, Kit works fine — it has a good API, it's simple, and it handles the basics. But document this as a known upgrade path: if a floor scales beyond 500+ customers, evaluate Klaviyo or Omnisend for more advanced ecommerce segmentation.

## CONCERN 9: No Disaster Recovery / Backup Plan

**Not covered anywhere in our specs:**
- What happens if the Mac Mini crashes?
- What happens if Supabase has an outage?
- What happens if Anthropic is down for 6 hours?
- What happens if a floor's website goes down at 2am?

**RECOMMENDATION:**
Add to supplementary specs:
1. **Mac Mini:** Automated daily backup of __PATH_EVE_PROJ__ to cloud storage (iCloud, Backblaze B2, or similar). Git repos are the primary backup, but config files and databases need separate backup.
2. **Supabase:** Automatic point-in-time recovery (built into Supabase). Document restore procedure.
3. **Anthropic down:** Floor Manager detects API errors → pauses all agents → sends you a notification → auto-resumes when API recovers. No human action needed unless outage > 4 hours.
4. **Website down:** Vercel has 99.99% uptime. If Vercel is down, the whole internet has problems. But: set up uptime monitoring (UptimeRobot or Vercel's built-in) → alert if site is down > 5 minutes.

## CONCERN 10: The "FaithForge" Example May Not Be the Best Test Floor

We've been designing around a faith-based urban clothing brand as the example throughout all specs. But for a TEST floor with a $200 ceiling:

- POD products have thin margins ($16/shirt) — hard to prove profitability at test scale
- Need to generate 15+ unique shirt designs before launch (creative-heavy)
- Ad budget needed ($1,500/month) far exceeds test ceiling
- Competition in faith/streetwear is moderate but real

**A simpler test floor might be better for proving the system works:**
- Digital product (no fulfillment complexity)
- Service business (no inventory, higher margins)
- Simple POD with 3-5 designs (not 15)

**RECOMMENDATION:** When you reach Phase 2, pick the test floor based on simplicity, not passion. The first floor's job is to prove EVE works, not to be your dream business. Dream businesses come after the system is proven.

---

# 🟢 THINGS WE GOT RIGHT (Confirmed by Research)

1. **File-based coordination** — the recommended OpenClaw pattern for multi-agent setups ✅
2. **Floor Manager as single coordinator** — matches the "orchestrator pattern" that works best ✅
3. **Lobster for deterministic pipelines** — keeps predictable steps out of LLM decision-making ✅
4. **Sub-agents on Haiku** — cost-efficient, matches the "stateless specialist" pattern ✅
5. **Trust Ladder (progressive autonomy)** — aligns with "add autonomy in layers" best practice ✅
6. **Terminal tier system** — more granular than most deployments, which is good ✅
7. **Git-versioned workspace** — exactly what the community recommends for state management ✅
8. **PromptBuilder with token budgets** — controls context bloat, the #1 cost driver ✅
9. **Brand Agent as quality gate** — matches "reviewer agent" pattern ✅
10. **Shared workspace with structured outputs** — the right file-based coordination approach ✅

---

# REVISED IMPLEMENTATION STRATEGY

Based on all findings, here's the adjusted phasing:

```
PHASE 0 (Week 1-2): FOUNDATION — not "Architecture Lock"
  Week 1:
  - Set up Mac Mini with OpenClaw
  - Configure ONE agent: Floor Manager (Opus)
  - Test heartbeat, SOUL.md, HEARTBEAT.md
  - Build the Orchestrator skeleton (TypeScript)
  - Set up Supabase with core tables
  - Verify: can Floor Manager operate reliably for 24 hours straight?

  Week 2:
  - Add Brand Agent (Sonnet for now, upgrade to Opus later if needed)
  - Test Floor Manager → Brand Agent coordination via workspace files
  - Build PromptBuilder v1 (basic template loading)
  - Verify: can two agents coordinate on a simple task?

PHASE 1 (Week 3-4): THREE-AGENT FOUNDATION
  - Add Copy Agent (Sonnet)
  - Run a mini Foundation Sprint: Floor Manager dispatches Brand + Copy
  - Build the Review Tab (minimal — just approval cards)
  - Verify: can three agents produce a Foundation Package?
  - Test cost tracking: how much did this sprint actually cost?
  - Adjust model tiers based on actual quality vs. cost data

PHASE 2 (Week 5-7): EXPAND TO FULL ROSTER
  - Add remaining agents ONE AT A TIME
  - Each addition: verify coordination, check costs, test output quality
  - Build remaining Orchestrator features (dependency tracking, phase management)
  - Run the first real floor buildout (simple test floor, not FaithForge)
  - This is where we discover what actually breaks

PHASE 3 (Week 8-10): FIRST COMPLETE FLOOR
  - Full 10-phase pipeline on the test floor
  - Website build, POD integration, content production
  - Gate reviews, approval flows
  - Launch to staging, test checkout
  - This is the real proof-of-concept

PHASE 4 (Week 11-13): DASHBOARD + LAUNCH
  - Build the PWA dashboard
  - Go live with test floor
  - Small ad budget ($10-20/day)
  - Monitor, optimize, fix everything that breaks

PHASE 5 (Week 14-16): IMPROVEMENT ENGINE
  - Now that we have real data, build the improvement loop
  - Preference learning, playbook library
  - This is last because it needs real operational data to work

PHASE 6 (Week 17+): SECOND FLOOR + SCALING
  - Build a second floor (this should be noticeably faster)
  - CEO Mode cross-floor intelligence
  - Multi-floor dashboard
  - NOW build FaithForge (or whatever your real business idea is)
```

**Total revised timeline: 17+ weeks (vs. original 15 weeks)**

The extra 2 weeks come from the incremental agent approach in Phase 0-1, which reduces the risk of building a 13-agent system that doesn't work.

---

# REMAINING WORKFLOWS TO DISCUSS

After this review, I see two workflow areas we haven't explicitly detailed:

## 1. The Orchestrator's Internal Logic

We keep referencing "the Orchestrator" but haven't written the spec for its internal logic:
- How does it track which agents are working on what?
- How does it detect task completion?
- How does it handle dependency chains (Agent A's output is Agent B's input)?
- How does it handle agent failures (retries, fallbacks, escalation)?
- How does it manage concurrency limits?
- What's the exact event loop?

This is arguably the most important piece of code in the entire system and it deserves its own spec.

## 2. The Floor Creation Sequence (Detailed)

When you tap "Build it," exactly what happens in what order?
- Database records created
- File system structure created
- Agents registered with OpenClaw
- Configurations applied
- Foundation Sprint dispatched

We have this at a high level in the end-to-end workflow but the Orchestrator needs the exact sequence, error handling, and rollback behavior.

---

# DECISION LOG — THINGS THAT NEED YOUR INPUT

1. **Do you want to adopt the incremental agent approach (Phase 0 revised)?** It's slower but much safer than deploying 13 agents at once.

2. **Are you okay moving Brand Agent from Opus to Sonnet for routine tasks?** Would save significant cost. Opus reserved for Foundation Sprint only.

3. **What should the first test floor be?** Simpler is better for proving the system.

4. **Should we spec the Orchestrator internal logic next?** It's the most important piece of code to get right.

5. **Budget realism check:** $200 may be tight for a full floor build. Would you increase to $300-500 for the test phase? The heartbeat cost alone could be $50-80/month.
