# EVE Architecture Overview

## System Topology

EVE is a hybrid real/virtual autonomous agent orchestration system. It coordinates 14 agents (4 real + 10 virtual) to build and operate D2C businesses from business ideas.

```
┌─────────────────────────────────────────────────────────────┐
│                    Dashboard (Web UI)                        │
│                  http://localhost:3000                       │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                   API Gateway                                │
│                  Fastify + Express                           │
│          (Auth middleware, CORS, logging)                   │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│              ORCHESTRATOR (Node.js)                          │
│  Central nervous system — coordinates all agents            │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Task Manager: Lifecycle, retries, escalation        │   │
│  │ Dependency Graph: DAG of phase tasks                │   │
│  │ Concurrency: Max 4 agents, 2 Opus, 2s delay        │   │
│  │ Budget Enforcer: Per-floor spending limits          │   │
│  │ Guardian: Pre-flight security checks                │   │
│  │ Event Bus: Internal pub/sub for all events          │   │
│  │ Phase Manager: 10-phase business build pipeline     │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────┬──────────────────────────────────────┘
        ┌──────────────┼──────────────────┐
        │              │                  │
        ▼              ▼                  ▼
    ┌───────────┐  ┌────────────┐   ┌──────────────┐
    │ Virtual   │  │   Real     │   │  External    │
    │ Agents    │  │  Agents    │   │ Integrations │
    │ (Direct   │  │ (OpenClaw) │   │              │
    │ API call) │  │            │   │ Anthropic    │
    │           │  │ Floor Mgr  │   │ FAL.ai       │
    │ Brand     │  │ Web Agent  │   │ OpenAI       │
    │ Strategy  │  │ Launch Agn │   │ Stripe       │
    │ Finance   │  │ CEO Mode   │   │ Meta/TikTok  │
    │ Copy      │  │            │   │ Printful     │
    │ Design    │  │            │   │ Resend       │
    │ Video     │  │            │   │ ElevenLabs   │
    │ Commerce  │  │            │   │ Kit.co       │
    │ Social    │  │            │   │ Supabase     │
    │ Ads       │  │            │   │ Redis        │
    │ Analytics │  │            │   │              │
    └───────────┘  └────────────┘   └──────────────┘
```

## Data Flow: Idea to Launch

```
1. OWNER IDEA
   ↓
2. CEO MODE
   (Floor Manager evaluates, assembles agent team)
   ↓
3. ORCHESTRATOR
   Phase 0: Foundation Sprint (Brand voice, strategy)
     └→ GATE 1: Owner approval required
   ↓
   Phase 1-3: Brand Build (design, copy, social)
   ↓
   Phase 4: Website (Next.js code generation)
   ↓
   Phase 5-6: Products & Commerce (ecommerce setup)
   ↓
   Phase 7: Launch Prep (verification, testing)
     └→ GATE 2: Owner approval required
   ↓
   Phase 8: Live Launch (DNS, deploy, go live)
   ↓
   Phase 9: Operations (monitoring, optimization)
     └→ GATE 3: Owner approval for ads
   ↓
4. CONTINUOUS IMPROVEMENT ENGINE
   (Analytics, optimization, A/B testing)
```

## Core Components

### 1. Orchestrator (src/orchestrator/)
The central coordinator. Owns task queue, dependency graph, concurrency, and dispatch.

**Key Classes**:
- **Orchestrator**: Main event loop
- **TaskManager**: Task lifecycle (CREATED → QUEUED → DISPATCHED → WORKING → REVIEW → COMPLETED)
- **DependencyGraph**: DAG of task dependencies
- **ConcurrencyManager**: Rate limiting and parallel constraints
- **VirtualDispatcher**: Direct Anthropic API calls
- **OpenClawDispatcher**: CLI-based real agent dispatch
- **PhaseManager**: 10-phase pipeline state machine

### 2. Security Layer (src/security/)
Pre-flight verification before every dispatch.

**Key Classes**:
- **Guardian**: Checks PII, budget, concurrency, API keys, anti-slop phrases
- **BudgetEnforcer**: Per-floor spending limits with alerts (50%, 75%, 90%)
- **ImmutableRules**: 10 hard-coded rules that cannot be overridden
- **TrustLadder**: Owner approval gates for high-risk actions
- **ApprovalToken**: Cryptographic tokens for financial transactions

