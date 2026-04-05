# EVE — Self-Improvement Engine
## How EVE Gets Smarter Over Time (Safely)

---

# THE CORE PRINCIPLE: BOUNDED LEARNING

EVE improves within established guardrails, not through unlimited experimentation. Every improvement is proposed, evidence-backed, reversible, and requires your approval at Trust Levels 1-2. The system gets smarter by learning from real results, not by guessing.

Research confirms: "Leading implementations show 60-80% reduction in human intervention within the first month — not because the AI became autonomous, but because it learned organizational preferences from guided interactions."

That's exactly what EVE does. It learns YOUR preferences, YOUR standards, and what works for YOUR floors — then applies that knowledge to make every agent better.

---

# WHAT "GETTING SMARTER" ACTUALLY MEANS

## Three Types of Improvement (Different Risk Levels)

### Type 1: Knowledge Accumulation (Automatic, Low Risk)
The system stores what works and what doesn't. No changes to how agents operate — just better data to inform decisions.

```
Examples:
- "Retargeting at 3% lookalike → 6.2x ROAS" (stored in playbook library)
- "UGC-style video outperforms polished ads 2:1 on TikTok"
- "You approve bold designs 90% of the time"
- "Posts at 7pm CT get 40% more engagement than 2pm"
- "Copy under 50 words gets approved first try 85% vs 60% for longer copy"

WHERE IT'S STORED: Playbook library + preference patterns database
WHO APPROVES: Nobody — this is passive data collection
RISK: Near zero — storing facts doesn't change behavior
```

### Type 2: Strategy Adjustment (Proposed, Medium Risk)
The system recommends changes to content mix, posting times, budget allocation, or creative direction based on accumulated knowledge.

```
Examples:
- "Shift content mix from 40/25/20/15 to 30/30/25/15 — entertainment 
   content drives 2x the conversions of educational on this floor"
- "Move TikTok posting from 2pm to 7pm based on 30 days of data"
- "Increase ad budget on Campaign A by $10/day, decrease Campaign B by $10"
- "Lead with bold, high-contrast designs (you've approved 9/10 bold vs 4/10 minimalist)"

WHERE IT'S STORED: Improvement proposals queue
WHO APPROVES: You (at Trust Level 1-2), automatic at Trust Level 3-4
RISK: Medium — changes strategy, but easily reversible
ROLLBACK: One tap reverts to previous strategy
```

### Type 3: System Improvement (Proposed, Higher Risk)
The system proposes changes to agent prompts, workflows, or configurations that affect how agents think and operate.

```
Examples:
- "Add to Copy Agent prompt: 'Keep product descriptions under 50 words. 
   Write in active voice. Lead with the benefit, not the feature.'"
- "Change Video Agent's default Path selection: use Path B for all TikTok 
   content (data shows Path A doesn't improve TikTok performance)"
- "Upgrade Analytics Agent from Haiku to Sonnet — current model misses 
   nuanced patterns in the data"

WHERE IT'S STORED: Improvement proposals queue
WHO APPROVES: You (at all Trust Levels — system changes always need approval)
RISK: Higher — changes how agents think, could have cascading effects
ROLLBACK: Git revert to previous prompt version + one tap in dashboard
```

---

# THE IMPROVEMENT LOOP

## Weekly Cycle (Lobster pipeline: `improvement-cycle.lobster`)

