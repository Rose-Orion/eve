# EVE — Workflow Architecture
## Based on Production Multi-Agent Research + OpenClaw Internals

---

# KEY RESEARCH FINDINGS THAT CHANGE OUR APPROACH

## Finding 1: Don't Orchestrate with LLMs

The single most important insight from production multi-agent systems in 2026: **never let the LLM decide the flow control.** Every team that tried putting orchestration logic in prompts ("when you're done, send to the reviewer") introduced failure modes. The LLM should do creative work — writing, coding, designing, reasoning. Code should handle sequencing, counting, routing, and retrying.

This is exactly what OpenClaw's Lobster workflow engine does. Lobster is a deterministic pipeline runtime where YAML defines the flow and LLMs do the thinking within each step. This is the correct architecture for EVE.

**What this means for EVE:** The Orchestrator should NOT be an LLM-based coordinator. It should be deterministic code (Lobster pipelines + custom TypeScript) that routes tasks, tracks dependencies, and manages the flow. Agents do the creative work within each step. The orchestration layer is code, not AI.

## Finding 2: Hierarchical Pattern Is the Right Fit

Research across Microsoft, Deloitte, Gartner, and production deployments consistently identifies the hierarchical pattern as the best fit for complex business workflows. A root orchestrator manages sub-orchestrators, each managing worker agents. This maps perfectly to EVE's structure: CEO Mode → Floor Managers → Agents.

OpenClaw natively supports this with its multi-agent routing — different agents bound to different channels/sessions, each with isolated workspaces, memory, and model configs.

## Finding 3: Lobster Is Our Orchestration Engine

Lobster is OpenClaw's built-in workflow engine — a typed, local-first pipeline runtime with deterministic execution, approval gates, and resume tokens. This is exactly what EVE needs for its phased delivery pipeline. Instead of building a custom orchestrator from scratch, we build Lobster workflow files that define each phase of the build process.

Key Lobster capabilities that map to EVE:
- **Deterministic steps** → each build phase is a defined sequence
- **Approval gates** → maps to our 3 approval gates
- **Resume tokens** → paused workflows resume where they stopped
- **LLM task steps** → agents do creative work within the pipeline
- **Sub-workflows with loops** → iterative processes (content creation, ad optimization)

## Finding 4: Model Tiering Is Essential

Production multi-agent systems that mix model tiers (expensive for reasoning, cheap for execution) reduce costs by 40-60% compared to running a single premium model. Our Opus/Sonnet/Haiku split is validated by this research.

The additional insight: use a **router pattern** where a cheap model (Haiku) does initial triage and routing, and only escalates to expensive models (Opus) when complex reasoning is needed. This saves money on tasks that turn out to be simple.

## Finding 5: The Reflection Pattern Is Critical

Production systems that implement feedback loops — where one agent reviews another's output — significantly reduce hallucinations and improve quality. This validates our Brand Agent as Creative Director reviewing all content, and our Finance Agent cross-checking financial claims.

The improvement: make reflection a **structural part of the pipeline**, not an optional step. Every agent output that affects the real world goes through at least one review step before execution.

## Finding 6: Self-Improvement Should Follow the Karpathy Loop

Andrej Karpathy's "autoresearch" pattern — an AI agent running continuous experiments to optimize a system, with clear instructions, constraints, and stopping criteria — is the proven model for self-improvement. The key insight: self-improvement works when the agent has clear metrics to optimize against, bounded experimentation space, and human review of results.

For EVE: the Improvement Engine should run experiments (A/B test different prompts, compare agent configurations) with clear metrics (approval rate, revision count, cost per task) and present results for your approval.

---

# EVE'S FIVE WORKFLOW LAYERS

EVE's workflows operate on five distinct layers, from highest-level (your interaction) to lowest-level (individual API calls).

## Layer 1: Human Interaction Workflow

How you interact with EVE day-to-day.

