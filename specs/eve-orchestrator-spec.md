# EVE — Orchestrator Specification
## The Central Nervous System of the Entire Platform

---

# WHAT THE ORCHESTRATOR IS

The Orchestrator is a custom TypeScript service that sits between you (via the Dashboard) and the AI layer. It's the single point of control for everything: dispatching tasks, tracking dependencies, managing budgets, enforcing rules, and coordinating the entire system.

**The Orchestrator is also a direct Anthropic API client.** Most agents (9-10 of 13) are "virtual" — they don't run as real OpenClaw agents. Instead, the Orchestrator calls the Anthropic API directly using the PromptBuilder to construct the right persona, brand context, and task instructions. This is simpler, cheaper, and more predictable.

**Only 3-4 agents per floor are real OpenClaw agents** — the ones that need persistent state, heartbeats, or shell access (Floor Manager, Web Agent, Launch Agent). Plus CEO Mode as a global agent.

```
YOU (Dashboard PWA)
     │
     ▼
ORCHESTRATOR (TypeScript service on Mac Mini)
     │
     ├── VIRTUAL AGENTS → Direct Anthropic API calls
     │   (Brand, Strategy, Finance, Copy, Design, Video,
     │    Commerce, Social, Ads, Analytics)
     │   Orchestrator builds prompt via PromptBuilder,
     │   calls Anthropic, writes output to workspace.
     │
     ├── REAL AGENTS → OpenClaw Gateway
     │   (Floor Manager, Web Agent, Launch Agent, CEO Mode)
     │   These need shell access, heartbeats, or persistent memory.
     │
     ├── MEDIA GENERATION → fal.ai + OpenAI APIs
     │   Orchestrator calls directly when Design/Video agents
     │   specify what to generate.
     │
     ├── EXTERNAL SERVICES → Stripe, Meta, TikTok, Printful, etc.
     │   Orchestrator calls directly when agents specify actions.
     │
     ├── STATE → Supabase (database + real-time)
     ├── NOTIFICATIONS → Web Push API
     └── RULES → Security config (immutable)
```

---

# ARCHITECTURE

## Tech Stack

```
Runtime: Node.js 24+ (current recommended)
Language: TypeScript (strict mode)
Framework: Fastify (API server for Dashboard communication)
Queue: BullMQ + Redis (task queue with retry, priority, concurrency)
Database: Supabase (PostgreSQL via @supabase/supabase-js)
Real-time: Supabase Realtime (broadcasts state changes to Dashboard)
LLM client: @anthropic-ai/sdk (direct API calls for virtual agents)
Media client: @fal-ai/client (image + video generation)
File system: Direct access to __PATH_EVE_PROJ__ (shared workspaces)
OpenClaw: CLI calls for real agents only (Floor Manager, Web Agent, Launch Agent)
Process management: PM2 (keeps the Orchestrator alive, auto-restart)
```

## Core Components