```
STEP 1: COLLECT METRICS (Automated — every agent, every task)

  Per agent, per task, the system tracks:
  
  QUALITY METRICS:
  ├── Approval rate: % of outputs accepted first try (by Brand Agent or you)
  ├── Revision count: average revisions before acceptance
  ├── Rejection reasons: categorized (too long, off-brand, wrong tone, etc.)
  └── Quality trend: improving, stable, or declining over time
  
  EFFICIENCY METRICS:
  ├── Time per task: how long from dispatch to completion
  ├── Turns per task: how many API calls to complete
  ├── Cost per task: total API cost (input + output tokens)
  └── Sub-agent usage: when and how effectively sub-agents are spawned
  
  BUSINESS METRICS:
  ├── Content → conversion: which content types drive actual sales
  ├── Ad creative → ROAS: which creative approaches produce best returns
  ├── Email → open/click rate: which copy styles perform best
  └── Engagement → revenue: correlation between engagement and sales

  Stored in: cost_events + improvement database
  Frequency: every task completion (continuous)
  Cost: zero incremental (uses data already being tracked)

STEP 2: ANALYZE PATTERNS (CEO Mode — Opus, weekly)

  CEO Mode reviews the accumulated metrics and identifies:
  
  UNDERPERFORMERS:
  "Copy Agent's product descriptions have been revised 4 out of 5 times 
   in the last 2 weeks. Revision reasons: 3x 'too long', 1x 'too generic'.
   Current prompt doesn't specify length or specificity requirements."
  
  OVERPERFORMERS:
  "Design Agent's social graphics approved first try 92% of the time.
   No changes needed — document what's working in the playbook."
  
  CROSS-FLOOR PATTERNS:
  "Floor A's carousel format drives 3x conversion vs. single images.
   Floor B isn't using carousels at all. Recommend adding to Floor B's 
   content mix."
  
  PREFERENCE PATTERNS:
  "Over 25 design approvals, owner consistently chooses:
   - Bold over minimalist (90% vs 40% approval rate)
   - Dark backgrounds over light (85% vs 55%)
   - Scripture as graphic element over plain text (80% vs 50%)
   Confidence: 87% — ready to propose as default direction."

STEP 3: GENERATE PROPOSALS (CEO Mode — Opus)

  For each identified pattern, CEO Mode generates a specific proposal:
  
  PROPOSAL FORMAT:
  {
    "id": "imp-2026-05-18-001",
    "type": "prompt_change" | "strategy_change" | "config_change",
    "target": "copy-agent-faithforge",
    "priority": "high" | "medium" | "low",
    
    "what_changes": "Add length constraint and specificity requirement 
                     to Copy Agent's product description task template",
    
    "current_state": "No length or specificity guidance in prompt",
    
    "proposed_state": "Add to Copy Agent role template: 
                       'Product descriptions: max 50 words. Lead with 
                       the primary benefit. Include one sensory detail. 
                       End with a soft CTA.'",
    
    "evidence": {
      "data_points": 10,
      "approval_rate_current": 0.20,
      "approval_rate_predicted": 0.75,
      "revision_reasons": ["too long (3x)", "too generic (1x)"],
      "time_period": "2026-05-04 to 2026-05-18"
    },
    
    "expected_impact": "Reduce revision rate from 80% to ~25%. 
                        Save ~$2/week in revision API costs.",
    
    "risk_level": "low",
    "risk_description": "Worst case: descriptions become too short. 
                         Easy to adjust length constraint.",
    
    "rollback_plan": "Remove the added constraint from the prompt template.
                      Git revert to previous version.",
    
    "applies_to": "this_floor" | "all_floors" | "new_floors_only"
  }

STEP 4: REVIEW (You — via Dashboard Improvements Section)

  Each proposal appears as a card on your phone:
  
  ┌──────────────────────────────────────┐
  │ 🔧 IMPROVEMENT PROPOSAL              │
  │                                      │
  │ Copy Agent — Product Descriptions    │
  │                                      │
  │ Problem: 80% revision rate           │
  │ (mostly "too long")                  │
  │                                      │
  │ Fix: Add "max 50 words, lead with    │
  │ benefit" to prompt                   │
  │                                      │
  │ Expected: 80% → 25% revision rate    │
  │ Risk: Low (easy to revert)           │
  │                                      │
  │ [✅ Approve]  [❌ Reject]  [💬 Edit]  │
  └──────────────────────────────────────┘
  
  Options:
  - APPROVE → change is applied immediately
  - REJECT → change is discarded, reason logged
  - EDIT → you modify the proposal before approving
    ("Make it 75 words, not 50")
  - DEFER → review later

STEP 5: APPLY (Orchestrator — automated after approval)

  When you approve a proposal:
  
  1. Git commit: save the current state (before change)
  2. Apply the change:
     - Prompt change → update the agent's role template
     - Strategy change → update the content calendar config
     - Config change → update the floor or agent configuration
  3. Tag the commit: "improvement-imp-2026-05-18-001-applied"
  4. PromptBuilder loads the updated template on next agent dispatch
  5. Improvement Engine starts tracking the impact

STEP 6: TRACK IMPACT (Automated — 7 days post-application)

  After an improvement is applied, the system measures:
  
  - Did the target metric improve? (revision rate, approval rate, cost, etc.)
  - Were there any unintended side effects? (other metrics that got worse)
  - Is the improvement stable? (not just a one-week blip)
  
  OUTCOMES:
  
  ✅ IMPROVEMENT CONFIRMED:
  "Copy Agent revision rate dropped from 80% to 22% after prompt change.
   No negative side effects. Marking as confirmed."
  → Proposal status: confirmed
  → If applies_to: all_floors → propose same change to other floors
  
  ⚠️ MIXED RESULTS:
  "Revision rate improved (80% → 35%) but not as much as expected.
   Descriptions may still need refinement."
  → Propose a follow-up adjustment
  
  ❌ REGRESSION:
  "Revision rate stayed the same, but word count dropped so low that
   Brand Agent now rejects for 'too sparse.' Net negative."
  → Auto-propose rollback
  → Push notification: "Improvement didn't work. Recommend reverting."
  → You approve rollback → git revert → back to previous state
```

