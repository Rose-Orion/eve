# CLAUDE.md — EVE Project Briefing

## What This Project Is

EVE is an autonomous business-building system. A user describes a business idea → EVE evaluates it, assembles an AI agent team, builds everything (brand, website, products, content, ads), launches the business, then continuously operates and improves it.

This codebase is the **Orchestrator** — the central nervous system that coordinates all agents, manages tasks, tracks costs, and serves the Dashboard API.

## Architecture (Critical — Read First)

**Hybrid real/virtual agent model:**
- **4 real OpenClaw agents** (Floor Manager, Web Agent, Launch Agent, CEO Mode) — need shell access, heartbeats, persistent memory. Dispatched via `openclaw chat` CLI.
- **10 virtual agents** (Brand, Strategy, Finance, Copy, Design, Video, Commerce, Social, Ads, Analytics) — the Orchestrator calls the Anthropic API directly using PromptBuilder-constructed prompts. No OpenClaw needed.

**The Orchestrator drives everything deterministically.** It owns the task queue, dependency graph, concurrency limits, budget enforcement, and agent dispatch. The Floor Manager is advisory — it reports status and communicates with the owner but doesn't control task dispatch.

**Dashboard API runs inside the Orchestrator** as a Fastify server in the same Node.js process.

## Tech Stack

- Runtime: Node.js 24+, TypeScript (strict mode)
- API server: Fastify
- Task queue: BullMQ + Redis
- Database: Supabase (PostgreSQL + Realtime)
- LLM: @anthropic-ai/sdk (direct API for virtual agents)
- Media generation: @fal-ai/client (images + video), OpenAI SDK (GPT Image for text-in-images)
- Voice: ElevenLabs API
- Agent runtime: OpenClaw (real agents only)
- Process management: PM2

## Project Structure

```
~/orion-orchestrator/
  ├── CLAUDE.md                    # This file
  ├── specs/                       # All 25 specification documents
  │   ├── 00-MASTER-SUMMARY.md     # Start here — overview of everything
  │   ├── 01-orchestrator-spec.md  # THE most important spec — build this
  │   ├── 02-promptbuilder-spec.md # How prompts are assembled
  │   ├── 03-skills-knowledge.md   # Agent expertise and knowledge layers
  │   ├── 04-agent-roster.md       # 13 agents, roles, model tiers
  │   └── ...                      # (full list below)
  ├── src/
  │   ├── index.ts                 # Entry point (boot + health checks)
  │   ├── orchestrator/
  │   │   ├── index.ts             # Main Orchestrator class
  │   │   ├── task-manager.ts      # Task lifecycle
  │   │   ├── dependency-graph.ts  # DAG of task dependencies
  │   │   ├── virtual-dispatcher.ts # Direct Anthropic API for virtual agents
  │   │   ├── openclaw-dispatcher.ts # OpenClaw CLI for real agents
  │   │   ├── media-generator.ts   # fal.ai + OpenAI image/video calls
  │   │   ├── phase-manager.ts     # 10-phase build pipeline
  │   │   ├── concurrency.ts       # Rate limiting + parallel dispatch
  │   │   └── event-bus.ts         # Internal event system
  │   ├── clients/
  │   │   ├── anthropic.ts         # Anthropic SDK wrapper
  │   │   ├── fal.ts               # fal.ai SDK wrapper
  │   │   ├── openai.ts            # OpenAI (GPT Image only)
  │   │   ├── elevenlabs.ts        # Voice generation
  │   │   └── openclaw.ts          # OpenClaw CLI wrapper
  │   ├── prompt-builder/
  │   │   ├── index.ts             # PromptBuilder main class
  │   │   ├── template-loader.ts   # Load agent templates
  │   │   ├── brand-loader.ts      # Load Foundation Package + Voice Sample
  │   │   ├── example-loader.ts    # Load Gold Standard examples
  │   │   └── token-counter.ts     # Track token budget (8K ceiling)
  │   ├── agents/
  │   │   ├── registry.ts          # Agent registration (real + virtual)
  │   │   ├── health.ts            # Real agent health monitoring
  │   │   └── model-router.ts      # Opus/Sonnet/Haiku per task category
  │   ├── floors/
  │   │   ├── creator.ts           # Floor creation (9-step sequence)
  │   │   ├── lifecycle.ts         # Floor state machine
  │   │   └── workspace.ts         # File system management
  │   ├── server/
  │   │   ├── index.ts             # Fastify server setup
  │   │   ├── routes/              # Dashboard API endpoints
  │   │   └── middleware/           # Auth, error handling
  │   ├── integrations/
  │   │   ├── stripe.ts
  │   │   ├── meta.ts
  │   │   ├── tiktok.ts
  │   │   ├── printful.ts
  │   │   ├── resend.ts
  │   │   ├── kit.ts
  │   │   ├── supabase.ts
  │   │   └── notifications.ts
  │   ├── security/
  │   │   ├── guardian.ts          # Pre-execution verification
  │   │   ├── immutable-rules.ts   # 10 rules that never change
  │   │   └── budget-enforcer.ts   # Cost tracking + limits
  │   └── config/
  │       ├── index.ts
  │       └── types.ts
  ├── prompt-templates/            # Virtual agent persona templates (JSON)
  │   ├── brand-agent.json
  │   ├── strategy-agent.json
  │   ├── finance-agent.json
  │   ├── copy-agent.json
  │   ├── design-agent.json
  │   ├── video-agent.json
  │   ├── commerce-agent.json
  │   ├── social-media-agent.json
  │   ├── ads-agent.json
  │   └── analytics-agent.json
  ├── package.json
  ├── tsconfig.json
  └── .env
```