```
src/
  ├── server.ts                 # Fastify API server (Dashboard endpoints)
  ├── orchestrator/
  │   ├── index.ts              # Main Orchestrator class
  │   ├── task-manager.ts       # Task lifecycle (create → dispatch → track → complete)
  │   ├── dependency-graph.ts   # DAG of task dependencies
  │   ├── virtual-dispatcher.ts # Dispatches to virtual agents (direct Anthropic API)
  │   ├── openclaw-dispatcher.ts# Dispatches to real agents (OpenClaw CLI)
  │   ├── media-generator.ts    # Calls fal.ai + OpenAI for image/video generation
  │   ├── phase-manager.ts      # Manages 10-phase build pipeline
  │   ├── concurrency.ts        # Limits simultaneous API calls
  │   └── event-bus.ts          # Internal event system
  ├── agents/
  │   ├── registry.ts           # Agent registration (real + virtual) and status
  │   ├── health.ts             # Real agent health monitoring via OpenClaw
  │   └── model-router.ts       # Routes tasks to Opus/Sonnet/Haiku per config
  ├── clients/
  │   ├── anthropic.ts          # Anthropic SDK client (virtual agent calls)
  │   ├── fal.ts                # fal.ai client (image + video generation)
  │   ├── openai.ts             # OpenAI client (GPT Image for text-in-images)
  │   ├── elevenlabs.ts         # ElevenLabs client (voiceover)
  │   └── openclaw.ts           # OpenClaw CLI wrapper (real agent dispatch)
  ├── floors/
  │   ├── creator.ts            # Floor creation sequence
  │   ├── lifecycle.ts          # Floor state machine (building → live → paused)
  │   └── workspace.ts          # File system workspace management
  ├── integrations/
  │   ├── stripe.ts             # Stripe webhook processing
  │   ├── meta.ts               # Meta Graph API + Marketing API
  │   ├── tiktok.ts             # TikTok Content + Marketing APIs
  │   ├── printful.ts           # Printful POD API
  │   ├── resend.ts             # Transactional email
  │   ├── kit.ts                # Marketing email (ConvertKit)
  │   ├── supabase.ts           # Database client
  │   └── notifications.ts      # Push notification sender
  ├── security/
  │   ├── guardian.ts           # Pre-execution verification
  │   ├── immutable-rules.ts    # The 10 rules that can never change
  │   └── budget-enforcer.ts    # Cost tracking and budget limits
  └── config/
      ├── index.ts              # Configuration loader
      └── types.ts              # TypeScript type definitions
```

---

# THE TASK LIFECYCLE

Every piece of work in EVE flows through this lifecycle:

```
CREATED → QUEUED → DISPATCHED → WORKING → REVIEW → COMPLETED
                                    │         │
                                    │         ├── REVISION → DISPATCHED (loop)
                                    │         └── REJECTED → COMPLETED (with rejection)
                                    │
                                    └── FAILED → RETRY → DISPATCHED (max 3x)
                                                   └── ESCALATED (after 3 failures)
```

## Task Structure

```typescript
interface Task {
  id: string;                          // UUID
  floorId: string;                     // Which floor this belongs to
  phaseNumber: number;                 // Which build phase (1-10)
  
  // Who
  assignedAgent: string;               // "brand-agent", "copy-agent", etc.
  modelTier: 'opus' | 'sonnet' | 'haiku';  // Which model to use
  
  // What
  taskType: string;                    // "create-brand-options", "write-homepage-copy", etc.
  description: string;                 // Human-readable description
  prompt: string;                      // Full prompt (built by PromptBuilder)
  inputFiles: string[];                // Workspace files this task reads from
  outputFiles: string[];               // Workspace files this task should produce
  
  // Dependencies
  dependsOn: string[];                 // Task IDs that must complete first
  blockedBy: string[];                 // Currently blocking tasks (computed)
  
  // Lifecycle
  status: TaskStatus;
  priority: 'critical' | 'high' | 'normal' | 'low';
  attempts: number;                    // Retry count (max 3)
  
  // Cost
  estimatedCostCents: number;
  actualCostCents: number;
  
  // Timing
  createdAt: Date;
  dispatchedAt: Date | null;
  completedAt: Date | null;
  
  // Output
  result: TaskResult | null;           // Agent's output
  reviewStatus: 'pending' | 'approved' | 'revision-requested' | 'rejected' | null;
  reviewFeedback: string | null;
}
```

---

# THE MAIN EVENT LOOP

The Orchestrator runs a continuous loop that processes events and advances work:

```typescript
class Orchestrator {
  private taskQueue: BullMQ.Queue;
  private eventBus: EventBus;
  
  async start() {
    // 1. Initialize connections
    await this.connectToSupabase();
    await this.connectToRedis();
    await this.verifyOpenClaw();
    
    // 2. Load active floors
    const floors = await this.loadActiveFloors();
    
    // 3. Start the event loop
    this.eventBus.on('task:created', this.onTaskCreated);
    this.eventBus.on('task:completed', this.onTaskCompleted);
    this.eventBus.on('task:failed', this.onTaskFailed);
    this.eventBus.on('agent:output-detected', this.onAgentOutput);
    this.eventBus.on('floor:phase-complete', this.onPhaseComplete);
    this.eventBus.on('approval:received', this.onApprovalReceived);
    this.eventBus.on('heartbeat:floor-manager', this.onFloorManagerHeartbeat);
    
    // 4. Start the task processor
    this.startTaskProcessor();
    
    // 5. Start the file watcher (detects agent output files)
    this.startFileWatcher();
    
    // 6. Start the health monitor
    this.startHealthMonitor();
    
    console.log('Orchestrator running.');
  }
}
```