---

# THE PREFERENCE LEARNING SYSTEM

Separate from the weekly improvement cycle, the system passively learns your preferences from every approval/rejection decision you make.

```
WHAT IT TRACKS:

  DESIGN PREFERENCES:
  - Bold vs. minimalist (approval rates for each)
  - Dark vs. light backgrounds
  - Specific color preferences within the brand palette
  - Typography weight (heavy vs. light)
  - Photo style (lifestyle vs. product-only vs. abstract)
  - Composition preferences (busy vs. clean)
  
  COPY PREFERENCES:
  - Short vs. long captions
  - Casual vs. formal tone
  - Question hooks vs. statement hooks
  - Emoji usage (heavy vs. minimal)
  - CTA style (direct vs. subtle)
  
  CONTENT PREFERENCES:
  - Content types that get approved fastest
  - Formats you engage with most in reviews
  - Times of day you're most responsive to notifications
  
  STRATEGIC PREFERENCES:
  - Risk tolerance (aggressive scaling vs. conservative)
  - Budget allocation patterns (which categories you invest more in)
  - Brand direction (when you override agent recommendations)

HOW IT LEARNS:

  Each decision is logged:
  {
    "decision_type": "design_approval",
    "item": "social-post-graphic-042",
    "outcome": "approved" | "rejected",
    "attributes": {
      "style": "bold",
      "background": "dark",
      "color_dominant": "#1A1A2E",
      "text_weight": "heavy",
      "composition": "clean"
    },
    "revision_feedback": null | "Make the text bigger",
    "time_to_decision": 3.2  // seconds (fast = confident preference)
    "timestamp": "2026-05-18T14:32:00Z"
  }
  
  After 15+ decisions in a category:
  - System calculates approval rates per attribute
  - Identifies patterns with >75% confidence
  - Stores as preference pattern

  After 25+ decisions:
  - High-confidence patterns (>85%) become proposal candidates
  - "You approve bold + dark designs 92% of the time.
     Propose: adjust Design Agent default to lead with bold/dark options."

TRANSPARENCY:
  You can always see what EVE has learned about your preferences:
  Dashboard → Improvements → "My Preferences"
  
  Shows:
  - All detected patterns with confidence scores
  - Example decisions that formed each pattern
  - Which patterns have been applied as defaults
  - Option to correct any pattern: "Actually, I don't always prefer bold.
    I prefer bold for social content but minimalist for the website."
```

---

# THE PLAYBOOK LIBRARY

The cross-floor knowledge base that makes every new floor smarter than the last.