```
NOTIFICATION arrives on phone
  │
  ├── RED (Approval Required)
  │   └── Tap notification → Approval screen
  │       ├── Foundation Package → Read + Approve/Reject
  │       ├── Launch Review → Preview URL + Approve/Reject  
  │       ├── Ad Activation → Campaign preview + Approve/Reject per campaign
  │       └── Improvement Proposal → View change + Approve/Reject
  │
  ├── YELLOW (Heads Up)
  │   └── Tap notification → Context card
  │       ├── Milestone complete → Acknowledge
  │       ├── Budget concern → Review + Decide
  │       ├── Timeline change → Acknowledge or Adjust
  │       └── FM needs input → Chat opens
  │
  └── GREEN (Informational)
      └── Badge on dashboard → Check when you want
          ├── Daily progress
          ├── Post-launch reports
          └── Agent status changes

PROACTIVE CHECK-IN (you open the app)
  │
  ├── HQ Dashboard → Glance at all floors
  │   ├── Revenue numbers
  │   ├── Floor health cards
  │   └── Any pending items
  │
  ├── Floor Dashboard → Deep dive on one floor
  │   ├── Overview (if live) → Revenue, orders, ads, content
  │   ├── Build (if building) → Progress, agents, costs
  │   └── Review → Approve designs, content, brands
  │
  └── Chat with Floor Manager → Give direction
      ├── Text input
      ├── Voice input
      ├── Screenshot annotation
      └── Batch feedback list

FEEDBACK LOOP
  │
  You give feedback → Floor Manager creates revision tasks
  → Agents revise → Preview updates → You review
  → Approve or give more feedback (loop until satisfied)
```

## Layer 2: Floor Lifecycle Workflow

The complete lifecycle of a floor from idea to running business.

```
FLOOR CREATION (Lobster pipeline: floor-creation.lobster)
  │
  steps:
    - id: intake
      # CEO Mode asks clarifying questions
      pipeline: llm.invoke --model opus --prompt [CEO Mode system prompt + your idea]
    
    - id: evaluate
      # CEO Mode runs 7-question framework
      pipeline: llm.invoke --model opus --prompt [evaluation with your answers]
    
    - id: plan
      # CEO Mode creates floor config
      pipeline: llm.invoke --model opus --prompt [create floor plan]
    
    - id: cost-estimate
      # Deterministic calculation from plan
      run: eve estimate-cost --config $plan.json
    
    - id: present
      # Show plan to human for approval
      approval: "Ready to build [floor name]? Budget: $X build, $Y/month"
    
    - id: initialize
      # Create floor in database, workspace, agents
      run: eve init-floor --config $plan.json
      when: $present.approved
    
    - id: start-foundation
      # Trigger Foundation Sprint
      run: eve start-phase --floor $initialize.json.floorId --phase 1

FOUNDATION SPRINT (Lobster pipeline: foundation-sprint.lobster)
  │
  steps:
    - id: brand-strategy
      # Brand Agent + Strategy Agent work in parallel
      # Each is a sub-agent spawned by Floor Manager
      pipeline: >
        eve run-parallel-agents
        --floor ${floorId}
        --agents brand,strategy,finance
        --task "Create Foundation Package"
    
    - id: compile
      # Floor Manager compiles Foundation Package
      pipeline: llm.invoke --model opus --prompt [compile package from agent outputs]
      stdin: $brand-strategy.json
    
    - id: gate-1
      # APPROVAL GATE 1: Human reviews Foundation Package
      approval: "Foundation Package ready for [floor name]. Review and approve."
    
    - id: dispatch
      # Start parallel buildout
      run: eve start-phase --floor ${floorId} --phase 2
      when: $gate-1.approved

PARALLEL BUILDOUT (Lobster pipeline: buildout.lobster)
  │
  # Phases 2-7 run as parallel agent work cycles
  # The Orchestrator manages dependencies, not Lobster
  # Lobster handles the phase transitions and approval gates
  
  steps:
    - id: design-and-build
      # Phases 2-5 (Design, Alpha, Content, Integration)
      run: eve run-buildout --floor ${floorId} --phases 2,3,4,5
      # This triggers the Orchestrator's parallel agent execution
      # Agents work autonomously, Orchestrator tracks status
    
    - id: staging
      # Phase 6: Deploy to staging
      run: eve deploy-staging --floor ${floorId}
    
    - id: ad-prep
      # Phase 7: Create ad campaigns (paused)
      pipeline: llm.invoke --model sonnet --prompt [create campaigns from strategy]
    
    - id: gate-2
      # APPROVAL GATE 2: Human reviews complete build
      approval: "Launch ready for [floor name]. Preview: [staging URL]"
    
    - id: go-live
      # Phase 8: Production deployment
      run: eve deploy-production --floor ${floorId}
      when: $gate-2.approved
    
    - id: gate-3
      # APPROVAL GATE 3: Ad activation (per campaign)
      approval: "Activate ads for [floor name]? [campaign details]"
    
    - id: activate-ads
      run: eve activate-ads --floor ${floorId}
      when: $gate-3.approved
    
    - id: start-monitoring
      run: eve start-phase --floor ${floorId} --phase 10
```