### 3. Prompt Engineering (src/prompt-builder/)
XML-based prompt assembly with 8K token ceiling.

**Process**:
1. Load agent role template
2. Inject brand context + voice sample
3. Add task definition
4. Include gold standard examples (3+ for accuracy)
5. Add rules and boundaries
6. Enforce 8K token budget
7. Return composed prompt

### 4. Database (Supabase PostgreSQL)
Single source of truth. Stores: Floors, Tasks, Costs, Messages, Approvals, Outputs.

**Key Features**:
- Row-level security (per-floor isolation)
- Real-time subscriptions (push to dashboard)
- Automatic backups (daily)
- Vector search for content similarity

### 5. API Gateway (Fastify)
RESTful + WebSocket interface for dashboard and integrations.

**Routes**:
- `/api/floors` - Create/list/manage floors
- `/api/tasks` - Task status and history
- `/api/approvals` - Task reviews and owner decisions
- `/api/costs` - Budget tracking
- `/api/chat` - Owner ↔ Floor Manager conversation
- `/api/health` - System health and integrations
- `/ws` - WebSocket for real-time updates

### 6. Event Bus (Internal Pub/Sub)
Decoupled communication between components.

**Events**:
- `task:created`, `task:completed`, `task:failed`
- `cost:recorded`, `budget:alert`, `budget:exceeded`
- `approval:needed`, `approval:received`
- `phase:started`, `phase:completed`
- `agent:health:changed`

## Agent Roster

### Real Agents (OpenClaw)
Persistent processes on Mac Mini. High autonomy, direct file access.

1. **Floor Manager**: Orchestrates phase transitions, handles escalations, communicates with owner
2. **Web Agent**: Builds Next.js site, configures hosting, deploys code
3. **Launch Agent**: Performs pre-launch checks, creates DNS records, coordinates go-live
4. **CEO Mode**: Long-context multi-step reasoning, business decisions (Opus only)

### Virtual Agents (Direct API)
Stateless. Called via Anthropic API. Excellent for single-task work.

1. **Brand Agent**: Foundation voice, brand positioning, target audience (Opus)
2. **Strategy Agent**: Business model, pricing, positioning, growth (Sonnet)
3. **Finance Agent**: Budget analysis, P&L projections, cost optimization (Sonnet)
4. **Copy Agent**: Product copy, ad text, email sequences (Sonnet)
5. **Design Agent**: Color palette, typography, layout direction (Sonnet)
6. **Video Agent**: Script writing, video concept, voiceover direction (Sonnet)
7. **Commerce Agent**: Ecommerce setup, product catalog, fulfillment (Sonnet)
8. **Social Media Agent**: Content calendar, captions, hashtags (Sonnet)
9. **Ads Agent**: Campaign strategy, targeting, creative brief (Opus)
10. **Analytics Agent**: Metrics definition, dashboard design, KPI tracking (Haiku)

## Key Design Decisions

### 1. XML-Structured Prompts
Claude parses XML 23% more accurately than Markdown.

```xml
<role>You are the Copy Agent...</role>
<brand_context>
  <voice>Playful, authentic, conversational</voice>
  <target_audience>Women 25-40, eco-conscious</target_audience>
</brand_context>
<expertise>10-year copywriter...</expertise>
<examples>
  <gold_standard>
    <input>Water bottle product</input>
    <output>{{approved copy}}</output>
  </gold_standard>
</examples>
<task>Write product description for {{product}}</task>
<rules>No marketing buzzwords, no jargon</rules>
<boundaries>Max 150 words, conversational tone</boundaries>
<output_format>Plain text, no markdown</output_format>
```

### 2. Voice Sample System
Brand Agent generates 500-word voice reference during Foundation Sprint. Loaded into every Copy, Social, and Ads call (~250 tokens). Eliminates tone drift, ensures brand consistency.

### 3. Gold Standard Examples
Approved outputs accumulate over time. Few-shot examples improve accuracy dramatically:
- Month 1: Generic templates
- Month 2: ~40% first-try approval rate
- Month 3+: ~85% first-try approval rate

### 4. Generated Knowledge Pattern
Strategy, Finance, Ads agents generate facts BEFORE reasoning.

```
Step 1: Generate facts about the market
Step 2: List assumptions
Step 3: Reason through options
Step 4: Make recommendation
```

Prevents hallucination by anchoring in concrete data.