## Build Order (What to Build First)

### Phase 0, Week 1: Core Foundation
1. **PromptBuilder** — XML template assembly. Load agent role template + brand context + voice sample + gold standard examples + task + rules + boundaries + output format. Enforce 8K token ceiling.
2. **VirtualDispatcher** — Call Anthropic API directly with PromptBuilder output. Parse response. Record cost. Write output to workspace.
3. **TaskManager** — Task lifecycle: CREATED → QUEUED → DISPATCHED → WORKING → REVIEW → COMPLETED. With retry (3x), revision loops, and escalation.
4. **TEST**: Dispatch a task to virtual Copy Agent, get back a useful product description.

### Phase 0, Week 2: Coordination
5. **DependencyGraph** — DAG with `getReadyTasks()` and `onTaskCompleted()` cascade.
6. **OpenClawDispatcher** — Dispatch to real agents via `openclaw chat --agent {id} --message "{prompt}" --json`.
7. **ConcurrencyManager** — Max 4 agents, max 2 Opus, min 2s between dispatches.
8. **BudgetEnforcer** — Check budget before every dispatch. Alerts at 50/75/90%.
9. **FloorCreator** — The 9-step floor creation sequence.
10. **TEST**: Floor Manager + Brand Agent coordinate on a Foundation Sprint task.

### Phase 1: Dashboard API
11. Fastify server with REST endpoints
12. Supabase integration (database + realtime)
13. Push notifications

## Key Design Decisions

1. **XML-structured prompts.** Claude parses XML 23% more accurately than Markdown. All PromptBuilder templates use XML tags: `<role>`, `<brand_context>`, `<expertise>`, `<examples>`, `<task>`, `<rules>`, `<boundaries>`, `<output_format>`.

2. **Voice Sample system.** Brand Agent generates a 500-word voice reference during Foundation Sprint. Loaded into every Copy, Social, and Ads agent call (~250 tokens). Eliminates tone drift.

3. **Gold Standard Examples.** Approved outputs accumulate over time and get loaded as few-shot examples. Month 1: templates. Month 3+: ~85% first-try approval rate.

4. **Generated Knowledge pattern.** Strategy, Finance, and Ads agents generate facts BEFORE reasoning. Two-phase prompts prevent hallucination.

5. **Anti-slop detection.** Copy Agent and Floor Manager quality review reject outputs containing: "elevate", "unlock", "leverage", "delve", "game-changer", "streamline", "cutting-edge", etc.

6. **One task per prompt.** Never combine reasoning + generation + formatting in a single API call.

7. **Model Router.** Per agent, per task category: Foundation Sprint → Opus, Routine → Sonnet, Analytics → Haiku. Configurable.

## Specification Documents

Read these in order of relevance to what you're building:

| Priority | File | What It Covers |
|---|---|---|
| **BUILD THIS** | `01-orchestrator-spec.md` | Task lifecycle, dispatch, dependencies, concurrency, floor creation, API endpoints |
| **BUILD THIS** | `02-promptbuilder-spec.md` | XML template structure, token budget, pipeline, per-agent templates |
| **BUILD THIS** | `03-skills-knowledge.md` | Agent expertise, voice sample, gold standards, knowledge library |
| Reference | `00-MASTER-SUMMARY.md` | Overview of everything — start here if confused |
| Reference | `04-agent-roster.md` | 13 agents with roles, tiers, boundaries |
| Reference | `05-workflow-architecture.md` | 5 workflow layers, Lobster pipelines |
| Reference | `06-api-infrastructure.md` | Every API: Anthropic, fal.ai, OpenAI, Stripe, Meta, etc. |
| Reference | `07-end-to-end-workflow.md` | 11 phases from idea to operations |
| Reference | `08-unified-spec.md` | Complete unified specification |
| Later | `09-website-build-workflow.md` | Next.js build process |
| Later | `10-social-media-workflow.md` | Content lifecycle |
| Later | `11-ads-workflow.md` | Campaign architecture |
| Later | `12-creative-workflows.md` | Multi-model image/video routing |
| Later | `13-sourcing-fulfillment.md` | POD integration |
| Later | `14-email-customer-journey.md` | Email sequences |
| Later | `15-self-improvement-engine.md` | Bounded learning system |
| Later | `16-security-deep-spec.md` | Security tiers, GDPR |
| Later | `17-business-intelligence.md` | CEO Mode knowledge base |
| Later | `18-dashboard-ui.md` | PWA design |
| Later | `19-supplementary-specs.md` | Database schema, testing, backup/DR |
| Later | `20-openclaw-config.md` | OpenClaw file structure |
| Later | `21-mac-mini-setup.md` | Hardware setup guide |
| Later | `22-strategic-review.md` | Stress-test findings |
| Later | `23-master-plan.md` | Original assessment |
| Later | `24-audit.md` | Gap analysis |

## Environment

The Mac Mini is already set up with:
- OpenClaw running (gateway active, CEO Mode agent registered)
- Redis running
- Node.js 24
- PM2 managing processes
- The boot script at `src/index.ts` verifies all connections

## Commands

```bash
# Run the orchestrator
npx tsx src/index.ts

# Run with PM2
pm2 start "npx tsx src/index.ts" --name eve-orchestrator

# Test CEO Mode
openclaw chat --agent eve-ceo --message "test"

# Check system health
openclaw status --deep
redis-cli ping
pm2 list
```