## Layer 3: Agent Orchestration Workflow

How agents are dispatched, run, and coordinated within a phase.

```
ORCHESTRATOR DISPATCH CYCLE (runs every 30 seconds)
  │
  1. CHECK TASK QUEUE
  │  - Pull highest-priority tasks with satisfied dependencies
  │  - Check worker pool capacity (max 6 per floor, 15 total)
  │
  2. FOR EACH READY TASK:
  │  a. Build agent prompt via PromptBuilder
  │     - Role template
  │     - Brand context (from Foundation Package)
  │     - Skill knowledge (from assigned SKILL.md files)
  │     - Current task description
  │     - Workspace context (what outputs exist)
  │     - Rules (terminal tier, collaboration rules)
  │
  │  b. Check cost budget
  │     - Calculate estimated cost for this task
  │     - Verify floor hasn't exceeded daily limit
  │     - If over budget → pause and alert
  │
  │  c. Dispatch to OpenClaw
  │     - Create or resume agent session
  │     - Send assembled system prompt + task
  │     - Agent runs autonomously (OpenClaw manages the conversation loop)
  │
  3. MONITOR RUNNING AGENTS
  │  - Track token usage per turn
  │  - Detect runaway (50 turns or 3 repeated actions)
  │  - Detect completion (agent signals task done)
  │  - Detect blocks (agent signals dependency)
  │
  4. PROCESS COMPLETIONS
  │  - Store output in shared workspace
  │  - Update task status in database
  │  - Check if any blocked tasks are now unblocked
  │  - Trigger dependent tasks
  │  - Notify Floor Manager of completion
  │
  5. PROCESS BLOCKS
  │  - Log the blocker
  │  - Check if the blocking dependency is in progress
  │  - If not in progress → escalate to Floor Manager
  │  - Floor Manager decides: reassign, wait, or escalate

AGENT WORK CYCLE (per agent, per task — managed by OpenClaw)
  │
  1. Receive system prompt + task from Orchestrator
  2. Read relevant workspace files (brand docs, existing outputs)
  3. Plan approach (internal reasoning)
  4. Execute work:
     - Write content/code/designs
     - Call APIs (image gen, video gen, etc.)
     - Read/write workspace files
  5. If needs input from another agent:
     - Check workspace for existing output → use it
     - If not available → signal BLOCKED to Orchestrator
  6. If spawning sub-agents:
     - Define bounded task for each sub-agent
     - Dispatch via OpenClaw sessions_spawn
     - Wait for sub-agent results
     - Review and integrate results
  7. Signal completion + deliver output to workspace
  8. Update status: COMPLETE

SUB-AGENT WORK CYCLE
  │
  1. Receive compressed context + bounded task from parent
  2. Execute task (Haiku model, max 10 turns)
  3. Return result to parent
  4. Terminate (no persistent state)
```

## Layer 4: Content Production Workflow

The continuous loop that runs after launch.