```
WHAT GETS ADDED:

  When a strategy consistently produces strong results on a floor:
  
  1. CEO Mode identifies the winning strategy
  2. Extracts the approach (not the floor-specific data)
  3. Documents it as a playbook entry:
  
  {
    "id": "playbook-retarget-001",
    "category": "ad-strategies",
    "title": "High-ROAS Retargeting Structure",
    "strategy": "Create retargeting campaign with 3 ad sets:
                 1. Site visitors (30 days) — social proof creative
                 2. Cart abandoners (14 days) — reminder + incentive
                 3. Past purchasers (90 days) — new products + loyalty
                 Budget split: 40/40/20. Use dynamic product ads for 
                 ad set 1, static creative for 2 and 3.",
    "results": {
      "roas_average": 6.2,
      "cpa_average": 12.30,
      "sample_size": "45 days of data",
      "source_floor": "faithforge"
    },
    "applicability": "Any ecommerce floor with 500+ monthly site visitors",
    "date_added": "2026-06-15"
  }

WHAT NEVER GETS ADDED:
  - Floor-specific customer data
  - Exact brand creative (each floor has its own brand)
  - Revenue figures tied to a specific floor
  - Customer lists or targeting data

HOW IT'S USED:

  When a new floor is created:
  1. CEO Mode scans the playbook library
  2. Identifies strategies relevant to the new floor's type and stage
  3. Pre-loads relevant playbooks into the new floor's agents:
     "Based on FaithForge's success, applying retargeting playbook 
      to your new floor. Adapted for your brand and products."
  4. New floor starts with proven strategies, not from zero

  When an existing floor hits a wall:
  1. Floor Manager escalates: "ROAS declining, creative fatigue"
  2. CEO Mode checks playbook: "Floor A solved this with [strategy X]"
  3. Proposes applying the playbook to the struggling floor
  4. Adapted to the floor's brand, not copy-pasted

PLAYBOOK GROWTH:
  Month 1: ~5-10 entries (initial floor data)
  Month 3: ~20-30 entries (patterns emerging)
  Month 6: ~50-75 entries (robust knowledge base)
  Year 1: ~100-150 entries (comprehensive playbook)
  
  The more floors EVE runs, the faster the playbook grows,
  and the better each new floor performs from day one.
```

---

# THE TRUST LADDER (DETAILED)

```
LEVEL 1: TRAINING WHEELS (starting state)
  
  What you see:
  - Every agent output surfaced for review
  - Every content piece in approval queue before publishing
  - Every improvement proposal requires your explicit approval
  - Daily digest of all agent activity
  - All strategy changes require approval
  
  What's automatic:
  - Knowledge accumulation (passive data collection)
  - Agent-to-agent collaboration (within established rules)
  - Technical operations (dev server, builds, file management)
  
  Promotion criteria (EVE suggests, you decide):
  - 30+ days at Level 1
  - Approval rate > 80% on content (you're approving most things)
  - No major incidents
  - You feel comfortable with the system's judgment
  
  EVE prompts: "You've been reviewing everything for 35 days.
  Your approval rate is 87%. Would you like to move to Level 2,
  where routine content publishes automatically and you review 
  a daily digest instead?"

LEVEL 2: SUPERVISED AUTONOMY
  
  What's automatic (no longer needs your approval):
  - Content that matches established patterns publishes automatically
  - Routine ad optimizations (within approved rules)
  - Agent-to-agent quality reviews (Brand Agent review sufficient)
  - Low-risk strategy adjustments (posting time changes, content mix tweaks)
  
  What still needs your approval:
  - New content that doesn't match established patterns
  - Budget changes
  - Prompt/system improvements
  - Any escalated items
  - Launch decisions
  
  What you see:
  - Daily digest: what was published, what was optimized, key metrics
  - Flagged items: anything unusual or outside normal patterns
  - Weekly improvement proposals
  
  Promotion criteria:
  - 60+ days at Level 2
  - System performance stable or improving
  - No overrides on automatic decisions (or very few)
  - Digest review becomes routine ("looks good, looks good, looks good")

LEVEL 3: AUTONOMOUS WITH GUARDRAILS
  
  What's automatic:
  - All content production and publishing
  - All ad optimization within budget
  - Strategy adjustments based on performance data
  - Low-risk improvement proposals (prompt tweaks, content mix)
  
  What still needs your approval:
  - Budget increases
  - New campaigns on new platforms
  - System-level improvements (prompt changes, config changes)
  - Anything flagged as unusual
  - New floor creation
  
  What you see:
  - Weekly report (not daily)
  - Improvement proposals
  - Alerts only when action needed
  
  Promotion criteria:
  - 90+ days at Level 3
  - Floor(s) consistently profitable
  - Improvement proposals consistently confirmed
  - High confidence in system judgment

LEVEL 4: FULL AUTONOMY
  
  What's automatic:
  - Everything except:
    - New floor creation
    - Total budget ceiling changes
    - Strategic pivots (changing what a floor sells)
    - Account-level changes (new platforms, new payment methods)
  
  What you see:
  - Weekly summary
  - Monthly deep dive
  - Alerts for money decisions only
  
  THE KILL SWITCH:
  At every level, one tap pauses everything.
  At every level, you can demote back to any lower level.
  EVE NEVER self-promotes. Only you promote.

DEMOTION TRIGGERS (automatic):
  - Any incident that causes financial loss → demote to Level 1
  - Budget overrun → demote to Level 2
  - Improvement proposal causes regression → demote one level
  - You manually demote at any time for any reason
```