## How Tasks Flow

```
1. FLOOR MANAGER HEARTBEAT fires (or you give a command)
   │
   ▼
2. Floor Manager decides what work needs to happen
   (reads phase status, checks what's done, what's next)
   │
   ▼
3. Floor Manager tells Orchestrator: "Dispatch these tasks"
   (via structured output in its heartbeat response)
   │
   ▼
4. Orchestrator creates Task objects and checks dependencies:
   │
   ├── Dependencies met? → QUEUE the task
   │
   └── Dependencies not met? → WAIT (task stays in CREATED status)
       (Orchestrator re-checks when blocking tasks complete)
   │
   ▼
5. Task PROCESSOR picks up queued tasks (respecting concurrency limits):
   │
   ├── Check budget: can we afford this task?
   │   └── NO → pause task, alert owner
   │
   ├── Check Guardian: does this task violate any rules?
   │   └── YES → reject task, log, notify Floor Manager
   │
   ├── Build prompt via PromptBuilder
   │
   └── Dispatch to OpenClaw:
       openclaw chat --agent {agentId} --message "{prompt}" --json
   │
   ▼
6. Agent WORKS on the task (OpenClaw session)
   │
   ├── Agent writes output files to workspace
   │
   └── Agent responds with structured result
   │
   ▼
7. Orchestrator DETECTS completion:
   │
   ├── Parse agent response (structured JSON output)
   ├── Verify expected output files exist
   ├── Record cost (from OpenClaw response metadata)
   ├── Update task status → COMPLETED or REVIEW
   │
   ├── If task needs review (content, designs, etc.):
   │   └── Create approval queue item → notify Dashboard
   │
   └── If task is auto-approved (technical tasks):
       └── Mark complete → check if any WAITING tasks are now unblocked
   │
   ▼
8. DEPENDENCY CASCADE:
   For each task that was waiting on this one:
     └── Are ALL dependencies now met?
         YES → move to QUEUED → processor picks it up
         NO → keep waiting
```

---

# DEPENDENCY GRAPH

Tasks form a directed acyclic graph (DAG). The Orchestrator enforces this.

```
EXAMPLE: FaithForge Build Phase Dependencies

FOUNDATION SPRINT (parallel, no dependencies):
  [brand-options]     (Brand Agent)
  [business-strategy] (Strategy Agent)
  [budget-plan]       (Finance Agent)
  
  All three start immediately. No dependencies between them.

FOUNDATION REVIEW (depends on all three above):
  [foundation-review] → depends on: brand-options, business-strategy, budget-plan
  This is a Gate 1 approval. Waits for your input.

POST-FOUNDATION (depends on foundation-review being approved):
  [design-tokens]     → depends on: foundation-review
  [homepage-copy]     → depends on: foundation-review
  [product-catalog]   → depends on: foundation-review
  
  All three start in parallel once Gate 1 passes.

WEBSITE BUILD (mixed dependencies):
  [wireframes]        → depends on: design-tokens
  [product-images]    → depends on: product-catalog
  [site-scaffold]     → depends on: design-tokens
  [homepage-build]    → depends on: wireframes, homepage-copy, site-scaffold
  [product-pages]     → depends on: homepage-build, product-images, product-catalog
  [checkout-flow]     → depends on: site-scaffold (can start early)
  [analytics-setup]   → depends on: site-scaffold

CONTENT PRODUCTION (parallel with website build):
  [content-calendar]  → depends on: foundation-review
  [social-graphics]   → depends on: design-tokens, content-calendar
  [social-videos]     → depends on: design-tokens, content-calendar
  [ad-creative]       → depends on: design-tokens, product-images
```