```
WEEKLY PLANNING (Lobster pipeline: content-planning.lobster)
  │
  steps:
    - id: trends
      # Social Media Agent's trend monitoring function
      pipeline: llm.invoke --model haiku --prompt [analyze trending content]
    
    - id: performance
      # Analytics Agent pulls last week's data
      run: eve pull-analytics --floor ${floorId} --period 7d
    
    - id: strategy
      # Social Media Agent creates this week's calendar
      pipeline: llm.invoke --model sonnet --prompt [create calendar from trends + data]
      stdin: $trends.json,$performance.json
    
    - id: briefs
      # Create content briefs for each piece
      pipeline: llm.invoke --model sonnet --prompt [create briefs from calendar]
      stdin: $strategy.json

DAILY PRODUCTION (Lobster pipeline: content-production.lobster)
  │
  # Runs for each content piece in today's calendar
  
  steps:
    - id: creative-brief
      # Brand Agent/Creative Director sets visual direction
      pipeline: llm.invoke --model opus --prompt [creative brief for this piece]
    
    - id: produce
      # Parallel: Copy Agent + Design Agent + Video Agent
      run: eve run-parallel-agents --floor ${floorId}
           --agents copy,design,video
           --task "Produce content from brief"
           --context $creative-brief.json
    
    - id: review
      # Brand Agent reviews all output
      pipeline: llm.invoke --model opus --prompt [review against brand standards]
      stdin: $produce.json
    
    - id: check-quality
      # Deterministic quality check
      run: eve content-qc --output $produce.json --review $review.json
    
    - id: revision
      # If review rejected, loop back
      lobster: content-revision.lobster
      args:
        feedback: $review.json
        original: $produce.json
      loop:
        max: 3
        condition: test "$LOBSTER_LOOP_JSON" != '{"approved":true}'
      when: $check-quality.json.needs_revision == true
    
    - id: queue
      # Add to publishing queue at optimal time
      run: eve queue-content --floor ${floorId}
           --content $produce.json
           --schedule $strategy.json.optimal_time

PUBLISHING (Lobster pipeline: content-publish.lobster)
  │
  # Triggered at scheduled time
  
  steps:
    - id: post
      # Publish via platform API
      run: eve publish --floor ${floorId} --content-id ${contentId}
    
    - id: notify-community
      # Alert Social Media Agent to monitor engagement
      run: eve notify-agent --floor ${floorId}
           --agent social-media
           --message "New post live - active engagement window"
    
    - id: track
      # Start performance tracking
      run: eve start-tracking --content-id ${contentId}

ENGAGEMENT (continuous, event-driven)
  │
  # Triggered by incoming comments/DMs via webhooks
  
  ON new_comment:
    → Social Media Agent evaluates and responds in brand voice
    → If purchase intent → priority response + track
    → If complaint → escalate to Floor Manager → notify you
    → If spam → filter
  
  ON new_dm:
    → Social Media Agent responds
    → If product question → answer + send product link
    → If warm lead → follow up sequence
    → If support issue → route to support flow
```

## Layer 5: Improvement Workflow

The self-improvement loop that makes EVE smarter.

```
IMPROVEMENT CYCLE (Lobster pipeline: improvement-cycle.lobster)
  │
  # Runs weekly (or on demand)
  
  steps:
    - id: collect-metrics
      # Gather performance data across all agents
      run: eve collect-agent-metrics --period 7d
      # Metrics: approval rate, revision count, time per task,
      # cost per task, output quality scores
    
    - id: identify-underperformers
      # Find agents with declining metrics
      run: eve analyze-performance --metrics $collect-metrics.json
    
    - id: propose-improvements
      # CEO Mode analyzes and proposes changes
      pipeline: llm.invoke --model opus --prompt [
        "Review these agent performance metrics.
        Identify specific improvements to agent prompts,
        workflows, or configurations that would improve
        quality and reduce costs.
        For each proposal, include:
        - What to change
        - Why (evidence from metrics)
        - Expected impact
        - Risk level (low/medium/high)
        - Rollback plan"
      ]
      stdin: $identify-underperformers.json
    
    - id: review-proposals
      # Present to human for approval
      approval: "Improvement proposals ready. [count] changes suggested."
    
    - id: apply-approved
      # Apply only approved changes
      run: eve apply-improvements --proposals $review-proposals.json
      when: $review-proposals.approved
    
    - id: track-impact
      # Monitor the impact of applied changes
      run: eve track-improvement-impact --applied $apply-approved.json

PREFERENCE LEARNING (continuous, passive)
  │
  Every time you approve/reject:
    → Record the decision + what was presented
    → After 10+ decisions in a category:
      → Detect patterns (you prefer bold designs, short copy, etc.)
      → Store as preference pattern with confidence score
      → At 80%+ confidence: propose as default adjustment
      → You approve → becomes default for future floors

PLAYBOOK EXTRACTION (triggered by floor success milestones)
  │
  When a floor hits performance targets:
    → CEO Mode analyzes what worked
    → Extracts strategy into playbook entry
    → Abstracts away floor-specific details
    → Adds to playbook library
    → Available for future floors
```

