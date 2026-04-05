# EVE — Claude Code Build Plan
## Entry Point for Implementation

---

# WHAT YOU'RE BUILDING

EVE is an autonomous business-building system. This document tells you what to build, in what order, and which spec documents to reference for each piece.

**There are 25 specification documents in this project.** Don't read them all at once. Follow the build order below and reference the relevant spec for each step.

---

# ARCHITECTURE SUMMARY (read this first)

```
MAC MINI runs:
├── ORCHESTRATOR (the main thing you're building)
│   ├── Fastify API server (Dashboard endpoints)
│   ├── BullMQ + Redis (task queue)
│   ├── PromptBuilder (builds XML prompts for virtual agents)
│   ├── VirtualDispatcher (calls Anthropic API directly for 10 agents)
│   ├── OpenClawDispatcher (calls OpenClaw CLI for 3-4 real agents)
│   ├── MediaGenerator (calls fal.ai + OpenAI for images/video)
│   ├── DependencyGraph (DAG — tracks task dependencies)
│   ├── BudgetEnforcer (cost tracking + alerts)
│   └── Supabase client (database + real-time)
│
├── OPENCLAW GATEWAY (already running — manages real agents)
│   ├── eve-ceo (CEO Mode — already set up)
│   ├── floor-manager-{floor} (added per floor)
│   ├── web-agent-{floor} (added per floor)
│   └── launch-agent-{floor} (added per floor)
│
└── REDIS (already running — task queue backend)
```

**Key architectural decision:** Only 3-4 agents per floor are real OpenClaw agents (need shell access). The other 9-10 are "virtual" — the Orchestrator calls the Anthropic API directly using PromptBuilder-constructed prompts. This is simpler, cheaper, and gives full control over cost and pacing.

---

# TECH STACK

```
Runtime: Node.js 24+
Language: TypeScript (strict mode)
Package manager: npm
API framework: Fastify
Task queue: BullMQ + Redis  
Database: Supabase (PostgreSQL + Realtime)
LLM SDK: @anthropic-ai/sdk
Media SDK: @fal-ai/client
Image (text): openai (GPT Image 1.5)
File watching: chokidar
Validation: zod
Process manager: PM2
```

---

# BUILD ORDER

## Phase 0A: PromptBuilder (build first)

**Reference:** eve-promptbuilder-spec.md + eve-skills-knowledge.md

The PromptBuilder assembles XML-structured system prompts for virtual agents. Every virtual agent call goes through this.

```
BUILD:
  src/prompt-builder/
    ├── index.ts            — Main PromptBuilder class
    ├── template-loader.ts  — Loads agent templates from prompt-templates/
    ├── brand-loader.ts     — Loads Foundation Package + Voice Sample
    ├── example-loader.ts   — Loads Gold Standard examples
    └── token-counter.ts    — Counts tokens, enforces 8K ceiling

KEY BEHAVIORS:
  - Assembles XML sections: <role> → <brand_context> → <expertise> → <examples> → <task> → <rules> → <boundaries> → <output_format>
  - Loads Voice Sample into <brand_context> for content agents (Copy, Social, Ads)
  - Loads Gold Standard examples when available (from .eve/gold-standards/)
  - Adds Generated Knowledge instructions for analysis agents (Strategy, Finance, Ads)
  - Enforces 8,000 token ceiling, trims in reverse priority order
  - Anti-slop phrase list loaded into rules for content agents

PROMPT TEMPLATE FORMAT (XML — Claude parses 23% more accurately than Markdown):
  <s>
    <role>...</role>
    <brand_context><voice_sample>...</voice_sample></brand_context>
    <expertise>...</expertise>
    <examples>...</examples>
    <task>...</task>
    <rules>...</rules>
    <boundaries>...</boundaries>
    <output_format>...</output_format>
  </s>
```

Create initial prompt templates for at least these agents:
```
prompt-templates/
  ├── brand-agent.json
  ├── copy-agent.json
  ├── strategy-agent.json
  └── finance-agent.json
```

## Phase 0B: VirtualDispatcher

**Reference:** eve-orchestrator-spec.md (Agent Dispatch section)

```
BUILD:
  src/dispatchers/
    ├── virtual-dispatcher.ts   — Calls Anthropic API with PromptBuilder output
    ├── openclaw-dispatcher.ts  — Calls OpenClaw CLI for real agents
    └── dispatch-router.ts      — Routes to virtual or OpenClaw based on agent type

REAL_AGENTS = ['floor-manager', 'web-agent', 'launch-agent']
Everything else → VirtualDispatcher (direct Anthropic API)

VirtualDispatcher flow:
  1. PromptBuilder.build(agentRole, floorId, taskType, inputs)
  2. ModelRouter.selectModel(agentRole, taskCategory) → opus/sonnet/haiku
  3. anthropic.messages.create({ model, system: prompt, messages: [task] })
  4. Record cost (input_tokens × rate + output_tokens × rate)
  5. Write output to workspace file
  6. Return result
```