```typescript
class DependencyGraph {
  private graph: Map<string, Set<string>>; // taskId → set of dependency taskIds
  
  addTask(taskId: string, dependsOn: string[]): void;
  
  // Returns tasks that have ALL dependencies completed
  getReadyTasks(): string[];
  
  // Called when a task completes — checks if any blocked tasks are now ready
  onTaskCompleted(taskId: string): string[]; // returns newly unblocked task IDs
  
  // Validates no circular dependencies exist
  validate(): boolean;
  
  // Visualizes the graph (for debugging)
  toMermaid(): string;
}
```

---

# CONCURRENCY MANAGEMENT

Running too many agents simultaneously causes rate limits, high costs, and coordination chaos.

```typescript
interface ConcurrencyConfig {
  // Global limits
  maxConcurrentAgents: number;        // Default: 4 (start conservative)
  maxConcurrentOpus: number;          // Default: 2 (Opus is expensive + rate limited)
  maxConcurrentSonnet: number;        // Default: 3
  maxConcurrentHaiku: number;         // Default: 5
  
  // Per-floor limits
  maxAgentsPerFloor: number;          // Default: 3
  
  // Rate limiting
  minDelayBetweenDispatchMs: number;  // Default: 2000 (2 seconds between dispatches)
  backoffOnRateLimit: boolean;        // Default: true
  backoffMultiplier: number;          // Default: 2 (exponential backoff)
}
```

```
DISPATCH LOGIC:

  When a task is QUEUED and ready for dispatch:
  
  1. Check global concurrency: are we below maxConcurrentAgents?
     NO → wait in queue, check again in 5 seconds
  
  2. Check model tier concurrency: are we below max for this model?
     NO → wait in queue
  
  3. Check floor concurrency: is this floor below its limit?
     NO → wait in queue (other floors' tasks may dispatch first)
  
  4. Check rate limit cooldown: has enough time passed since last dispatch?
     NO → wait until cooldown expires
  
  5. All checks pass → DISPATCH
  
  PRIORITY ORDERING (when multiple tasks are queued):
  1. Critical priority first (Gate reviews, incidents)
  2. High priority (user-requested tasks, revisions)
  3. Normal priority (scheduled production tasks)
  4. Low priority (optimization, non-urgent improvements)
  
  Within same priority: FIFO (first in, first out)
```

---

# AGENT DISPATCH (DUAL PATTERN)

The Orchestrator dispatches tasks via two paths depending on the agent type:

## Virtual Agent Dispatch (9-10 agents — direct Anthropic API)

Used for: Brand, Strategy, Finance, Copy, Design, Video, Commerce, Social, Ads, Analytics

```typescript
class VirtualDispatcher {
  private anthropic: Anthropic;
  
  async dispatchTask(task: Task): Promise<void> {
    // 1. Build the prompt via PromptBuilder
    const prompt = await this.promptBuilder.build({
      agentRole: task.assignedAgent,
      floorId: task.floorId,
      taskType: task.taskType,
      taskDescription: task.description,
      inputContext: await this.loadInputFiles(task.inputFiles),
    });
    
    // 2. Guardian check
    const guardianResult = await this.guardian.verify({
      agent: task.assignedAgent,
      action: task.taskType,
      estimatedCost: task.estimatedCostCents,
      floorBudgetRemaining: await this.getBudgetRemaining(task.floorId),
    });
    if (!guardianResult.approved) {
      await this.failTask(task.id, `Guardian blocked: ${guardianResult.reason}`);
      return;
    }
    
    // 3. Select model tier via Model Router
    const model = this.modelRouter.selectModel(task.assignedAgent, task.taskCategory);
    
    // 4. Call Anthropic API directly
    const response = await this.anthropic.messages.create({
      model: model,                        // "claude-opus-4-6" or "claude-sonnet-4-6" or "claude-haiku-4-5"
      max_tokens: 4096,
      system: prompt.systemPrompt,         // Agent role + brand context + rules
      messages: [
        { role: 'user', content: prompt.taskPrompt }  // The specific task
      ],
    });
    
    // 5. Extract output
    const output = response.content[0].type === 'text' 
      ? response.content[0].text 
      : JSON.stringify(response.content);
    
    // 6. Record cost
    await this.recordCost({
      floorId: task.floorId,
      agent: task.assignedAgent,
      model: model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      costCents: this.calculateCost(response.usage, model),
      taskId: task.id,
    });
    
    // 7. Check budget
    const budgetStatus = await this.checkBudget(task.floorId);
    if (budgetStatus.alert) {
      await this.sendBudgetAlert(task.floorId, budgetStatus);
    }
    
    // 8. Write output to workspace
    for (const outputFile of task.outputFiles) {
      await this.writeToWorkspace(task.floorId, outputFile, output);
    }
    
    // 9. If Design/Video agent requested media generation, execute it
    if (task.taskType.startsWith('generate-image') || task.taskType.startsWith('generate-video')) {
      await this.mediaGenerator.executeFromAgentOutput(task, output);
    }
    
    // 10. Mark task complete
    await this.processTaskCompletion(task.id, output);
  }
}
```