---

# SAFETY GUARDRAILS (IMMUTABLE)

These rules can NEVER be modified by the Improvement Engine, regardless of Trust Level:

```
IMMUTABLE RULES (the improvement engine cannot touch these):

  1. Approval gates (Gate 1, 2, 3) cannot be removed or bypassed
  2. Budget ceilings cannot be increased without human approval
  3. Terminal access tiers cannot be elevated by the system
  4. Customer data protection rules cannot be relaxed
  5. The kill switch cannot be disabled
  6. Trust Level promotion requires human action
  7. Cross-floor data isolation cannot be weakened
  8. API key security rules cannot be changed
  9. The Improvement Engine cannot modify its own safety rules
  10. All improvements must be logged and reversible

HOW THIS IS ENFORCED:
  - Immutable rules are stored as a separate, read-only configuration
  - The Improvement Engine's proposal generator explicitly checks 
    every proposal against immutable rules before presenting it
  - The Orchestrator rejects any action that violates immutable rules,
    even if it somehow bypasses the proposal system
  - Weekly security audit: CEO Mode verifies no immutable rule 
    has been circumvented (logged in security digest)

THE META-SAFETY PRINCIPLE:
  The Improvement Engine can make agents smarter at their jobs.
  It CANNOT make agents more autonomous than you've approved.
  It CANNOT remove the checks that protect your money, data, or reputation.
  It CANNOT modify the rules that govern itself.
```

---

# A/B TESTING FOR IMPROVEMENTS

Before committing to a prompt change, the system can A/B test it.

```
A/B TEST WORKFLOW:

  1. Improvement Engine proposes a prompt change for Copy Agent
  
  2. Instead of applying globally, create an A/B test:
     - Variant A: current prompt (control)
     - Variant B: proposed new prompt
  
  3. Next 10 tasks for Copy Agent are split:
     - 5 tasks use Variant A
     - 5 tasks use Variant B
  
  4. Both variants go through the same review process
     (Brand Agent review, your approval if at Trust Level 1)
  
  5. After all 10 tasks complete, compare:
     - Approval rate A vs B
     - Revision count A vs B
     - Time per task A vs B
     - Cost per task A vs B
  
  6. Results presented:
     "A/B test results for Copy Agent prompt change:
      
      Variant A (current): 60% first-try approval, avg 1.4 revisions
      Variant B (proposed): 80% first-try approval, avg 0.8 revisions
      
      Variant B wins on approval rate (+33%) and efficiency (+43%).
      Recommend applying Variant B permanently."
  
  7. You approve → Variant B becomes the new default
     You reject → Variant A stays, proposal archived with results

WHEN TO A/B TEST:
  - High-risk prompt changes (changing reasoning patterns, not just constraints)
  - Changes that affect multiple agents (cascade risk)
  - Changes where the expected impact is uncertain
  
WHEN TO SKIP A/B TESTING:
  - Simple constraint additions ("max 50 words")
  - Bug fixes (fixing factual errors in prompts)
  - Obvious improvements (adding missing information)
  - Low-confidence proposals (need more data first)

COST:
  A/B testing doubles the API cost for the test period (running both variants).
  For 10 tasks at Sonnet: ~$1-3 extra. Worth it for high-impact changes.
```

---

# IMPLEMENTATION ARCHITECTURE