---

# WORKFLOW INTERACTION MAP

How the five layers connect:

```
YOU (Layer 1)
  │ notifications, approvals, feedback
  ▼
FLOOR LIFECYCLE (Layer 2 — Lobster pipelines)
  │ phase transitions, approval gates
  ▼
AGENT ORCHESTRATION (Layer 3 — Orchestrator + OpenClaw)
  │ task dispatch, parallel execution, status tracking
  ▼
CONTENT PRODUCTION (Layer 4 — Lobster pipelines + agents)
  │ continuous creation loop, engagement, tracking
  ▼
IMPROVEMENT (Layer 5 — weekly analysis + proposals)
  │ feeds back into Layers 2, 3, 4
  ▲ (loop)
```

---

# CRITICAL WORKFLOW PATTERNS

## Pattern 1: Deterministic Shell + Creative Core

Every workflow follows this pattern: code handles the routing, sequencing, and state management. LLMs handle the creative work within each step. Never let the LLM decide what happens next in the pipeline.

```
CODE decides: "Next step is Brand Agent creating the visual identity"
LLM does: [creative work of designing the brand]
CODE decides: "Output goes to review step"
LLM does: [creative work of evaluating the output]
CODE decides: "Review passed, move to next phase"
```

## Pattern 2: Parallel Fan-Out, Sequential Fan-In

When multiple agents can work simultaneously, fan out to all of them. When their outputs need to be combined, fan in through a coordinator (Floor Manager or the specific agent that needs the combined input).

```
Fan out: Design Agent + Copy Agent + Video Agent all start
Fan in: Web Agent receives all outputs and integrates
```

## Pattern 3: Review-Before-Execute

Nothing that affects the real world (publishing, deploying, spending money) happens without going through a review step first. This is structural, not optional.

```
Agent produces output → Review agent checks it → 
  PASS → execute
  FAIL → specific feedback → agent revises → review again (max 3 loops)
  FAIL x3 → escalate to Floor Manager → escalate to you if needed
```

## Pattern 4: Bounded Iteration

Any loop has a hard maximum. Content revision: max 3 rounds. Ad optimization: daily cycle with weekly escalation. Sub-agent tasks: max 10 turns. No unbounded loops anywhere in the system.

## Pattern 5: Cost-Aware Routing

Before dispatching any agent task, check the cost budget. Use the cheapest model that can handle the task. Route simple tasks to Haiku, medium tasks to Sonnet, complex reasoning to Opus. The router is deterministic code, not an LLM.

```
Task type: "write 50 product descriptions" → Haiku sub-agents
Task type: "design brand identity" → Opus
Task type: "format analytics report" → Haiku
Task type: "write homepage copy" → Sonnet
Task type: "review all outputs for brand consistency" → Opus
```

## Pattern 6: State Persistence via Workspace

Agent state is NOT held in memory. Everything is written to the shared workspace (files) and the database (status, costs, history). If an agent crashes, it can resume from the workspace state. If the whole system restarts, it picks up where it left off.

## Pattern 7: Event-Driven Post-Launch

After launch, the system shifts from pipeline-driven (build phases) to event-driven (respond to purchases, comments, analytics changes). The heartbeat checks for events. Lobster pipelines handle the response workflows. Agents do the creative work within each response.

---

# OPENCLAW CONFIGURATION FOR EVE

## Agent Structure