## Real Agent Dispatch (3-4 agents — OpenClaw CLI)

Used for: Floor Manager, Web Agent, Launch Agent (need shell access, memory, or heartbeats)

```typescript
class OpenClawDispatcher {
  
  async dispatchTask(task: Task): Promise<void> {
    const agentId = `${task.assignedAgent}-${task.floorSlug}`;
    
    // 1. Guardian check (same as virtual)
    const guardianResult = await this.guardian.verify({
      agent: task.assignedAgent,
      action: task.taskType,
      estimatedCost: task.estimatedCostCents,
      floorBudgetRemaining: await this.getBudgetRemaining(task.floorId),
    });
    if (!guardianResult.approved) {
      await this.failTask(task.id, `Guardian blocked: ${guardianResult.reason}`);
      return;
    }
    
    // 2. Build prompt (may be simpler — real agents have SOUL.md context already)
    const message = await this.promptBuilder.buildTaskMessage({
      taskType: task.taskType,
      taskDescription: task.description,
      inputContext: await this.loadInputFiles(task.inputFiles),
    });
    
    // 3. Dispatch via OpenClaw CLI
    const result = await execAsync(
      `openclaw chat --agent ${agentId} \
        --message "${escapeForShell(message)}" \
        --json --no-streaming`,
      { 
        timeout: 600000,  // 10 min timeout (shell commands may run long)
        cwd: this.getWorkspacePath(task.floorId),
      }
    );
    
    // 4. Parse result and record cost
    const response = JSON.parse(result.stdout);
    await this.recordCost({
      floorId: task.floorId,
      agent: task.assignedAgent,
      model: response.model || 'unknown',
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      costCents: this.estimateCostFromOpenClaw(response),
      taskId: task.id,
    });
    
    // 5. Process completion
    await this.processTaskCompletion(task.id, response);
  }
}
```

## Dispatch Router

```typescript
// The Orchestrator decides which dispatcher to use based on agent type

const REAL_AGENTS = ['floor-manager', 'web-agent', 'launch-agent'];

class TaskDispatcher {
  private virtualDispatcher: VirtualDispatcher;
  private openclawDispatcher: OpenClawDispatcher;
  
  async dispatch(task: Task): Promise<void> {
    if (REAL_AGENTS.includes(task.assignedAgent)) {
      await this.openclawDispatcher.dispatchTask(task);
    } else {
      await this.virtualDispatcher.dispatchTask(task);
    }
  }
}
```

---

# FILE WATCHER (Agent Output Detection)

Agents write files to the shared workspace. The Orchestrator watches for these.

```typescript
class FileWatcher {
  // Watches __PATH_EVE_PROJ__{floorSlug}/ for changes
  
  watch(floorSlug: string): void {
    const watcher = chokidar.watch(
      path.join(PROJECTS_DIR, floorSlug),
      { 
        ignoreInitial: true,
        ignored: ['**/node_modules/**', '**/.git/**', '**/.next/**'],
      }
    );
    
    watcher.on('add', (filePath) => this.onFileCreated(floorSlug, filePath));
    watcher.on('change', (filePath) => this.onFileChanged(floorSlug, filePath));
  }
  
  private async onFileCreated(floorSlug: string, filePath: string) {
    // Check if this file is an expected output of any active task
    const task = await this.findTaskExpecting(floorSlug, filePath);
    if (task) {
      this.eventBus.emit('agent:output-detected', { 
        taskId: task.id, 
        filePath,
        floorSlug,
      });
    }
  }
}
```