### 5. Anti-Slop Detection
Output contains: "elevate", "unlock", "leverage", "delve", "game-changer", "streamline", "cutting-edge", "synergy"?
→ Reject and re-run with "avoid marketing jargon" instruction.

### 6. One Task Per Prompt
Never combine reasoning + generation + formatting in a single API call. Split into separate tasks:
- Task A: Strategy Agent generates strategy
- Task B: Copy Agent writes copy based on strategy
- Task C: Design Agent creates designs based on copy

Improves accuracy and enables human review gates.

### 7. Model Router
Configurable per-agent, per-task-category:

| Phase | Agent | Model |
|-------|-------|-------|
| Foundation | Brand, Strategy | Opus |
| Routine | Copy, Design, Social | Sonnet |
| Analytics | Analytics | Haiku |

Balances cost, latency, and quality.

## Concurrency & Rate Limiting

```
Global Limits:
  - Max 4 agents active concurrently
  - Max 2 Opus agents
  - Max 2 Sonnet agents
  - Min 2s between dispatches

Per-Floor Limits:
  - Max 2 agents per floor
  - Prevents resource starvation

Timeout:
  - Opus: 5 minutes
  - Sonnet: 3 minutes
  - Haiku: 2 minutes
```

## Error Handling & Resilience

```
Task Failure → Retry (up to 3x with exponential backoff)
                 ↓
                All retries exhausted → Escalate to Floor Manager
                 ↓
            Floor Manager reviews & either:
              - Adjusts task and re-dispatches
              - Escalates to owner for decision
```

## Technology Stack Summary

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 24, TypeScript (strict) |
| API Server | Fastify 5 |
| Task Queue | BullMQ + Redis |
| Database | Supabase (PostgreSQL) |
| LLM | Anthropic Claude (direct SDK) |
| Media | FAL.ai (images/video), OpenAI (text-in-image) |
| Voice | ElevenLabs |
| Agent Runtime | OpenClaw (real agents) |
| Process Management | PM2 |
| Auth | Bearer token + Supabase JWT |

## File Structure

```
src/
  index.ts                    # Boot, health checks
  orchestrator/               # Core coordination
    index.ts                  # Main Orchestrator
    task-manager.ts           # Task lifecycle
    dependency-graph.ts       # DAG
    virtual-dispatcher.ts     # Anthropic API
    openclaw-dispatcher.ts    # OpenClaw CLI
    concurrency.ts            # Rate limiting
    phase-manager.ts          # 10-phase pipeline
    event-bus.ts              # Pub/sub
  security/                   # Pre-flight checks
    guardian.ts               # Verification
    budget-enforcer.ts        # Spending limits
    immutable-rules.ts        # 10 hard rules
    approval-token.ts         # Crypto approval
  prompt-builder/             # Prompt assembly
    index.ts                  # Main builder
    template-loader.ts        # Agent templates
    brand-loader.ts           # Brand context
    example-loader.ts         # Gold standards
  agents/                     # Agent registry
    registry.ts               # Agent metadata
    health.ts                 # Health checks
    model-router.ts           # Model selection
  server/                     # API + Dashboard
    index.ts                  # Fastify setup
    routes/                   # API endpoints
    middleware/               # Auth, error handling
  clients/                    # External APIs
    anthropic.ts              # Claude API
    fal.ts                    # Image/video
    openai.ts                 # GPT image
    elevenlabs.ts             # Voice
    openclaw.ts               # OpenClaw CLI
  integrations/               # Third-party services
    supabase.ts               # Database
    stripe.ts                 # Payments
    meta.ts, tiktok.ts        # Social media
    printful.ts               # Print-on-demand
    resend.ts                 # Email
    notifications.ts          # Push/webhooks
```

## Scaling Considerations

**Vertical Scaling** (increase Mac Mini resources):
- More CPU → faster task dispatch
- More RAM → more concurrent agents
- Faster SSD → quicker file I/O

**Horizontal Scaling** (multiple Mac Minis):
- Not currently supported
- Would require distributed task queue (already using BullMQ)
- Shared Supabase database (already supports multiple clients)
- Agent health pings would need coordination

**Cost Optimization**:
- Use Haiku for analytics and summary tasks
- Batch similar tasks (copy, designs, etc.)
- Cache generated outputs (avoid re-running)
- Limit Opus to Foundation and Launch phases