```
DATABASE TABLES:

  improvement_proposals:
    id, type, target_agent, target_floor, priority,
    what_changes, current_state, proposed_state,
    evidence_json, expected_impact, risk_level,
    status (proposed/approved/applied/confirmed/rolled_back/rejected),
    proposed_at, reviewed_at, applied_at, impact_measured_at

  preference_patterns:
    id, pattern_type, category, description,
    confidence_score, evidence_count, evidence_json,
    applied_as_default (boolean), applied_at,
    last_updated

  playbook_entries:
    id, category, title, strategy, results_json,
    source_floor_id, applicability, date_added,
    times_applied, average_impact_when_applied

  trust_ladder:
    id, floor_id, current_level, 
    promoted_at, demoted_at, demotion_reason,
    history_json (array of all level changes with timestamps)

  ab_tests:
    id, proposal_id, variant_a_config, variant_b_config,
    tasks_completed_a, tasks_completed_b,
    results_a_json, results_b_json,
    winner, status, started_at, completed_at

  agent_performance:
    id, agent_id, floor_id, period_start, period_end,
    approval_rate, avg_revision_count, avg_time_per_task,
    avg_cost_per_task, avg_turns_per_task,
    quality_trend (improving/stable/declining)

LOBSTER PIPELINE: improvement-cycle.lobster

  steps:
    - id: collect
      run: eve collect-agent-metrics --period 7d
    
    - id: analyze
      pipeline: llm.invoke --model opus
        --prompt "Analyze agent performance metrics. Identify 
                  underperformers, overperformers, and preference
                  patterns. Generate improvement proposals."
      stdin: $collect.json
    
    - id: validate
      # Deterministic check: do any proposals violate immutable rules?
      run: eve validate-proposals --proposals $analyze.json
    
    - id: present
      # Queue valid proposals for human review
      run: eve queue-proposals --proposals $validate.json
    
    - id: notify
      # Push notification if there are proposals to review
      run: eve notify-owner --type improvement_proposals
           --count $present.json.count
      when: $present.json.count > 0

HEARTBEAT INTEGRATION:
  CEO Mode's weekly heartbeat includes:
  "Run improvement cycle. Analyze last 7 days of agent performance.
   Generate proposals if patterns identified."
```

---

# MONTH-BY-MONTH IMPROVEMENT TRAJECTORY

```
MONTH 1 (Learning Phase):
  - System collects data on every agent interaction
  - Your approval patterns start forming
  - First improvement proposals appear around week 3-4
  - Proposals are simple: constraint additions, obvious fixes
  - You approve most, reject some, the system learns from both

MONTH 2 (Pattern Recognition):
  - Preference patterns reach confidence thresholds
  - "You prefer bold designs" becomes a default direction
  - Copy Agent prompts refined based on revision data
  - Content strategy adjusts based on performance data
  - Playbook library has 10-20 entries

MONTH 3 (Compound Improvement):
  - Second-order improvements: system proposes changes based on 
    the impact of first-round changes
  - Cross-floor patterns emerge (if multiple floors active)
  - A/B testing validates higher-risk changes
  - Trust Level 2 becomes appropriate for most users
  - Improvement proposals are more nuanced and specific

MONTH 6 (Maturity):
  - Playbook library is robust (50+ entries)
  - Agent prompts have been refined 5-10 times each
  - Content pipeline produces first-try approved content 85%+ of the time
  - Ad strategies are data-backed and floor-specific
  - System knows your preferences well enough to anticipate decisions
  - Trust Level 3 appropriate for confident users

YEAR 1 (Expertise):
  - New floors launch with comprehensive playbook knowledge
  - Agent prompts are highly optimized for your standards
  - Content and ads are data-driven and continuously refined
  - The system makes fewer proposals (most improvements already applied)
  - Focus shifts to incremental optimization and edge case handling
  - Trust Level 4 appropriate if you're comfortable

THE KEY INSIGHT:
  EVE doesn't get smarter by becoming more autonomous.
  It gets smarter by learning what YOU want and delivering it
  more consistently, with fewer revisions, at lower cost.
  The autonomy increase is a consequence of trust earned,
  not a goal the system pursues.
```