---

# FLOOR CREATION SEQUENCE

When you tap "Build it" in the Dashboard:

```typescript
class FloorCreator {
  
  async createFloor(config: FloorConfig): Promise<Floor> {
    
    // === STEP 1: DATABASE RECORDS ===
    const floor = await this.db.floors.create({
      name: config.name,
      slug: slugify(config.name),
      goal: config.goal,
      status: 'building',
      trust_level: 1,
      budget_ceiling_cents: config.budgetCeilingCents,
      config: config.floorConfig,
    });
    
    // Create all 10 phases (pending)
    for (const phase of PHASE_DEFINITIONS) {
      await this.db.phases.create({
        floor_id: floor.id,
        phase_number: phase.number,
        name: phase.name,
        status: 'pending',
      });
    }
    
    // === STEP 2: FILE SYSTEM ===
    const workspacePath = path.join(PROJECTS_DIR, floor.slug);
    await fs.mkdir(workspacePath, { recursive: true });
    
    // Create workspace directories
    for (const dir of ['brand', 'copy', 'design', 'product', 'website', 
                         'content', 'ads', 'analytics', '.eve']) {
      await fs.mkdir(path.join(workspacePath, dir), { recursive: true });
    }
    
    // Initialize git repo
    await execAsync('git init', { cwd: workspacePath });
    
    // === STEP 3: AGENT REGISTRATION ===
    const REAL_AGENT_ROLES = ['floor-manager', 'web-agent', 'launch-agent'];
    const allAgentConfigs = this.selectAgents(config.goalType);
    
    // 3a. Register REAL agents with OpenClaw (only 3 per floor)
    for (const agentConfig of allAgentConfigs.filter(a => REAL_AGENT_ROLES.includes(a.role))) {
      const agentDir = path.join(workspacePath, '.eve', 'agents', agentConfig.role);
      await fs.mkdir(agentDir, { recursive: true });
      
      // Generate SOUL.md, AGENTS.md for real agents
      const soulMd = await this.promptBuilder.buildSoulMd(agentConfig, floor);
      await fs.writeFile(path.join(agentDir, 'SOUL.md'), soulMd);
      
      const agentsMd = await this.promptBuilder.buildAgentsMd(allAgentConfigs, agentConfig);
      await fs.writeFile(path.join(agentDir, 'AGENTS.md'), agentsMd);
      
      // Register with OpenClaw Gateway
      await execAsync(
        `openclaw agents add --id ${agentConfig.role}-${floor.slug} ` +
        `--model ${agentConfig.modelId} ` +
        `--workspace ${agentDir}`,
      );
    }
    
    // 3b. Create database records for ALL agents (real + virtual)
    for (const agentConfig of allAgentConfigs) {
      const isReal = REAL_AGENT_ROLES.includes(agentConfig.role);
      await this.db.agents.create({
        floor_id: floor.id,
        role: agentConfig.role,
        model_tier: agentConfig.tier,
        status: 'idle',
        openclaw_agent_id: isReal ? `${agentConfig.role}-${floor.slug}` : null,
        config: { ...agentConfig, dispatch_type: isReal ? 'openclaw' : 'virtual' },
      });
    }
    
    // === STEP 4: FLOOR MANAGER HEARTBEAT ===
    // Only Floor Manager gets a heartbeat
    const fmAgentId = `floor-manager-${floor.slug}`;
    
    // Generate HEARTBEAT.md
    const heartbeatMd = this.generateHeartbeatMd(floor);
    await fs.writeFile(
      path.join(workspacePath, '.eve', 'agents', 'floor-manager', 'HEARTBEAT.md'),
      heartbeatMd,
    );
    
    // Configure heartbeat in OpenClaw
    // (Floor Manager checks in every 60 seconds during build, 
    //  every 5 minutes post-launch)
    
    // === STEP 5: ACTIVATE PHASE 1 ===
    await this.db.phases.update(
      { floor_id: floor.id, phase_number: 1 },
      { status: 'active', started_at: new Date() },
    );
    
    // === STEP 6: DISPATCH FOUNDATION SPRINT ===
    await this.createFoundationTasks(floor);
    
    // === STEP 7: INITIAL GIT COMMIT ===
    await execAsync('git add -A && git commit -m "Floor created: initial setup"', 
      { cwd: workspacePath });
    
    // === STEP 8: NOTIFY ===
    await this.notifications.send({
      floorId: floor.id,
      tier: 'important',
      title: `${floor.name} created`,
      body: 'Foundation Sprint started. Brand options ready in ~2 hours.',
    });
    
    // === STEP 9: BROADCAST STATE ===
    await this.supabase.channel('floors').send({
      type: 'broadcast',
      event: 'floor:created',
      payload: { floorId: floor.id, name: floor.name },
    });
    
    return floor;
  }
}
```