## Phase 0C: TaskManager

**Reference:** eve-orchestrator-spec.md (Task Lifecycle section)

```
BUILD:
  src/orchestrator/
    ├── task-manager.ts       — Task CRUD + lifecycle transitions
    ├── dependency-graph.ts   — DAG with ready-task detection
    └── concurrency.ts        — Limits simultaneous dispatches

TASK LIFECYCLE:
  CREATED → QUEUED → DISPATCHED → WORKING → REVIEW → COMPLETED
  With: RETRY (max 3) and ESCALATED states

DEPENDENCY GRAPH:
  Tasks form a DAG. When task A completes, check if any tasks
  waiting on A are now fully unblocked → move them to QUEUED.
```

## Phase 0D: ModelRouter

**Reference:** eve-orchestrator-spec.md (Model Routing section)

```
BUILD:
  src/agents/model-router.ts

DEFAULT ROUTES:
  floor-manager:  { foundation: 'opus', routine: 'opus' }
  brand-agent:    { foundation: 'opus', routine: 'sonnet' }
  strategy-agent: { foundation: 'opus', routine: 'sonnet' }
  finance-agent:  { foundation: 'opus', routine: 'sonnet' }
  copy-agent:     { foundation: 'sonnet', routine: 'sonnet' }
  design-agent:   { foundation: 'opus', routine: 'sonnet' }
  video-agent:    { foundation: 'opus', routine: 'sonnet' }
  All others:     { foundation: 'sonnet', routine: 'sonnet' }
  analytics:      { foundation: 'haiku', routine: 'haiku' }
```

## Phase 0E: Integration Test

**Test:** Can the Orchestrator dispatch a task to a virtual Copy Agent and get back useful branded copy?

```
TEST FLOW:
  1. Create a mock Foundation Package (brand name, colors, voice)
  2. Write a simple Voice Sample
  3. PromptBuilder assembles the prompt
  4. VirtualDispatcher calls Anthropic
  5. Copy Agent returns product description in brand voice
  6. Verify: output matches brand voice, under word limit, no AI slop
```

---

# PHASE 1: FLOOR CREATION + DASHBOARD API

**Reference:** eve-orchestrator-spec.md (Floor Creation + API Endpoints)

```
BUILD:
  src/floors/creator.ts       — 9-step floor creation sequence
  src/floors/workspace.ts     — File system workspace management
  src/server.ts               — Fastify API server
  src/integrations/supabase.ts — Database client

FLOOR CREATION SEQUENCE:
  1. Create database records (floor + phases + agents)
  2. Create workspace directories
  3. Register real agents with OpenClaw (FM, Web, Launch)
  4. Configure FM heartbeat
  5. Activate Phase 1
  6. Dispatch Foundation Sprint tasks
  7. Git commit
  8. Notify
  9. Broadcast state

API ENDPOINTS:
  GET  /api/floors
  POST /api/floors
  GET  /api/floors/:id
  GET  /api/floors/:id/tasks
  GET  /api/floors/:id/costs
  GET  /api/approvals
  POST /api/approvals/:id/approve
  POST /api/approvals/:id/reject
  POST /api/chat/:floorId/message
  GET  /api/health
```

---

# SPEC DOCUMENT INDEX

Read these as needed during implementation:

| Priority | Document | When to Read |
|---|---|---|
| 1 | eve-orchestrator-spec.md | Building the Orchestrator (Phase 0-1) |
| 1 | eve-promptbuilder-spec.md | Building PromptBuilder (Phase 0A) |
| 1 | eve-skills-knowledge.md | Agent expertise + prompt techniques (Phase 0A) |
| 2 | eve-api-infrastructure.md | API integration details (costs, rate limits, code) |
| 2 | eve-revised-agent-roster.md | Agent roles and responsibilities |
| 2 | eve-openclaw-config.md | OpenClaw file structure and agent registration |
| 3 | eve-end-to-end-workflow.md | Full 11-phase user journey |
| 3 | eve-workflow-architecture.md | Workflow patterns and pipeline definitions |
| 3 | eve-website-build-workflow.md | How Web Agent builds sites |
| 4 | eve-MASTER-SUMMARY.md | High-level overview of everything |
| 4 | eve-unified-spec-v2.md | Complete unified specification |
| 5 | All other docs | Reference as needed during specific feature work |