```yaml
# openclaw-eve.yaml
agents:
  list:
    - id: ceo-mode
      model: anthropic/claude-opus-4-6
      workspace: __PATH_EVE_HOME__ceo
      soul: __PATH_EVE_HOME__ceo/SOUL.md
      heartbeat:
        interval: 300  # 5 minutes
        prompt: "Read HEARTBEAT.md. Check all floor statuses. Surface anything urgent."
        activeHours:
          start: "06:00"
          end: "23:00"
          timezone: America/Chicago
      tools:
        allow: [lobster, llm-task]
      maxChildrenPerAgent: 5
      maxSpawnDepth: 1

    - id: floor-manager-{floorId}
      model: anthropic/claude-opus-4-6
      workspace: __PATH_EVE_PROJ__{floorName}/
      soul: __PATH_EVE_PROJ__{floorName}/SOUL.md
      heartbeat:
        interval: 60  # 1 minute during build, 300 post-launch
        prompt: "Read HEARTBEAT.md. Check agent statuses. Unblock anything stuck."
      tools:
        allow: [lobster, llm-task]
      maxChildrenPerAgent: 6
      maxSpawnDepth: 1

    # Agent templates (instantiated per floor)
    - id: brand-agent-{floorId}
      model: anthropic/claude-opus-4-6
      workspace: __PATH_EVE_PROJ__{floorName}/
      maxChildrenPerAgent: 0  # Brand Agent doesn't spawn sub-agents

    - id: copy-agent-{floorId}
      model: anthropic/claude-sonnet-4-6
      workspace: __PATH_EVE_PROJ__{floorName}/
      maxChildrenPerAgent: 3  # Can spawn for batch writing

    - id: design-agent-{floorId}
      model: anthropic/claude-opus-4-6
      workspace: __PATH_EVE_PROJ__{floorName}/
      maxChildrenPerAgent: 3  # Can spawn for batch image generation

    # ... etc for all 13 agent types

session:
  maintenance:
    mode: enforce
    pruneAfter: 24h
    maxEntries: 200
```

## Lobster Workflow Files

```
__PATH_EVE_HOME__workflows/
  floor-creation.lobster          # Idea → Floor plan → Approval → Initialize
  foundation-sprint.lobster       # Brand + Strategy + Finance → Foundation Package
  buildout.lobster                # Phases 2-7 with parallel execution
  launch.lobster                  # Go-live sequence
  content-planning.lobster        # Weekly content calendar creation
  content-production.lobster      # Per-piece production pipeline
  content-publish.lobster         # Scheduled publishing
  content-revision.lobster        # Revision sub-workflow (loopable)
  ad-optimization.lobster         # Daily ad optimization cycle
  improvement-cycle.lobster       # Weekly improvement analysis
  scaling-check.lobster           # Scaling readiness evaluation
  incident-response.lobster       # Emergency containment workflow
```

---

# WHAT THIS CHANGES IN THE SPEC

## Changes to the Orchestrator Design

The Orchestrator is now TWO things:
1. **Lobster pipelines** for deterministic, phase-level workflows (floor creation, build phases, content production cycles, improvement loops)
2. **Custom TypeScript code** for the real-time agent management layer (task queue, worker pool, cost tracking, status broadcasting)

Lobster handles the "what happens in what order." The TypeScript layer handles "who runs now and how are they doing."

## Changes to the Heartbeat Design

The heartbeat is no longer a single 60-second cycle checking everything. Instead:
- **CEO Mode heartbeat:** Every 5 minutes. Checks cross-floor health, surfaces urgent items.
- **Floor Manager heartbeat:** Every 1 minute during build (agents working fast), every 5 minutes post-launch. Checks agent statuses, unblocks stuck agents.
- **Content monitoring:** Event-driven via webhooks (new comment, new DM), not heartbeat.
- **Ad optimization:** Daily Lobster pipeline, not continuous heartbeat.

This reduces unnecessary API calls and focuses heartbeat tokens on what actually needs checking.

## Changes to the Improvement Engine

The improvement loop is now a formal Lobster pipeline that runs weekly, collects metrics, proposes changes, and requires approval. It's not a vague "EVE gets smarter" — it's a structured, auditable, reversible process with clear inputs and outputs.