---

# ERROR HANDLING & RECOVERY

```
AGENT TASK FAILS:
  Attempt 1: normal dispatch
  Attempt 2: retry after 30 seconds (same prompt)
  Attempt 3: retry after 60 seconds (simplified prompt — remove non-essential context)
  All 3 fail: 
    → Mark task as ESCALATED
    → Floor Manager notified
    → Floor Manager can: reassign to different agent, modify the task, or escalate to you
    → Push notification if escalation lasts > 30 minutes

RATE LIMIT HIT:
  → Exponential backoff: 5s, 10s, 20s, 40s, 80s
  → During backoff: other tasks from other floors can still dispatch (if different model)
  → If rate limited for > 5 minutes: switch queued Opus tasks to Sonnet temporarily
  → Log rate limit events for cost optimization analysis

OPENCLAW CRASH:
  → PM2 auto-restarts the process
  → Orchestrator detects the restart and re-queues any DISPATCHED tasks that didn't complete
  → No data loss (task state is in Supabase, not in memory)

SUPABASE DOWN:
  → Orchestrator switches to local SQLite fallback for critical operations
  → Queues database writes for sync when Supabase recovers
  → Dashboard shows "Database temporarily unavailable — operating in offline mode"
  → Push notification if down > 10 minutes

MAC MINI POWER LOSS:
  → PM2 auto-starts Orchestrator on boot
  → Orchestrator loads all active floors and agents from Supabase
  → Any DISPATCHED tasks that didn't complete → re-queued
  → Floor Managers check in on next heartbeat → system self-heals

BUDGET EXCEEDED:
  → Budget enforcer pauses all tasks for that floor
  → Floor Manager sends a final "budget exhausted" message
  → Push notification: "Floor X paused — budget at 100%"
  → No tasks can dispatch until budget is increased
  → Other floors are unaffected
```

---

# API ENDPOINTS (Dashboard Communication)

```
The Dashboard PWA communicates with the Orchestrator via REST + WebSocket.

REST ENDPOINTS:
  GET    /api/floors                     → List all floors
  GET    /api/floors/:id                 → Floor detail (overview data)
  GET    /api/floors/:id/agents          → Agent status for a floor
  GET    /api/floors/:id/tasks           → Active tasks for a floor
  GET    /api/floors/:id/costs           → Cost breakdown for a floor
  POST   /api/floors                     → Create a new floor
  PATCH  /api/floors/:id                 → Update floor settings
  
  GET    /api/approvals                  → All pending approval items
  POST   /api/approvals/:id/approve      → Approve an item
  POST   /api/approvals/:id/reject       → Reject with feedback
  
  GET    /api/improvements               → All improvement proposals
  POST   /api/improvements/:id/approve   → Approve a proposal
  POST   /api/improvements/:id/reject    → Reject a proposal
  
  POST   /api/chat/:floorId/message      → Send message to Floor Manager
  GET    /api/chat/:floorId/history       → Get chat history
  
  GET    /api/health                     → System health status
  GET    /api/costs/summary              → Cross-floor cost summary

WEBSOCKET (Supabase Realtime):
  Channel: floors:{floorId}
  Events: 
    - agent:status-changed
    - task:completed
    - phase:changed
    - cost:updated
    - content:published
    - order:received
    - approval:needed

  The Dashboard subscribes to relevant floor channels 
  and updates in real-time without polling.
```

---

# MODEL ROUTING

The configurable tier system for Brand and Strategy agents:

```typescript
interface ModelRouterConfig {
  // Per agent, per task category
  routes: {
    [agentRole: string]: {
      // Task categories and which model tier to use
      foundation: 'opus' | 'sonnet';    // Foundation sprint tasks
      routine: 'opus' | 'sonnet';       // Daily operations
      review: 'opus' | 'sonnet';        // Quality review tasks
      escalation: 'opus' | 'sonnet';    // Escalated/complex tasks
    }
  }
}

// DEFAULT CONFIGURATION:
const defaultRoutes: ModelRouterConfig = {
  routes: {
    'floor-manager':  { foundation: 'opus', routine: 'opus', review: 'opus', escalation: 'opus' },
    'brand-agent':    { foundation: 'opus', routine: 'sonnet', review: 'sonnet', escalation: 'opus' },
    'strategy-agent': { foundation: 'opus', routine: 'sonnet', review: 'sonnet', escalation: 'opus' },
    'finance-agent':  { foundation: 'opus', routine: 'sonnet', review: 'sonnet', escalation: 'opus' },
    'copy-agent':     { foundation: 'sonnet', routine: 'sonnet', review: 'sonnet', escalation: 'sonnet' },
    'web-agent':      { foundation: 'sonnet', routine: 'sonnet', review: 'sonnet', escalation: 'sonnet' },
    'design-agent':   { foundation: 'opus', routine: 'sonnet', review: 'opus', escalation: 'opus' },
    'video-agent':    { foundation: 'opus', routine: 'sonnet', review: 'opus', escalation: 'opus' },
    'commerce-agent': { foundation: 'sonnet', routine: 'sonnet', review: 'sonnet', escalation: 'sonnet' },
    'social-agent':   { foundation: 'sonnet', routine: 'sonnet', review: 'sonnet', escalation: 'sonnet' },
    'ads-agent':      { foundation: 'sonnet', routine: 'sonnet', review: 'sonnet', escalation: 'sonnet' },
    'launch-agent':   { foundation: 'sonnet', routine: 'sonnet', review: 'sonnet', escalation: 'sonnet' },
    'analytics-agent':{ foundation: 'haiku', routine: 'haiku', review: 'haiku', escalation: 'sonnet' },
  }
};

// You can override any of these via Settings:
// "I want Brand Agent on Opus for everything" → change routine to 'opus'
// The Improvement Engine can also propose tier changes based on quality data
```

---

# IMPLEMENTATION PRIORITY

```
WEEK 1 (Core):
  ├── Project scaffold (TypeScript, Fastify, BullMQ, Redis)
  ├── Supabase connection + core tables
  ├── Task lifecycle (create, queue, dispatch placeholder, complete)
  ├── Dependency graph (DAG with ready-task detection)
  ├── Basic OpenClaw integration (dispatch one task, get result)
  └── PM2 configuration for auto-restart

WEEK 2 (Coordination):
  ├── Floor creation sequence
  ├── Agent registry + status tracking
  ├── Concurrency manager
  ├── File watcher (agent output detection)
  ├── Budget enforcer (cost tracking + alerts)
  └── Guardian agent (pre-execution checks)

WEEK 3 (Communication):
  ├── Dashboard API endpoints
  ├── Supabase Realtime broadcasting
  ├── Push notification system
  ├── Chat relay (Dashboard → Floor Manager → response)
  ├── Approval queue management
  └── Error recovery + retry logic

WEEK 4 (Integration):
  ├── PromptBuilder integration
  ├── Model router (Opus/Sonnet/Haiku per task)
  ├── Lobster pipeline integration
  ├── Phase manager (10-phase build pipeline)
  ├── First full floor creation test
  └── End-to-end smoke test
```
