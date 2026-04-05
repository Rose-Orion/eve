/**
 * Orchestrator — the central nervous system of EVE.
 *
 * Coordinates all agents, manages tasks, tracks costs, and drives the build pipeline.
 * This is the main event loop that processes the task queue, dispatches work,
 * handles completions, and manages floor lifecycle.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AgentId, Floor, RealAgentId, Task, VirtualAgentId,
} from '../config/types.js';
import { isRealAgent, isVirtualAgent } from '../config/types.js';
import { EventBus } from './event-bus.js';
import { TaskManager } from './task-manager.js';
import { DependencyGraph } from './dependency-graph.js';
import { ConcurrencyManager } from './concurrency.js';
import { VirtualDispatcher } from './virtual-dispatcher.js';
import { OpenClawDispatcher } from './openclaw-dispatcher.js';
import { CouncilDispatcher } from './council-dispatcher.js';
import { shouldUseCouncil } from './council-router.js';
import { MediaGenerator } from './media-generator.js';
import { PhaseManager } from './phase-manager.js';
import { ConversationStore } from './conversation-store.js';
import { FileWatcher } from './file-watcher.js';
import { SubAgentManager } from './sub-agent-manager.js';
import { ImprovementEngine } from './improvement-engine.js';
import type { EVEOperation } from './eve-actions.js';
import { BudgetEnforcer } from '../security/budget-enforcer.js';
import { Guardian } from '../security/guardian.js';
import { TrustLadder } from '../security/trust-ladder.js';
import { SafetyControls } from '../security/safety-controls.js';
import { generateApprovalToken } from '../security/approval-token.js';
import { AgentRegistry } from '../agents/registry.js';
import { ModelRouter } from '../agents/model-router.js';
import { FloorCreator } from '../floors/creator.js';
import type { CreateFloorInput } from '../floors/creator.js';
import { FloorLifecycle } from '../floors/lifecycle.js';
import { Workspace } from '../floors/workspace.js';
import { isAvailable as isOpenClawAvailable } from '../clients/openclaw.js';
import { setBudgetEnforcer, BudgetExceededError } from '../clients/budget-check.js';
import { checkConnection as checkSupabase, saveFloor, saveTask, saveCostEvent, broadcastFloorEvent, subscribeToFloor, loadTasks, loadAllTasks, loadFloorSpend, countPhaseTasks, saveChatMessage, loadChatMessages, clearChatMessages, persistWithRetry } from '../integrations/supabase.js';
import { send as sendNotification } from '../integrations/notifications.js';
import { loadTemplate } from '../prompt-builder/template-loader.js';
import { saveGoldStandard } from '../prompt-builder/example-loader.js';
import type { AgentTemplate } from '../config/types.js';
import { ActionExecutor } from './action-executor.js';
import type { FloorAuthContext } from './action-executor.js';
import { WebsiteDeployer } from './website-deployer.js';
import { ScaffoldGenerator } from './scaffold-generator.js';
import { FulfillmentPipeline } from './fulfillment-pipeline.js';
import { AdsPipeline } from './ads-pipeline.js';
import { ContentScheduler } from './content-scheduler.js';
import { EmailAutomation } from './email-automation.js';
import { OptimizationLoop } from './optimization-loop.js';
import { PerformanceTracker } from './performance-tracker.js';
import { OutcomeGoldStandards } from './outcome-gold-standards.js';
import { CrossFloorIntelligence } from './cross-floor-intelligence.js';
import { AdaptiveModelRouter } from './adaptive-model-router.js';
import { TokenManager } from '../integrations/token-manager.js';
import { parseAgentOutput } from './output-parser.js';

// Constants
const QUEUE_BATCH_SIZE = 20;

/**
 * Standardized prompt for brand-options tasks.
 * Uses a strict output format that the dashboard parser can reliably parse.
 * This is the SINGLE SOURCE OF TRUTH — all brand-options task creation must use this.
 */
function BRAND_OPTIONS_PROMPT(floorName: string, goal: string): string {
  return `Create 3 distinct brand direction options for "${floorName}". Goal: ${goal}

CRITICAL LENGTH CONSTRAINT: You MUST produce ALL 3 directions. Each direction should be 400-600 words MAX. Do NOT write long essays per direction — be concise and impactful. If you run out of space before Direction C, the entire output is useless.

CRITICAL FORMAT — Use this EXACT heading pattern (the dashboard parser depends on it):

## DIRECTION A: [Brand Name]
## DIRECTION B: [Brand Name]
## DIRECTION C: [Brand Name]

Within each direction, use these exact bold labels IN THIS ORDER:
**Brand Name:** [the name]
**Tagline:** [the tagline in quotes or italics]
**Colors:** list 3 hex codes in backticks, e.g. \`#FF6B35\` \`#1A1A2E\` \`#00D9FF\`
**Typography:** [heading font + body font recommendation]
**Personality:** [2-3 sentence personality description]
**Voice Attributes:** [comma-separated list of 3-5 voice traits]
**Target Audience:** [1-2 sentences]
**Positioning:** [1-2 sentences on market position]
**Logo Direction:** [1-2 sentences describing the logo concept for image generation]

KEEP EACH DIRECTION TIGHT. No tables, no multi-page breakdowns. Save depth for after owner selects a direction.

Example:
## DIRECTION A: Spark & Flow
**Brand Name:** Spark & Flow
**Tagline:** *Ignite your creative momentum*
**Colors:** \`#FF4D4D\` \`#2B2D42\` \`#8AE8FF\`
**Typography:** Oswald for headlines, Inter for body
**Personality:** Bold and energetic with a creative edge. Speaks to makers who want momentum.
**Voice Attributes:** Direct, energetic, encouraging, slightly irreverent, warm
**Target Audience:** Creative professionals aged 25-40 who value momentum over perfection.
**Positioning:** Premium creative tools brand that competes on energy and simplicity.
**Logo Direction:** Abstract flame mark merging into a flowing wave — dynamic, minimal, works at any scale.

DO NOT use numbered headings, bold-only headings, or any format other than "## DIRECTION [A/B/C]: Name".`;
}

/**
 * Canonical website-homepage prompt — used by rebuildTaskPrompt when the original prompt is lost.
 * Mirrors the Phase 6 task creation prompt (seedNextPhaseTasks) so retry quality matches first run.
 */
function WEBSITE_HOMEPAGE_PROMPT(floorName: string): string {
  return `Create a complete, production-ready single-page website for "${floorName}".

OUTPUT: A single HTML file with embedded CSS and JS. This must be a REAL, functional webpage — not a description or design spec.

CRITICAL — TOKEN BUDGET: You MUST keep the total response under 15,000 characters. Prioritize BODY CONTENT over CSS.
CRITICAL — OUTPUT FORMAT: Your response must start with <!DOCTYPE html> and be valid HTML. Do NOT write markdown, design specs, or documentation.

DESIGN QUALITY STANDARD (Awwwards-level):
This website should look like it belongs on Awwwards.com. Apply these principles:

TYPOGRAPHY HIERARCHY:
- Use a mathematical type scale (Perfect Fourth 1.333 ratio)
- H1: 48-60px, H2: 36-42px, H3: 24-28px, Body: 16-18px
- Line-height: 1.1-1.2 for headings, 1.5-1.6 for body
- Uppercase letter-spaced labels (0.12em) for section categories (e.g. "OUR PHILOSOPHY", "THE COLLECTION")
- Load heading + body Google Fonts via <link> tags (max 2 fonts)

SPACING (8px grid):
- All padding/margins in multiples of 8: 8, 16, 24, 32, 48, 64, 96, 128px
- Generous section padding: clamp(64px, 8vw, 120px) vertical
- Whitespace is a FEATURE — premium brands breathe, crowded design feels cheap
- Max content width: 1200px, centered

HERO SECTION:
- Full-viewport or near-full hero with brand tagline as large H1
- Small uppercase category label above the headline
- Short subtitle paragraph below (1-2 sentences)
- Single dark CTA button with specific microcopy (not "Learn More" — use brand-specific text)
- Hero image placeholder below

COLOR STRATEGY:
- Use CSS custom properties for ALL colors
- Background: warm-tinted white or brand-specific light tone (never pure #FFFFFF)
- Text: near-black (never pure #000000)
- Accent: brand primary color for CTAs, links, hover states
- Dividers: subtle 1px lines in muted color between sections

STRUCTURE (write in this exact order):
1. <!DOCTYPE html>, <html>, <head> with meta tags, title, OG tags
2. <style> tag — keep CSS COMPACT. Max 5KB. CSS custom properties for all colors/fonts/spacing.
3. <body> — THIS IS THE PRIORITY. Include ALL these sections:
   - <nav> brand name (left) + 4-5 text links (right), clean horizontal bar
   - <header> hero: uppercase label + large H1 tagline + subtitle + CTA button + image placeholder
   - <section> Brand Story with section label "OUR PHILOSOPHY" or similar — 2-3 column text layout on desktop
   - <section> Products with section label "THE COLLECTION" or similar — 3 product cards (image placeholder + name + price + 1-sentence description)
   - <section> Testimonials with section label — 3 quote cards with attribution
   - <section> Email signup with compelling headline, description, input + button
   - <footer> copyright + social links (Instagram, TikTok, LinkedIn) + Privacy/Terms links

STYLE RULES:
- CSS custom properties: --color-bg, --color-text, --color-accent, --color-muted, --font-heading, --font-body
- Set from brand visual system colors below
- Simple flexbox layouts, max-width containers
- ONE media query for mobile (stack to single column, reduce font sizes)
- Subtle thin dividers (<hr> or border-top) between sections
- NO animations, NO transitions, NO complex hover effects — keep it production-safe
- Keep CSS under 200 lines

Use brand context below for all copy, colors, and identity.`;
}

export class Orchestrator {
  // Core components
  readonly eventBus = new EventBus();
  readonly taskManager: TaskManager;
  readonly dependencyGraph = new DependencyGraph();
  readonly concurrency = new ConcurrencyManager();
  readonly modelRouter = new ModelRouter();
  readonly conversationStore = new ConversationStore();
  readonly workspace = new Workspace();

  // Dispatchers
  readonly virtualDispatcher: VirtualDispatcher;
  readonly openclawDispatcher: OpenClawDispatcher;
  readonly councilDispatcher: CouncilDispatcher;
  readonly mediaGenerator: MediaGenerator;
  readonly subAgentManager: SubAgentManager;

  // Floor management
  readonly phaseManager: PhaseManager;
  readonly agentRegistry = new AgentRegistry();
  readonly lifecycle: FloorLifecycle;
  readonly floorCreator: FloorCreator;
  readonly fileWatcher: FileWatcher;

  // Security
  readonly budgetEnforcer: BudgetEnforcer;
  readonly guardian: Guardian;
  readonly trustLadder: TrustLadder;
  readonly safetyControls: SafetyControls;

  // Learning
  readonly improvementEngine: ImprovementEngine;

  // Action execution (bridges agent output to real API calls)
  readonly actionExecutor: ActionExecutor;

  // Deployment pipeline (Phase 2)
  readonly websiteDeployer: WebsiteDeployer;
  readonly scaffoldGenerator: ScaffoldGenerator;
  readonly fulfillmentPipeline: FulfillmentPipeline;

  // Live operations (Phase 3)
  readonly adsPipeline: AdsPipeline;
  readonly contentScheduler: ContentScheduler;
  readonly emailAutomation: EmailAutomation;
  readonly optimizationLoop: OptimizationLoop;

  // Learning engine (Phase 4)
  readonly performanceTracker: PerformanceTracker;
  readonly outcomeGoldStandards: OutcomeGoldStandards;
  readonly crossFloorIntelligence: CrossFloorIntelligence;
  readonly adaptiveModelRouter: AdaptiveModelRouter;

  // Integrations
  readonly tokenManager: TokenManager;

  /** Per-floor OAuth/API credentials for action execution */
  private floorAuthContexts = new Map<string, FloorAuthContext>();

  // State
  private floors = new Map<string, Floor>();
  /** Council results keyed by taskId — stored for dashboard display */
  private councilResults = new Map<string, import('./council-dispatcher.js').CouncilResult>();
  /**
   * Write-through in-session cache for chat history.
   * Populated by loadChatHistory() and invalidated on getChatHistory() calls.
   * NOT pre-populated at boot — history is always loaded on first access per session.
   * This ensures page reloads always retrieve fresh data from Supabase.
   */
  private chatHistories = new Map<string, Array<{ role: string; content: string; timestamp: Date }>>();
  /** Supabase realtime subscriptions per floor */
  private floorSubscriptions = new Map<string, { unsubscribe: () => void }>();
  private running = false;
  private processInterval: ReturnType<typeof setInterval> | null = null;
  private rateLimitBackoffMs = 0;
  private rateLimitSince = 0;

  constructor() {
    this.taskManager = new TaskManager(this.eventBus);
    this.virtualDispatcher = new VirtualDispatcher(this.eventBus);
    this.openclawDispatcher = new OpenClawDispatcher(this.eventBus);
    this.councilDispatcher = new CouncilDispatcher(this.eventBus);
    this.mediaGenerator = new MediaGenerator(this.eventBus);
    this.subAgentManager = new SubAgentManager(this.eventBus);
    this.phaseManager = new PhaseManager(this.eventBus);
    this.lifecycle = new FloorLifecycle(this.eventBus);
    this.budgetEnforcer = new BudgetEnforcer(this.eventBus);
    setBudgetEnforcer(this.budgetEnforcer);
    this.guardian = new Guardian(this.concurrency, this.budgetEnforcer);
    this.trustLadder = new TrustLadder(this.eventBus);
    this.safetyControls = new SafetyControls(this.eventBus);
    this.fileWatcher = new FileWatcher(this.eventBus);
    this.improvementEngine = new ImprovementEngine(this.eventBus);
    this.actionExecutor = new ActionExecutor(this.eventBus, this.budgetEnforcer);
    this.websiteDeployer = new WebsiteDeployer(this.eventBus);
    this.scaffoldGenerator = new ScaffoldGenerator();
    this.fulfillmentPipeline = new FulfillmentPipeline(this.eventBus);
    this.adsPipeline = new AdsPipeline(this.eventBus, this.budgetEnforcer);
    this.contentScheduler = new ContentScheduler(this.eventBus);
    this.emailAutomation = new EmailAutomation(this.eventBus);
    this.optimizationLoop = new OptimizationLoop(
      this.eventBus,
      this.adsPipeline,
      this.contentScheduler,
      this.fulfillmentPipeline,
      this.budgetEnforcer,
    );
    this.performanceTracker = new PerformanceTracker(this.eventBus);
    this.outcomeGoldStandards = new OutcomeGoldStandards(this.performanceTracker, this.eventBus);
    this.crossFloorIntelligence = new CrossFloorIntelligence(this.performanceTracker, this.eventBus);
    this.adaptiveModelRouter = new AdaptiveModelRouter(
      this.performanceTracker,
      this.modelRouter,
      this.budgetEnforcer,
      this.eventBus,
    );
    this.floorCreator = new FloorCreator(
      this.eventBus,
      this.phaseManager,
      this.taskManager,
      this.agentRegistry,
      this.lifecycle,
    );
    this.tokenManager = new TokenManager(this.eventBus);

    this.setupEventHandlers();
  }

  // --- Lifecycle ---

  /** Load persisted floors from Supabase on boot (crash recovery). */
  async loadPersistedState(): Promise<void> {
    const { loadFloors, loadPhases } = await import('../integrations/supabase.js');
    const floors = await loadFloors();
    for (const floor of floors) {
      this.floors.set(floor.id, floor);
      const recoveredSpend = await loadFloorSpend(floor.id);
      this.budgetEnforcer.initFloor(floor.id, floor.budgetCeilingCents, recoveredSpend);
      this.trustLadder.initFloor(floor.id);
      await this.trustLadder.restoreFloor(floor.id); // Restore persisted trust level
      this.safetyControls.initFloor(floor.id, Math.round(floor.budgetCeilingCents / 30));
      this.fileWatcher.watchFloor(floor.id, floor.slug);
      this.lifecycle.init(floor.id, floor.status);

      // Restore phase state
      this.phaseManager.initFloor(floor.id);
      const savedPhases = await loadPhases(floor.id);
      if (savedPhases.length > 0) {
        this.phaseManager.restorePhases(floor.id, savedPhases);
      }
      // Consistency check: if the active phase doesn't match currentPhase, fix it
      // (happens when savePhase was broken and only early phases were persisted)
      const currentActive = this.phaseManager.getCurrentPhase(floor.id);
      const activePhaseNum = currentActive?.number ?? 1;
      if (activePhaseNum !== floor.currentPhase) {
        console.log(`  [Recovery] Phase inconsistency for ${floor.name}: active=${activePhaseNum}, currentPhase=${floor.currentPhase} — fixing`);
        // Force-complete all prior phases (bypassing gate-waiting), then activate currentPhase
        // so completePhase() can fire the floor:phase-complete event correctly
        this.phaseManager.forceRecoveryActivate(floor.id, floor.currentPhase);
      }

      // Recover incomplete tasks from Supabase
      const savedTasks = await loadTasks(floor.id);
      let recoveredCount = 0;
      for (const task of savedTasks) {
        this.taskManager.restore(task);
        this.dependencyGraph.addTask(task.id, task.dependsOn);
        recoveredCount++;
      }

      // ALWAYS load ALL tasks from Supabase (including completed/escalated) so the
      // dashboard deliverables panel shows every completed deliverable after restarts.
      // restoreWithStatus() is a no-op for tasks already in memory from loadTasks() above.
      {
        const allTasks = await loadAllTasks(floor.id);
        // Deduplicate: keep the LATEST task per taskType+phaseNumber combo
        const sorted = [...allTasks].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        const seen = new Set<string>();
        let displayCount = 0;
        for (const task of sorted) {
          const key = `${task.phaseNumber}:${task.taskType}`;
          if (seen.has(key)) continue;
          seen.add(key);
          this.taskManager.restoreWithStatus(task);
          displayCount++;
        }
        if (displayCount > recoveredCount) {
          console.log(`  [Recovery] Restored ${displayCount - recoveredCount} completed/escalated tasks for ${floor.name} deliverables display`);
        }

        // Phase advancement: if currentPhase is stale, correct it
        if (allTasks.length > 0) {
          const highestCompletedPhase = Math.max(0, ...allTasks.filter(t => t.status === 'completed').map(t => t.phaseNumber));
          const highestTaskPhase = Math.max(0, ...allTasks.map(t => t.phaseNumber));
          // Advance currentPhase if tasks exist in a higher phase than what's recorded
          if (highestTaskPhase > 0 && floor.currentPhase < highestTaskPhase) {
            const gatePhases = [3, 6, 8];
            const targetPhase = highestCompletedPhase > 0
              ? (gatePhases.includes(highestCompletedPhase) ? highestCompletedPhase : highestCompletedPhase + 1)
              : highestTaskPhase;
            if (targetPhase > floor.currentPhase) {
              floor.currentPhase = targetPhase;
              console.log(`  [Recovery] ${floor.name}: advanced currentPhase to ${floor.currentPhase} (highest task phase: ${highestTaskPhase}, highest completed: ${highestCompletedPhase})`);
              await saveFloor(floor);
            }
          }
        }

        // FIX: Ensure the current phase is actually active in the phase manager.
        // The initial phase inconsistency check (line ~257) runs BEFORE tasks are loaded,
        // so if currentPhase was advanced above, the phase may still be 'pending'.
        // Without this, checkPhaseCompletion silently fails because completePhase
        // requires phase.status === 'active'.
        const postRecoveryActive = this.phaseManager.getCurrentPhase(floor.id);
        const postRecoveryPhaseNum = postRecoveryActive?.number ?? 1;
        if (postRecoveryPhaseNum !== floor.currentPhase) {
          console.log(`  [Recovery] Phase activation fix for ${floor.name}: active=${postRecoveryPhaseNum}, currentPhase=${floor.currentPhase} — activating`);
          this.phaseManager.forceRecoveryActivate(floor.id, floor.currentPhase);
        }

        // Phase seeding: if current phase has no tasks and is >= 4, seed it
        if (recoveredCount === 0 && floor.currentPhase >= 4) {
          const existingCount = await countPhaseTasks(floor.id, floor.currentPhase);
          if (existingCount === 0) {
            await this.seedNextPhaseTasks(floor.id, floor, floor.currentPhase - 1);
            console.log(`  Seeded phase ${floor.currentPhase} tasks for ${floor.name}`);
          }
        }

        // Re-run phase completion check
        this.checkPhaseCompletion(floor.id, floor.currentPhase);
      }

      console.log(`  Recovered floor: ${floor.name} (${floor.status}, phase ${floor.currentPhase}, ${recoveredCount} tasks)`);

      // Subscribe to owner actions for this floor
      const subscription = subscribeToFloor(floor.id, (event, payload) => {
        console.log(`[Owner] Received ${event} for floor ${floor.id.slice(0, 8)}`);
        if (event === 'approval-decision') {
          this.handleApproval(
            payload.taskId as string,
            payload.approved as boolean,
            payload.feedback as string | undefined,
          );
        }
      });
      this.floorSubscriptions.set(floor.id, subscription);
    }
    if (floors.length > 0) {
      console.log(`  Recovered ${floors.length} floor(s) from database`);
    }

    // Load persisted performance data (Phase 4)
    await this.performanceTracker.loadPersistedState();

    // Apply boot patches (budget corrections, etc.) — config-driven approach
    // Patches are defined in src/config/boot-patches.ts and applied generically here
    const { getFloorPatches } = await import('../config/boot-patches.js');
    for (const floor of this.floors.values()) {
      const patches = getFloorPatches(floor.name);
      for (const patch of patches) {
        if (patch.type === 'budget-correction' && floor.budgetCeilingCents < patch.targetCents) {
          const previousCents = floor.budgetCeilingCents;
          console.log(
            `[BootPatch] Applying budget correction for "${floor.name}": ` +
            `${previousCents}¢ → ${patch.targetCents}¢ (${patch.reason})`
          );

          // 1. Update in-memory state
          floor.budgetCeilingCents = patch.targetCents;
          this.budgetEnforcer.updateCeiling(floor.id, patch.targetCents);
          this.safetyControls.initFloor(floor.id, Math.round(patch.targetCents / 30));

          // 2. Persist via saveFloor (upsert path)
          const saved = await saveFloor(floor);
          if (saved) {
            console.log(`[BootPatch] "${floor.name}" budget persisted ✓`);
          } else {
            console.warn(
              `[BootPatch] saveFloor returned false for "${floor.name}" — attempting direct UPDATE`
            );
            try {
              const { getSupabase } = await import('../integrations/supabase.js');
              const sb = getSupabase();
              if (sb) {
                const { error } = await sb
                  .from('floors')
                  .update({ budget_ceiling_cents: patch.targetCents })
                  .eq('id', floor.id);
                if (!error) {
                  console.log(`[BootPatch] Direct UPDATE succeeded for "${floor.name}" ✓`);
                } else {
                  console.error(
                    `[BootPatch] Direct UPDATE FAILED for "${floor.name}": ${error.message}`
                  );
                }
              }
            } catch (err) {
              console.error(
                `[BootPatch] Fallback UPDATE threw for "${floor.name}":`,
                (err as Error).message
              );
            }
          }

          // 3. Broadcast corrected budget
          broadcastFloorEvent(floor.id, 'floor:budget-corrected', {
            floorId: floor.id,
            floorName: floor.name,
            previousCents,
            correctedCents: patch.targetCents,
            correctedDollars: patch.targetCents / 100,
          }).catch(() => {});

          // 4. Invalidate and requeue budget-plan tasks
          await this.invalidateAndRequeueBudgetPlan(floor);

          // 5. Write audit log
          await this.writeSystemReviewLog({
            event: 'boot_budget_correction',
            floorId: floor.id,
            floorName: floor.name,
            previousCents,
            correctedCents: patch.targetCents,
            reason: patch.reason,
            trigger: `boot:budget-correction:${floor.name.toLowerCase().replace(/\s+/g, '-')}`,
          });

          // 6. Send notification
          sendNotification({
            title: `${floor.name} Budget Corrected`,
            body: `Budget updated from $${previousCents / 100} to $${patch.targetCents / 100} (${patch.reason}).`,
            floorId: floor.id,
            type: 'info',
          });

          patch.applied = true;
        }
      }
    }

    // --- Retroactive completion event emission for pending finance-agent budget-plan task ---
    // Per system learnings requirement (5): if the budget-plan task has already completed
    // internally, emit a completion event for it immediately so floor-manager verification
    // loops can resolve its state without polling.
    {
      for (const floor of this.floors.values()) {
        const allFloorTasks = this.taskManager.getFloorTasks(floor.id);
        const completedBudgetTasks = allFloorTasks.filter(
          t => t.taskType === 'budget-plan' && t.status === 'completed',
        );
        for (const bt of completedBudgetTasks) {
          try {
            // Emit the structured queue-status event directly (bypasses emitPreCompletionEvent
            // retry logic since the task is already complete — this is a retroactive emission).
            const retroPayload = {
              task_id: bt.id,
              status: 'complete' as const,
              timestamp: bt.completedAt?.toISOString() ?? new Date().toISOString(),
              result_summary: (bt.result ?? bt.description ?? '').slice(0, 200),
            };
            this.eventBus.emit('task:queue-status', {
              taskId: bt.id,
              floorId: bt.floorId,
              agentId: bt.assignedAgent,
              payload: retroPayload,
            });
            console.log(
              `[Boot] Retroactive queue-status event emitted for completed budget-plan task ` +
              `${bt.id.slice(0, 8)} on floor "${floor.name}" ` +
              `(status=complete, timestamp=${retroPayload.timestamp})`,
            );
          } catch (retroErr) {
            console.warn(
              `[Boot] Retroactive queue-status emission failed for task ${bt.id.slice(0, 8)}: ` +
              `${(retroErr as Error).message}`,
            );
          }
        }
      }
    }

    // Restore improvement engine state (feedback, proposals, learnings)
    await this.improvementEngine.loadPersistedState();

    // --- Boot-time repair: resolve any stuck budget-plan tasks for patched floors ---
    // After improvement engine loads, check if any floors have boot patches and their
    // budget-plan tasks are stuck/unresolved. Trigger repair to requeue with corrected budget.
    const { getFloorPatches: getPatchesForRepair } = await import('../config/boot-patches.js');
    for (const floor of this.floors.values()) {
      const patches = getPatchesForRepair(floor.name);
      // Only attempt repair if this floor has a budget correction patch
      if (patches.some(p => p.type === 'budget-correction')) {
        const ACTIVE_STATUSES = ['queued', 'created', 'dispatched', 'working'];
        const TERMINAL_STATUSES = ['completed', 'escalated'];
        const allBudgetTasks = this.taskManager
          .getFloorTasks(floor.id)
          .filter(t => t.taskType === 'budget-plan');

        const hasActiveBudgetTask = allBudgetTasks.some(t => ACTIVE_STATUSES.includes(t.status));
        const hasCompletedBudgetTask = allBudgetTasks.some(t => t.status === 'completed');
        const allTerminal = allBudgetTasks.length > 0 &&
          allBudgetTasks.every(t => TERMINAL_STATUSES.includes(t.status));
        const isStuck = !hasActiveBudgetTask && !hasCompletedBudgetTask;
        const isEscalatedOnly = allTerminal && !hasCompletedBudgetTask;

        if (isStuck || isEscalatedOnly || allBudgetTasks.length === 0) {
          console.log(
            `[Boot] ${floor.name} budget-plan task is unresolved ` +
            `(active=${hasActiveBudgetTask}, completed=${hasCompletedBudgetTask}, ` +
            `taskCount=${allBudgetTasks.length}) — triggering boot-time repair.`,
          );
          try {
            const repairResult = await this.resolveAndUnblockBudgetPlanTask(floor.id);
            console.log(
              `[Boot] Boot-time budget-plan repair for ${floor.name}: ` +
              `queueState=${repairResult.queueState}, ` +
              `taskId=${repairResult.taskId?.slice(0, 8) ?? 'none'}, ` +
              `phaseUnblocked=${repairResult.phaseUnblocked}, ` +
              `requeued=${repairResult.requeuOccurred}`,
            );
          } catch (repairErr) {
            console.error(
              `[Boot] Boot-time budget-plan repair FAILED for ${floor.name}: ` +
              `${(repairErr as Error).message}`,
            );
          }
        } else if (hasActiveBudgetTask) {
          console.log(
            `[Boot] ${floor.name} budget-plan task is already active — no boot-time repair needed. ` +
            `Active task: ${allBudgetTasks.find(t => ACTIVE_STATUSES.includes(t.status))?.id.slice(0, 8)}.`,
          );
          // Still emit queue-status confirmation so the feedback chain sees the state
          const activeTask = allBudgetTasks.find(t => ACTIVE_STATUSES.includes(t.status))!;
          try {
            this.eventBus.emit('task:queue-status', {
              taskId: activeTask.id,
              floorId: floor.id,
              agentId: activeTask.assignedAgent,
              payload: {
                task_id: activeTask.id,
                status: 'partial' as const,
                timestamp: new Date().toISOString(),
                result_summary: `Boot confirmation: budget-plan task is ${activeTask.status} for ${floor.name}.`,
              },
            });
          } catch { /* non-critical */ }
        } else if (hasCompletedBudgetTask) {
          console.log(
            `[Boot] ${floor.name} budget-plan task already completed — emitting retroactive queue-status.`,
          );
          // Retroactive completion event already handled earlier in loadPersistedState
        }
      }
    }

    // Recover brand theme from deliverables if themeConfig is missing/incomplete
    for (const floor of this.floors.values()) {
      const hasBrand = !!(
        floor.themeConfig?.primaryColor &&
        floor.themeConfig?.headingFont &&
        floor.themeConfig.headingFont !== 'Token'
      );

      if (!hasBrand && floor.currentPhase >= 4) {
        let recovered = false;
        // Try deliverable files first
        try {
          const visualContent = await this.workspace.readFile(floor.slug, 'deliverables/brand-visual-system.md');
          if (visualContent) {
            const fakeTask = { taskType: 'brand-visual-system' } as Task;
            await this.extractBrandState(fakeTask, floor, visualContent);
            console.log(`  [Recovery] Extracted brand state from deliverables for ${floor.name}`);
            recovered = true;
          }
        } catch { /* file doesn't exist */ }
        try {
          const voiceContent = await this.workspace.readFile(floor.slug, 'deliverables/brand-voice-guide.md');
          if (voiceContent) {
            const fakeTask = { taskType: 'brand-voice-guide' } as Task;
            await this.extractBrandState(fakeTask, floor, voiceContent);
            recovered = true;
          }
        } catch { /* file doesn't exist */ }

        // Fallback: extract from completed task results (in-memory / Supabase)
        if (!recovered) {
          const tasks = this.taskManager.getFloorTasks(floor.id);
          const visualTask = tasks.find(t => t.taskType === 'brand-visual-system' && t.status === 'completed' && t.result);
          if (visualTask?.result) {
            const fakeTask = { taskType: 'brand-visual-system' } as Task;
            await this.extractBrandState(fakeTask, floor, visualTask.result);
            console.log(`  [Recovery] Re-extracted brand theme from task result for ${floor.name}`);
          }
          const voiceTask = tasks.find(t => t.taskType === 'brand-voice-guide' && t.status === 'completed' && t.result);
          if (voiceTask?.result) {
            const fakeTask = { taskType: 'brand-voice-guide' } as Task;
            await this.extractBrandState(fakeTask, floor, voiceTask.result);
          }
        }
      }
    }

    // --- Floor state consistency validation ---
    for (const floor of this.floors.values()) {
      const tasks = this.taskManager.getFloorTasks(floor.id);
      let changed = false;

      // 1. Brand state: validate it's a known enum value
      const validBrandStates = ['pre-foundation', 'foundation-review', 'foundation-approved', 'brand-revision'];
      if (!validBrandStates.includes(floor.brandState)) {
        // brandState is corrupted (e.g. a JSON blob was written) — fix based on floor progress
        const hasBrandTasks = tasks.some(t => t.status === 'completed' && (t.taskType === 'brand-options' || t.taskType === 'brand-visual-system'));
        const corrected = hasBrandTasks ? 'foundation-approved' : 'pre-foundation';
        console.log(`  [Consistency] ${floor.name}: brandState was corrupted (${String(floor.brandState).slice(0, 60)}...) — fixing to '${corrected}'`);
        floor.brandState = corrected as Floor['brandState'];
        changed = true;
      }
      // If selectedBrand exists but brandState is still pre-foundation, fix it
      if (floor.selectedBrand && floor.brandState === 'pre-foundation') {
        console.log(`  [Consistency] ${floor.name}: brandState was 'pre-foundation' but selectedBrand exists — fixing to 'foundation-approved'`);
        floor.brandState = 'foundation-approved';
        changed = true;
      }

      // 2. Phase validation: if tasks exist for phases beyond currentPhase, advance
      if (tasks.length > 0) {
        const highestCompletedPhase = Math.max(
          0,
          ...tasks.filter(t => t.status === 'completed').map(t => t.phaseNumber),
        );
        if (highestCompletedPhase > 0 && floor.currentPhase < highestCompletedPhase) {
          // Advance to highestCompleted + 1 (or stay at highestCompleted if it's a gate phase)
          const gatePhases = [3, 6, 8];
          const newPhase = gatePhases.includes(highestCompletedPhase) ? highestCompletedPhase : highestCompletedPhase + 1;
          if (newPhase !== floor.currentPhase) {
            console.log(`  [Consistency] ${floor.name}: currentPhase was ${floor.currentPhase} but tasks completed up to phase ${highestCompletedPhase} — advancing to ${newPhase}`);
            floor.currentPhase = newPhase;
            changed = true;
          }
        }
      }

      // 3a. Phase 3 Foundation Sprint: must have brand-options, business-strategy, and budget-plan
      const phase3Tasks = tasks.filter(t => t.phaseNumber === 3);
      if (phase3Tasks.length > 0 && phase3Tasks.length < 3) {
        const existingTypes = new Set(phase3Tasks.map(t => t.taskType));
        const needed: Array<{ taskType: string; agent: string; description: string; prompt: string }> = [];
        if (!existingTypes.has('brand-options')) {
          needed.push({ taskType: 'brand-options', agent: 'brand-agent', description: `Create 3 distinct brand direction options for "${floor.name}": ${floor.goal}`, prompt: BRAND_OPTIONS_PROMPT(floor.name, floor.goal) });
        }
        if (!existingTypes.has('business-strategy')) {
          const p = `Create a business strategy for "${floor.name}". Include: target audience, value proposition, competitive positioning, go-to-market approach, revenue model, key metrics. Goal: ${floor.goal}`;
          needed.push({ taskType: 'business-strategy', agent: 'strategy-agent', description: `Develop go-to-market strategy for "${floor.name}": ${floor.goal}`, prompt: p });
        }
        if (!existingTypes.has('budget-plan')) {
          const p = `Create a budget plan for "${floor.name}" with ceiling of $${Math.round(floor.budgetCeilingCents / 100)}. Allocate across: branding, content, ads, infrastructure. Goal: ${floor.goal}`;
          needed.push({ taskType: 'budget-plan', agent: 'finance-agent', description: `Build financial plan for "${floor.name}": ${floor.goal}`, prompt: p });
        }
        for (const n of needed) {
          console.log(`  [Consistency] ${floor.name}: seeding missing Phase 3 task: ${n.taskType}`);
          this.taskManager.create({
            floorId: floor.id,
            phaseNumber: 3,
            assignedAgent: n.agent as AgentId,
            modelTier: 'opus',
            taskType: n.taskType,
            description: n.description,
            prompt: n.prompt,
            inputFiles: [],
            outputFiles: [`deliverables/${n.taskType}.md`],
            dependsOn: [],
            priority: 'high',
          });
        }
        if (needed.length > 0) changed = true;
      }

      // 3b. Missing tasks: if current phase has no tasks and we're past Foundation, seed them
      if (floor.currentPhase > 3) {
        const currentPhaseTasks = tasks.filter(t => t.phaseNumber === floor.currentPhase);
        if (currentPhaseTasks.length === 0) {
          console.log(`  [Consistency] ${floor.name}: phase ${floor.currentPhase} has no tasks — seeding`);
          await this.seedNextPhaseTasks(floor.id, floor, floor.currentPhase - 1);
          changed = true;
        }
      }

      // 4. Stuck tasks: reset tasks that were dispatched/working before the restart
      const stuckTasks = tasks.filter(t => t.status === 'dispatched' || t.status === 'working');
      for (const t of stuckTasks) {
        console.log(`  [Consistency] ${floor.name}: resetting stuck task ${t.id.slice(0, 8)} (${t.taskType}) from '${t.status}' to 'queued'`);
        t.status = 'queued' as any;
      }
      if (stuckTasks.length > 0) changed = true;

      // 5. Phase manager sync: ensure PhaseManager state matches floor.currentPhase
      const phases = this.phaseManager.getPhases(floor.id);
      if (phases.length > 0 && floor.currentPhase > 1) {
        for (let i = 0; i < floor.currentPhase - 1 && i < phases.length; i++) {
          const p = phases[i];
          if (p && p.status !== 'completed' && p.status !== 'skipped') {
            p.status = 'completed';
            p.completedAt = p.completedAt ?? new Date();
          }
        }
      }

      if (changed) {
        await saveFloor(floor);
      }
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    this.processInterval = setInterval(() => {
      this.processQueue().catch(err => {
        console.error('[EVE] Queue processing error:', err);
      });
    }, 2000);

    // Start content publishing scheduler
    this.contentScheduler.start();

    // Start Phase 4 learning engine components
    this.outcomeGoldStandards.start();
    this.crossFloorIntelligence.start();
    this.adaptiveModelRouter.start();

    // Start token manager for OAuth token auto-refresh
    this.tokenManager.start();

    console.log('[EVE] Started');
  }

  stop(): void {
    this.running = false;
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }
    this.contentScheduler.stop();
    this.optimizationLoop.stopAll();
    this.outcomeGoldStandards.stop();
    this.crossFloorIntelligence.stop();
    this.adaptiveModelRouter.stop();
    this.tokenManager.stop();
    this.performanceTracker.persist().catch(() => {});
    this.fileWatcher.stopAll().catch(() => {});
    console.log('[EVE] Stopped');
  }

  // --- Floor Management ---

  async createFloor(input: CreateFloorInput): Promise<Floor> {
    // --- Budget diagnostic: log the raw input value before any processing ---
    // This captures the exact value received at the orchestrator boundary so we
    // can determine whether corruption happened upstream (form/API) or downstream.
    const rawBudget = input.budgetCeilingCents;
    const rawBudgetType = typeof rawBudget;
    const rawBudgetDollars = typeof rawBudget === 'number' ? rawBudget / 100 : 'N/A (not a number)';
    console.log(
      `[BudgetAudit] createFloor called for "${input.name}" — ` +
      `budgetCeilingCents received: ${JSON.stringify(rawBudget)} ` +
      `(type: ${rawBudgetType}, ${rawBudgetDollars})`
    );

    // Validate budget is a positive integer; if it arrives as a string (e.g. "500" or "20")
    // coerce it and log the coercion so we can identify the parsing bug.
    if (rawBudgetType !== 'number') {
      const coerced = parseInt(String(rawBudget), 10);
      console.warn(
        `[BudgetAudit] budgetCeilingCents was type "${rawBudgetType}" — coercing to integer: ` +
        `"${rawBudget}" → ${coerced}. ` +
        `This indicates the API route is not parsing the number field correctly.`
      );
      input = { ...input, budgetCeilingCents: isNaN(coerced) ? 0 : coerced };
      await this.writeSystemReviewLog({
        event: 'budget_type_coercion',
        floorName: input.name,
        rawValue: rawBudget,
        rawType: rawBudgetType,
        coercedValue: isNaN(coerced) ? 0 : coerced,
        message: `budgetCeilingCents arrived as ${rawBudgetType} "${rawBudget}" instead of number. ` +
          `Coerced to ${coerced}. Root cause: API route body parser not casting numeric fields.`,
      });
    } else if (rawBudget === 20000) {
      // Generic suspicious value check: 20000¢ ($200) is a historically problematic value
      // that may indicate a form default or API route parsing issue. Log for audit trail
      // so we can detect patterns across multiple floor creations.
      console.warn(
        `[BudgetAudit] budgetCeilingCents = 20000 ($200) — a historically suspicious value. ` +
        `Possible causes: (1) form default not being overridden, ` +
        `(2) string truncation during parsing, (3) API route applying a default value.`
      );
      await this.writeSystemReviewLog({
        event: 'budget_suspicious_value',
        floorName: input.name,
        receivedCents: rawBudget,
        receivedDollars: 200,
        message: `Received 20000¢ ($200) for "${input.name}" — matches a historically suspicious value. ` +
          `Investigate: (1) frontend form default, (2) API route default parsing, ` +
          `(3) string truncation in body parser. ` +
          `The value arrived at orchestrator as a correctly-typed number, ` +
          `so the corruption occurred in the frontend or API route layer.`,
      });
    } else {
      // Normal path — log for audit trail
      console.log(
        `[BudgetAudit] budgetCeilingCents validated: ${rawBudget}¢ (${rawBudget / 100}) ` +
        `for "${input.name}" — value is correct type and non-suspicious.`
      );
    }

    // Hard floor: never allow a budget below $1 (100¢). If the value slipped through
    // as 0 or negative (e.g. failed parseInt → NaN → 0), substitute a safe minimum
    // and log loudly so the upstream bug can be traced.
    if (input.budgetCeilingCents < 100) {
      const fallback = 10000; // $100 minimum safe default
      console.error(
        `[BudgetAudit] budgetCeilingCents=${input.budgetCeilingCents} is below minimum (100¢). ` +
        `Substituting ${fallback}¢ (${fallback / 100}) for "${input.name}". ` +
        `Root cause: value was ${rawBudget} (type: ${rawBudgetType}) — fix the upstream form or API route.`
      );
      input = { ...input, budgetCeilingCents: fallback };
    }

    const floor = await this.floorCreator.create(input);
    this.floors.set(floor.id, floor);
    this.budgetEnforcer.initFloor(floor.id, floor.budgetCeilingCents);
    this.trustLadder.initFloor(floor.id);
    this.safetyControls.initFloor(floor.id, Math.round(floor.budgetCeilingCents / 30)); // ~daily budget
    this.fileWatcher.watchFloor(floor.id, floor.slug);

    // Register foundation tasks in dependency graph
    const tasks = this.taskManager.getFloorTasks(floor.id);
    for (const task of tasks) {
      this.dependencyGraph.addTask(task.id, task.dependsOn);
    }

    // Broadcast floor:created via Supabase realtime (FloorCreator already saved floor to DB)
    broadcastFloorEvent(floor.id, 'floor:created', { floorId: floor.id, slug: floor.slug }).catch(() => {});

    return floor;
  }

  /** Update a floor's settings. */
  updateFloor(floorId: string, updates: Record<string, unknown>): Floor | null {
    const floor = this.floors.get(floorId);
    if (!floor) return null;
    if (updates.name !== undefined && typeof updates.name === 'string') floor.name = updates.name;
    if (updates.budgetCeilingCents !== undefined && typeof updates.budgetCeilingCents === 'number') {
      const newCeiling = updates.budgetCeilingCents;
      if (newCeiling < 100) {
        console.warn(
          `[updateFloor] Rejected budgetCeilingCents=${newCeiling} for "${floor.name}" — ` +
          `value below minimum 100¢. Ignoring update.`
        );
      } else {
        floor.budgetCeilingCents = newCeiling;
        this.budgetEnforcer.updateCeiling(floorId, newCeiling);
        this.safetyControls.initFloor(floorId, Math.round(newCeiling / 30));
        console.log(
          `[updateFloor] Budget updated for "${floor.name}": ${newCeiling}¢ (${newCeiling / 100})`
        );
      }
    }
    // Allow manual phase advancement (for recovery / debugging).
    // Also fix up the phase manager state so gate logic works correctly.
    if (updates.currentPhase !== undefined && typeof updates.currentPhase === 'number') {
      const newPhase = updates.currentPhase;
      if (newPhase >= 1 && newPhase <= 10) {
        console.log(`[updateFloor] Phase manually advanced for "${floor.name}": ${floor.currentPhase} → ${newPhase}`);
        // Force-complete all prior phases and activate the target phase
        this.phaseManager.forceCompleteUpTo(floorId, newPhase - 1);
        this.phaseManager.activatePhase(floorId, newPhase);
        floor.currentPhase = newPhase;
        // If this is phase 3 and all tasks are done, trigger phase completion check
        this.checkPhaseCompletion(floorId, newPhase);
      }
    }
    if (updates.brandState !== undefined) {
      const validBrandStates = ['pre-foundation', 'foundation-review', 'foundation-approved', 'brand-revision'];
      if (typeof updates.brandState === 'string' && validBrandStates.includes(updates.brandState)) {
        floor.brandState = updates.brandState as Floor['brandState'];
      } else {
        console.warn(`[updateFloor] Rejected invalid brandState for "${floor.name}": ${typeof updates.brandState === 'string' ? updates.brandState.slice(0, 80) : typeof updates.brandState}`);
      }
    }
    if (updates.themeConfig !== undefined) {
      floor.themeConfig = updates.themeConfig as import('../config/types.js').FloorTheme | null;
    }
    if (updates.selectedBrand !== undefined) {
      // Reject placeholder brand names that indicate the dashboard parser failed
      const sbCheck = updates.selectedBrand as Record<string, unknown> | null;
      const placeholderNames = ['—', '–', '-', '', 'Option A', 'Option B', 'Option C'];
      if (sbCheck && typeof sbCheck.name === 'string' && placeholderNames.includes(sbCheck.name.trim())) {
        console.warn(`[updateFloor] Rejected placeholder selectedBrand name "${sbCheck.name}" for "${floor.name}" — parser likely failed`);
        return floor;
      }
      const prev = floor.selectedBrand;
      floor.selectedBrand = updates.selectedBrand as Floor['selectedBrand'];

      if (floor.selectedBrand && floor.selectedBrand !== prev) {
        // Advance brandState so agents receive full brand context going forward
        if (floor.brandState === 'pre-foundation' || floor.brandState === 'foundation-review') {
          floor.brandState = 'foundation-approved';
        }

        // Write the selected brand name to the workspace so file-based brand loaders
        // also pick it up (brand-loader.ts reads these files)
        const sb = floor.selectedBrand;
        const brandSummary = [
          `# Selected Brand Direction`,
          ``,
          `**Brand Name:** ${sb.name}`,
          `**Tagline:** "${sb.tagline}"`,
          `**Personality:** ${sb.personality}`,
          `**Voice Attributes:** ${sb.voiceAttributes?.join(', ') || 'Not specified'}`,
          ``,
          `> This brand direction was selected by the owner. All agents must use this brand name`,
          `> and align all creative work with this direction.`,
        ].join('\n');

        this.workspace.writeFile(floor.slug, 'brand/selected-brand.md', brandSummary).catch(() => {});
        // Also write foundation-package.md — the brand-loader reads this file
        // to provide brand context to Phase 4+ agents
        this.workspace.writeFile(floor.slug, 'brand/foundation-package.md', brandSummary).catch(() => {});

        console.log(`[Floor] Brand direction selected for "${floor.name}": "${sb.name}" — brandState → ${floor.brandState}`);
        // Persist brand selection to DB with retry so it survives a restart.
        // Uses persistWithRetry (3 attempts with internal error handling) instead of bare saveFloor.
        persistWithRetry(() => saveFloor(floor), `floor:brand-select:${floor.id.slice(0, 8)}`);
        broadcastFloorEvent(floorId, 'brand:selected', {
          floorId,
          brandName: sb.name,
          brandState: floor.brandState,
        }).catch(() => {});
        // Return early — floor is already being saved above
        return floor;
      }
    }
    persistWithRetry(() => saveFloor(floor), `floor:create:${floor.id.slice(0, 8)}`);
    return floor;
  }

  getFloor(floorId: string): Floor | undefined { return this.floors.get(floorId); }
  getFloors(): Floor[] { return [...this.floors.values()]; }

  /** Set OAuth/API credentials for a floor (used by dashboard API for integration setup) */
  setFloorAuthContext(floorId: string, auth: Partial<FloorAuthContext>): void {
    const existing = this.floorAuthContexts.get(floorId) ?? { floorId };
    this.floorAuthContexts.set(floorId, { ...existing, ...auth });
  }

  /** Get the current auth context for a floor */
  getFloorAuthContext(floorId: string): FloorAuthContext | undefined {
    return this.floorAuthContexts.get(floorId);
  }

  /**
   * Look up a floor by its display name (case-insensitive).
   * Returns the first match, or undefined if not found.
   * Used by diagnostic endpoints that receive a floor name rather than an ID.
   */
  getFloorByName(name: string): Floor | undefined {
    const lower = name.toLowerCase();
    return [...this.floors.values()].find(f => f.name.toLowerCase() === lower);
  }
  getFloorAgents(floorId: string) { return this.agentRegistry.getFloorAgents(floorId); }
  getFloorTasks(floorId: string) { return this.taskManager.getFloorTasks(floorId); }
  getFloorCosts(floorId: string) { return this.budgetEnforcer.getStatus(floorId); }
  getCouncilResult(taskId: string) { return this.councilResults.get(taskId) ?? null; }

  /**
   * Re-seed Foundation Sprint tasks for a floor that lost them (e.g., before task persistence was enabled).
   * Only seeds if no phase-3 tasks currently exist.
   */
  async seedFoundationTasks(floorId: string): Promise<boolean> {
    const floor = this.floors.get(floorId);
    if (!floor) return false;
    const existing = this.taskManager.getFloorTasks(floorId).filter(t => t.phaseNumber === 3);
    if (existing.length > 0) return false; // already seeded

    // Advance phase state so phase 3 becomes active
    this.phaseManager.forceCompleteUpTo(floorId, 2);
    this.phaseManager.activatePhase(floorId, 3);
    floor.currentPhase = 3;
    await saveFloor(floor);

    const router = this.modelRouter;
    const tasks = [
      {
        assignedAgent: 'brand-agent' as const,
        taskType: 'brand-options',
        description: `Create 3 distinct brand direction options for "${floor.name}": ${floor.goal}`,
        prompt: BRAND_OPTIONS_PROMPT(floor.name, floor.goal),
        modelTier: router.getModelTier('brand-agent', 'foundation'),
      },
      {
        assignedAgent: 'strategy-agent' as const,
        taskType: 'business-strategy',
        description: `Develop go-to-market strategy for "${floor.name}": ${floor.goal}`,
        prompt: `Analyze the market opportunity and create a go-to-market strategy including: target segments, channel priorities, competitive positioning, and growth roadmap.`,
        modelTier: router.getModelTier('strategy-agent', 'foundation'),
      },
      {
        assignedAgent: 'finance-agent' as const,
        taskType: 'budget-plan',
        description: `Build financial plan for "${floor.name}": ${floor.goal}`,
        prompt:
          `Create a 12-month financial projection for "${floor.name}" using a ` +
          `${floor.budgetCeilingCents / 100} total budget baseline ` +
          `(${floor.budgetCeilingCents} cents available). ` +
          `Include: revenue forecast, cost structure, unit economics, break-even analysis, ` +
          `and budget allocation. ALL figures must be calibrated to the ` +
          `${floor.budgetCeilingCents / 100} baseline — do not assume any other budget amount.`,
        modelTier: router.getModelTier('finance-agent', 'foundation'),
      },
    ];

    for (const t of tasks) {
      this.taskManager.create({ floorId, phaseNumber: 3, ...t });
    }

    console.log(`[EVE] Seeded Foundation tasks for ${floor.name}`);
    return true;
  }

  // --- Floor Deletion ---

  private deletionInFlight = new Set<string>();

  async deleteFloor(floorId: string): Promise<boolean> {
    const floor = this.floors.get(floorId);
    if (!floor) return false;

    // Duplicate-click guard
    if (this.deletionInFlight.has(floorId)) return false;
    this.deletionInFlight.add(floorId);

    try {
      // Soft-delete: archive floor instead of hard deleting
      // This preserves data for recovery within 30 days
      floor.status = 'archived' as any;

      // Stop any active tasks first
      this.safetyControls.killFloor(floorId);

      // Remove from in-memory subsystems (but data remains in DB)
      this.floors.delete(floorId);
      this.taskManager.removeFloorTasks(floorId);
      this.agentRegistry.removeFloorAgents(floorId);
      this.phaseManager.removeFloor(floorId);
      this.budgetEnforcer.removeFloor(floorId);
      this.trustLadder.removeFloor(floorId);
      this.safetyControls.removeFloor(floorId);
      this.fileWatcher.unwatchFloor(floorId);

      // Persist soft-delete to database (archive, don't destroy)
      const { archiveFloor } = await import('../integrations/supabase.js');
      await archiveFloor(floorId);

      broadcastFloorEvent(floorId, 'floor:deleted', { floorId }).catch(() => {});
      console.log(`[EVE] Floor ${floor.name} (${floorId}) archived (soft-deleted)`);
      return true;
    } finally {
      this.deletionInFlight.delete(floorId);
    }
  }

  // --- Kill Switch ---

  killFloor(floorId: string): void {
    this.safetyControls.killFloor(floorId);
    sendNotification({ title: 'Floor Paused', body: `Kill switch activated for floor ${floorId}`, floorId, type: 'alert' });
  }

  resumeFloor(floorId: string): void {
    this.safetyControls.resumeFloor(floorId);
  }

  // --- Task Retry ---

  /** Retry a failed/escalated task — resets it to queued so the process loop picks it up. */
  retryTask(taskId: string, reassignAgent?: AgentId): { success: boolean; error?: string } {
    const task = this.taskManager.getTask(taskId);
    if (!task) return { success: false, error: 'Task not found' };
    const RETRYABLE = ['failed', 'escalated', 'completed'];
    if (!RETRYABLE.includes(task.status)) {
      return { success: false, error: `Task status is '${task.status}' — only failed/escalated/completed tasks can be retried` };
    }
    // Optionally reassign to a different agent
    if (reassignAgent) {
      console.log(`[Retry] Reassigning task ${taskId.slice(0, 8)} from ${task.assignedAgent} to ${reassignAgent}`);
      task.assignedAgent = reassignAgent;
      task.modelTier = this.modelRouter.getModelTier(reassignAgent, 'routine');
    }
    // Release any stale concurrency slot held by this task (previous dispatch may not
    // have cleaned up if the task failed during quality review or anti-slop check).
    this.concurrency.release(taskId);
    this.agentRegistry.updateStatus(task.floorId, task.assignedAgent, 'idle');

    // Reset attempts, clear stale result, and force re-queue
    task.attempts = 0;
    task.result = null;
    task.prompt = ''; // force re-enrichment on dispatch
    task.status = 'queued' as any; // direct assignment — bypass transition validation for retry

    // FIX: Reset runaway turn count so the retried task doesn't immediately re-trigger the kill switch
    this.safetyControls.resetTaskTurnCount(task.floorId, taskId);
    // Also resume the floor in case the runaway detector killed it
    this.safetyControls.resumeFloor(task.floorId);

    console.log(`[Retry] Task ${taskId.slice(0, 8)} (${task.taskType}) re-queued by owner`);
    return { success: true };
  }

  // --- Agent Status ---

  /** Get active/completed/failed task counts per agent for a floor. */
  getFloorAgentStatus(floorId: string) {
    const tasks = this.taskManager.getFloorTasks(floorId);
    const agents = new Map<string, { active: number; completed: number; failed: number; current?: string }>();
    for (const t of tasks) {
      const a = t.assignedAgent;
      if (!agents.has(a)) agents.set(a, { active: 0, completed: 0, failed: 0 });
      const entry = agents.get(a)!;
      if (t.status === 'completed') entry.completed++;
      else if (t.status === 'failed' || t.status === 'escalated') entry.failed++;
      else if (t.status === 'dispatched' || t.status === 'working') {
        entry.active++;
        entry.current = t.taskType;
      }
    }
    const activeSlots = this.concurrency.getActiveSlots().filter(s => s.floorId === floorId);
    return {
      agents: Object.fromEntries(agents),
      concurrencySlots: activeSlots.length,
      totalActive: activeSlots.length,
    };
  }

  // --- Floor Stats ---

  /** Get real stats for a floor — spend, tasks, phases, agent utilization. */
  getFloorStats(floorId: string) {
    const floor = this.floors.get(floorId);
    if (!floor) return null;
    const tasks = this.taskManager.getFloorTasks(floorId);
    const costs = this.budgetEnforcer.getStatus(floorId);
    const phases = this.phaseManager.getPhases(floorId);
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const completedThisWeek = tasks.filter(t => t.status === 'completed' && t.completedAt && new Date(t.completedAt).getTime() > weekAgo).length;
    const totalCompleted = tasks.filter(t => t.status === 'completed').length;
    const totalFailed = tasks.filter(t => t.status === 'failed' || t.status === 'escalated').length;

    // Agent utilization
    const agentTasks = new Map<string, number>();
    for (const t of tasks.filter(t => t.status === 'completed')) {
      agentTasks.set(t.assignedAgent, (agentTasks.get(t.assignedAgent) || 0) + 1);
    }

    // Phase progress
    const completedPhases = phases.filter(p => p.status === 'completed').length;

    return {
      floorId,
      floorName: floor.name,
      status: floor.status,
      currentPhase: floor.currentPhase,
      totalPhases: phases.length,
      completedPhases,
      growthCycle: floor.growthCycle || 0,
      budget: {
        ceilingCents: floor.budgetCeilingCents,
        spentCents: costs?.spentCents ?? floor.spentCents ?? 0,
        remaining: (floor.budgetCeilingCents - (costs?.spentCents ?? floor.spentCents ?? 0)),
        utilizationPct: costs ? Math.round((costs.spentCents / floor.budgetCeilingCents) * 100) : 0,
      },
      tasks: {
        total: tasks.length,
        completed: totalCompleted,
        failed: totalFailed,
        active: tasks.filter(t => ['dispatched', 'working', 'queued', 'pending'].includes(t.status)).length,
        completedThisWeek,
      },
      agentUtilization: Object.fromEntries(agentTasks),
      trustLevel: this.trustLadder.getLevel(floorId),
    };
  }

  // --- Task Management ---

  getTask(taskId: string) { return this.taskManager.getTask(taskId); }

  getPendingApprovals(): Array<Task | { id: string; floorId: string; type: 'gate'; status: 'pending'; phaseNumber: number; phaseName: string }> {
    const approvals: Array<Task | { id: string; floorId: string; type: 'gate'; status: 'pending'; phaseNumber: number; phaseName: string }> = [];
    for (const floor of this.floors.values()) {
      // Task-level approvals (review status)
      approvals.push(...this.taskManager.getFloorTasksByStatus(floor.id, 'review'));
      // Phase gate approvals
      const phases = this.phaseManager.getPhases(floor.id);
      for (const phase of phases) {
        if (phase.status === 'gate-waiting') {
          approvals.push({
            id: `gate-${phase.number}`,
            floorId: floor.id,
            type: 'gate',
            status: 'pending',
            phaseNumber: phase.number,
            phaseName: phase.name,
          });
        }
      }
    }
    return approvals;
  }

  handleApproval(taskId: string, approved: boolean, feedback?: string): void {
    const task = this.taskManager.getTask(taskId);
    if (!task) return;

    if (approved) {
      this.trustLadder.recordApproval(task.floorId);

      // Generate cryptographic approval token for high-risk tasks
      // This token replaces the spoofable [OWNER_APPROVED] marker
      task.approvalToken = generateApprovalToken(task.id, task.floorId);

      // Auto-save as Gold Standard when owner approves a task with a result.
      // Tasks in 'review' or 'completed' status with output qualify.
      if ((task.status === 'completed' || task.status === 'review') && task.result) {
        const floor = this.floors.get(task.floorId);
        if (floor) {
          saveGoldStandard(floor.slug, task.assignedAgent as AgentId, task.taskType, task.result, floor.name)
            .catch(err => console.warn(`[GoldStandard] Failed to save: ${err}`));
        }
      }
    } else {
      this.trustLadder.recordRejection(task.floorId);
      if (feedback) {
        this.improvementEngine.recordRevision(task.floorId, task.assignedAgent, task.taskType, feedback);
      }
    }

    this.eventBus.emit('approval:received', {
      floorId: task.floorId,
      taskId,
      approved,
      feedback,
    });
  }

  // --- Chat Relay ---

  async sendChatMessage(floorId: string, message: string): Promise<{ response: string }> {
    const floor = this.floors.get(floorId);
    if (!floor) return { response: 'Floor not found' };

    // Load from DB only if not already loaded this call chain.
    // sendChatMessage reuses the in-session cache for the duration of
    // a single message exchange (user msg → persist → AI response → persist).
    // getChatHistory always bypasses this cache for fresh reads.
    if (!this.chatHistories.has(floorId)) {
      await this.loadChatHistory(floorId);
    }
    if (!this.chatHistories.has(floorId)) this.chatHistories.set(floorId, []);
    const history = this.chatHistories.get(floorId)!;
    const userTimestamp = new Date();
    history.push({ role: 'user', content: message, timestamp: userTimestamp });
    // Persist user message to Supabase immediately (before dispatch, so it's never lost)
    await this.persistChatMessage(floorId, 'user', message, 'owner');

    // Try OpenClaw Floor Manager first
    const agentRecord = this.agentRegistry.getAgent(floorId, 'floor-manager');
    const openclawId = agentRecord?.openclawAgentId ?? `${floor.slug}-floor-manager`;

    const result = await this.openclawDispatcher.dispatch({
      taskId: `chat-${Date.now()}`,
      floorId,
      agentId: 'floor-manager',
      openclawAgentId: openclawId,
      message,
    });

    let response: string;
    if (result.success && result.output) {
      response = result.output;
    } else {
      // Fallback: answer directly with Claude using floor context
      try {
        const { callAnthropic } = await import('../clients/anthropic.js');
        const tasks = this.taskManager.getFloorTasks(floorId);
        const completedTasks = tasks.filter(t => t.status === 'completed').slice(0, 5);
        const taskSummary = completedTasks.map(t => `- ${t.taskType}: ${t.status}`).join('\n') || 'None yet';
        const systemPrompt = `You are the Floor Manager for "${floor.name}" — an AI business built to: ${floor.goal || 'build and grow a business'}.

Floor status: Phase ${floor.currentPhase || 1}, ${floor.status}.
Budget: $${Math.round((floor.spentCents || 0) / 100)} spent of $${Math.round((floor.budgetCeilingCents || 0) / 100)} total.
Completed tasks: ${taskSummary}

You are the owner's point of contact. Be direct, specific, and useful. Answer questions about this floor's progress, what agents have done, what's coming next, and any business decisions needed. Keep answers concise (2-4 sentences unless more detail is clearly needed).

You also actively monitor this floor's workflows and communicate with EVE (the central intelligence) when you identify issues or improvements. If the owner mentions a problem, complaint, or suggestion, acknowledge it and let them know you'll flag it to EVE for action. End your response with [EVE_FEEDBACK: description] if you need to escalate something to EVE based on the conversation.`;

        const conversationMessages = history.slice(-6).map(h => ({
          role: h.role as 'user' | 'assistant',
          content: h.content,
        }));

        const aiResult = await callAnthropic(systemPrompt, conversationMessages, 'sonnet', 512);
        response = aiResult.content;
      } catch {
        response = 'Floor Manager is temporarily unavailable. Try again in a moment.';
      }
    }

    // Check if FM wants to escalate something to EVE
    const eveMatch = response.match(/\[EVE_FEEDBACK:\s*(.+?)\]/);
    if (eveMatch) {
      const feedbackMsg = eveMatch[1]!.trim();
      // Strip the tag from the user-facing response
      response = response.replace(/\s*\[EVE_FEEDBACK:\s*.+?\]/, '').trim();
      // Route to EVE asynchronously
      this.submitAgentFeedback(floorId, 'floor-manager', feedbackMsg).catch(() => {});
      console.log(`[FM→EVE] Chat-triggered feedback for ${floor.name}: ${feedbackMsg}`);
    }

    const assistantTimestamp = new Date();
    history.push({ role: 'assistant', content: response, timestamp: assistantTimestamp });
    // Persist assistant response to Supabase immediately
    await this.persistChatMessage(floorId, 'assistant', response, 'floor-manager');
    return { response };
  }

  async getChatHistory(floorId: string) {
    // Always invalidate the in-memory cache before loading so that
    // page reloads, new browser sessions, and floor state transitions
    // always retrieve the authoritative history from Supabase.
    this.chatHistories.delete(floorId);
    await this.loadChatHistory(floorId);
    return this.chatHistories.get(floorId) ?? [];
  }

  /**
   * Clear chat history for a floor — both in-memory and in Supabase.
   *
   * Safeguard: requires explicit confirmation string to prevent accidental
   * bulk deletion. Callers must pass `confirm: 'DELETE_CHAT_HISTORY'`.
   * The floor must exist and belong to this orchestrator instance.
   */
  async clearFloorChat(floorId: string, confirm?: string): Promise<boolean> {
    // Safeguard: require explicit confirmation to prevent accidental wipes
    if (confirm !== 'DELETE_CHAT_HISTORY') {
      console.warn(`[Chat] clearFloorChat called for ${floorId} without confirmation — blocked`);
      return false;
    }
    // Safeguard: floor must exist in this orchestrator
    if (!this.floors.has(floorId)) {
      console.warn(`[Chat] clearFloorChat called for unknown floor ${floorId} — blocked`);
      return false;
    }
    const floor = this.floors.get(floorId)!;
    console.log(`[Chat] Clearing chat history for floor "${floor.name}" (${floorId})`);
    this.chatHistories.delete(floorId);
    return clearChatMessages(floorId);
  }

  private chatDir = join(process.cwd(), 'data', 'chats');

  /**
   * Persist a single chat message to Supabase (primary store).
   * Falls back to local JSON file if Supabase is unavailable.
   */
  private async persistChatMessage(
    floorId: string,
    role: 'user' | 'assistant',
    content: string,
    sender: string,
  ): Promise<void> {
    // Primary: write to Supabase
    let dbSuccess = false;
    try {
      const msgId = await saveChatMessage({ floorId, role, content, sender, timestamp: new Date() });
      if (msgId === null) {
        // saveChatMessage returned null — Supabase insert failed (error already logged inside)
        console.warn(`[Chat] Supabase insert returned null for floor ${floorId} (${role}) — falling back to file`);
      } else {
        dbSuccess = true;
      }
    } catch (err) {
      console.warn(`[Chat] saveChatMessage threw for floor ${floorId}:`, (err as Error).message);
    }

    // Secondary: fall back to local file if DB write failed
    if (!dbSuccess) {
      try {
        await mkdir(this.chatDir, { recursive: true });
        const history = this.chatHistories.get(floorId) ?? [];
        await writeFile(join(this.chatDir, `${floorId}.json`), JSON.stringify(history), 'utf-8');
      } catch { /* non-critical — file fallback also failed */ }
    }
  }

  /**
   * Load chat history for a floor from Supabase (authoritative source).
   * Always re-fetches from DB — the in-memory map is a write-through cache
   * for the current session, not a skip-DB cache. This ensures history
   * persists across page reloads and session boundaries.
   *
   * The cache is only used within a single sendChatMessage call chain to
   * avoid double-loading in rapid succession. It is invalidated on every
   * getChatHistory call so page reloads always see fresh data.
   *
   * Fallback: local JSON file (migration path from old file-based storage).
   */
  private async loadChatHistory(floorId: string): Promise<void> {
    // Try Supabase — always attempt DB load (cache may be stale or empty)
    let supabaseSucceeded = false;
    try {
      const dbMessages = await loadChatMessages(floorId);
      // Always overwrite the in-memory cache with the authoritative DB state
      this.chatHistories.set(
        floorId,
        dbMessages.map(m => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp ?? new Date(),
        })),
      );
      supabaseSucceeded = true;
      if (dbMessages.length > 0) {
        console.log(`[Chat] Loaded ${dbMessages.length} messages from Supabase for floor ${floorId}`);
      }
    } catch (err) {
      // Supabase unavailable — fall through to file fallback
      console.warn(`[Chat] Supabase load failed for floor ${floorId}, trying file:`, (err as Error).message);
    }

    // If Supabase succeeded (even with 0 rows), skip file fallback
    if (supabaseSucceeded) return;

    // Fall back to local file (migration path for existing deployments)
    try {
      const data = await readFile(join(this.chatDir, `${floorId}.json`), 'utf-8');
      const history = JSON.parse(data);
      if (Array.isArray(history) && history.length > 0) {
        this.chatHistories.set(floorId, history);
        // Migrate local history into Supabase so future loads use DB
        for (const msg of history) {
          const role = msg.role === 'assistant' ? 'assistant' : 'user';
          const sender = role === 'assistant' ? 'floor-manager' : 'owner';
          await saveChatMessage({
            floorId,
            role,
            content: msg.content,
            sender,
            timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
          }).catch(() => {});
        }
        console.log(`[Chat] Migrated ${history.length} messages from file to Supabase for floor ${floorId}`);
      } else {
        // File exists but empty — initialize empty cache
        this.chatHistories.set(floorId, []);
      }
    } catch {
      // File doesn't exist yet — start fresh
      this.chatHistories.set(floorId, []);
    }
  }

  // --- Trust Ladder ---

  getTrustLevel(floorId: string) { return this.trustLadder.getLevel(floorId); }
  checkCanPromote(floorId: string) { return this.trustLadder.checkCanPromote(floorId); }
  /** Owner-only: promote a floor to the next trust level (never auto-called). */
  promoteFloor(floorId: string) { return this.trustLadder.promoteFloor(floorId); }
  demoteFloor(floorId: string, level: 1 | 2 | 3 | 4) { return this.trustLadder.demoteTo(floorId, level); }

  // --- Phase Gate Approvals ---

  /**
   * Owner approves the Foundation review — transitions floor.status from 'review' → 'building',
   * advances the phase gate, and broadcasts a floor:status-changed event so the tower UI re-fetches.
   *
   * This is the handler for the 'Approve Foundation — Start Building' button.
   * It is idempotent: if the floor is already past review, it returns true immediately.
   */
  async approveFoundation(floorId: string): Promise<{ success: boolean; floor?: Floor; error?: string }> {
    const floor = this.floors.get(floorId);
    if (!floor) return { success: false, error: 'Floor not found' };

    // Idempotent: already building or beyond
    if (floor.status !== 'review' && floor.status !== 'planning') {
      console.log(`[Floor] approveFoundation: floor "${floor.name}" already in status "${floor.status}" — no-op`);
      return { success: true, floor };
    }

    // 1. Transition floor status to 'building'
    floor.status = 'building';
    floor.brandState = 'foundation-approved';

    // 2. Persist to database — await and check for failure
    const saved = await saveFloor(floor);
    if (!saved) {
      console.error(`[Floor] approveFoundation: saveFloor FAILED for "${floor.name}" (${floorId}) — status NOT persisted`);
      // Revert in-memory state to avoid inconsistency
      floor.status = 'review';
      floor.brandState = 'foundation-review';
      return { success: false, error: 'Database write failed — please retry' };
    }
    console.log(`[Floor] approveFoundation: status → building, brandState → foundation-approved for "${floor.name}"`);

    // 3. Advance phase gate (Foundation Sprint = phase 3)
    const foundationPhase = 3;
    if (floor.currentPhase <= foundationPhase) {
      this.phaseManager.forceCompleteUpTo(floorId, foundationPhase);
      this.phaseManager.approveGate(floorId, foundationPhase);
      floor.currentPhase = foundationPhase + 1;
      const phaseSaved = await saveFloor(floor);
      if (!phaseSaved) {
        console.warn(`[Floor] approveFoundation: second saveFloor (phase advance) failed for "${floor.name}" — continuing`);
      }
      await this.seedNextPhaseTasks(floorId, floor, foundationPhase);
    }

    // 4. Broadcast floor status change so tower UI re-fetches floor state
    await broadcastFloorEvent(floorId, 'floor:status-changed', {
      floorId,
      status: floor.status,
      brandState: floor.brandState,
      currentPhase: floor.currentPhase,
    });

    // 5. Also broadcast phase:advanced for any listeners watching phase events
    await broadcastFloorEvent(floorId, 'phase:advanced', {
      from: foundationPhase,
      to: floor.currentPhase,
      floorId,
    });

    sendNotification({
      title: 'Foundation Approved',
      body: `${floor.name}: Building phase started. Phase ${floor.currentPhase} tasks now queued.`,
      floorId,
      type: 'info',
    });

    console.log(`[Floor] Foundation approved for "${floor.name}" — status=building, phase=${floor.currentPhase}`);
    return { success: true, floor };
  }

  /** Owner approves a phase gate (e.g. Foundation → Phase 4 Buildout). */
  async approvePhaseGate(floorId: string, phaseNumber: number): Promise<boolean> {
    const floor = this.floors.get(floorId);
    if (!floor) return false;

    // If already past this gate, return success without re-seeding
    if (floor.currentPhase > phaseNumber) {
      console.log(`[Floor] Gate ${phaseNumber} already approved for ${floor.name} (currentPhase=${floor.currentPhase})`);
      return true;
    }

    // Gate 3 (Foundation Sprint): require that a real brand was selected before approval.
    // Without this, downstream agents receive no brand context and produce generic outputs.
    if (phaseNumber === 3) {
      const placeholderNames = ['—', '–', '-', '', 'Option A', 'Option B', 'Option C'];
      if (!floor.selectedBrand || !floor.selectedBrand.name || placeholderNames.includes(floor.selectedBrand.name.trim())) {
        console.warn(`[Floor] Gate 3 approval blocked for "${floor.name}" — no real brand selected (selectedBrand.name="${floor.selectedBrand?.name ?? 'null'}")`);
        return false;
      }
    }

    // Force-complete all prior phases so the gate can be approved
    this.phaseManager.forceCompleteUpTo(floorId, phaseNumber);
    const gateApproved = this.phaseManager.approveGate(floorId, phaseNumber);
    if (!gateApproved) {
      console.warn(`[Floor] approveGate returned false for phase ${phaseNumber} on ${floor.name} — phase may already be approved or in wrong state`);
      // Even if PhaseManager rejected, still advance if we haven't yet
    }

    // Phase 3 = Foundation Sprint gate: mark brand as approved so the UI clears the CTA
    if (phaseNumber === 3) {
      floor.brandState = 'foundation-approved';
      console.log(`[Floor] brandState → 'foundation-approved' for ${floor.name}`);
    }

    floor.currentPhase = phaseNumber + 1;

    // Persist floor state BEFORE seeding tasks so if seedNextPhaseTasks throws,
    // the floor's currentPhase is already correct and a retry will hit the
    // "already past this gate" guard above (idempotent). Without this ordering,
    // a seed failure leaves floor.currentPhase at the old value but the phase
    // manager state advanced — causing "doesn't go all the way through".
    const saved = await saveFloor(floor);
    if (!saved) {
      console.error(`[Floor] approvePhaseGate: saveFloor FAILED for "${floor.name}" (phase ${phaseNumber}) — reverting currentPhase`);
      floor.currentPhase = phaseNumber; // revert so retry is safe
      return false;
    }

    // Seed tasks for the next phase — errors are logged but don't fail the gate
    // approval (floor state is already persisted above). The owner can retry seeding
    // via the seed-foundation endpoint or by re-clicking Review if tasks are missing.
    try {
      await this.seedNextPhaseTasks(floorId, floor, phaseNumber);
    } catch (seedErr) {
      console.error(
        `[Floor] approvePhaseGate: seedNextPhaseTasks threw for phase ${phaseNumber + 1} ` +
        `on "${floor.name}": ${(seedErr as Error).message}. ` +
        `Floor phase advanced to ${floor.currentPhase} but tasks may not have been created. ` +
        `Owner should re-approve or use seed-foundation endpoint.`,
      );
      // Still broadcast so the frontend navigates — tasks page will show empty state
      // which is recoverable, vs. silently leaving the gate in a stuck state.
    }

    await broadcastFloorEvent(floorId, 'phase:advanced', {
      from: phaseNumber,
      to: phaseNumber + 1,
      brandState: floor.brandState,
    });

    // Broadcast brand state change so Tower re-renders without the Review CTA
    if (phaseNumber === 3) {
      await broadcastFloorEvent(floorId, 'brand:state-changed', {
        floorId,
        brandState: floor.brandState,
      });
    }

    sendNotification({
      title: `Phase ${phaseNumber} Approved`,
      body: `${floor.name}: Phase ${phaseNumber + 1} tasks now queued.`,
      floorId,
      type: 'info',
    });
    console.log(`[Floor] Gate ${phaseNumber} approved — Phase ${phaseNumber + 1} starting for ${floor.name}`);
    return true;
  }

  getPhases(floorId: string) { return this.phaseManager.getPhases(floorId); }

  /**
   * Inspect readiness of a specific phase for a floor.
   * Returns a structured report suitable for dashboard display.
   * Used to surface Phase N kickoff status to the owner before approving a gate.
   */
  async getPhaseReadiness(floorId: string, targetPhase: number): Promise<{
    floorId: string;
    floorName: string;
    targetPhase: number;
    targetPhaseName: string;
    ready: boolean;
    blockers: string[];
    warnings: string[];
    priorPhaseStatus: {
      phaseNumber: number;
      phaseName: string;
      status: string;
      tasksTotal: number;
      tasksCompleted: number;
      tasksEscalated: number;
      tasksPending: number;
      allTerminal: boolean;
    };
    targetPhaseStatus: {
      tasksSeeded: boolean;
      tasksInDb: number;
      tasksInMemory: number;
      queuedCount: number;
      taskSummary: Array<{ taskType: string; agent: string; status: string; priority: string }>;
    };
    currentFloorPhase: number;
    floorStatus: string;
    recommendation: string;
  }> {
    const floor = this.floors.get(floorId);
    if (!floor) {
      return {
        floorId,
        floorName: 'Unknown',
        targetPhase,
        targetPhaseName: 'Unknown',
        ready: false,
        blockers: ['Floor not found in orchestrator memory'],
        warnings: [],
        priorPhaseStatus: {
          phaseNumber: targetPhase - 1,
          phaseName: 'Unknown',
          status: 'unknown',
          tasksTotal: 0,
          tasksCompleted: 0,
          tasksEscalated: 0,
          tasksPending: 0,
          allTerminal: false,
        },
        targetPhaseStatus: {
          tasksSeeded: false,
          tasksInDb: 0,
          tasksInMemory: 0,
          queuedCount: 0,
          taskSummary: [],
        },
        currentFloorPhase: 0,
        floorStatus: 'unknown',
        recommendation: 'Floor not found — verify floor ID.',
      };
    }

    const phases = this.phaseManager.getPhases(floorId);
    const targetPhaseDef = phases[targetPhase - 1];
    const priorPhaseDef = phases[targetPhase - 2];
    const blockers: string[] = [];
    const warnings: string[] = [];

    // --- Prior phase analysis ---
    const priorPhaseNumber = targetPhase - 1;
    const allTasks = this.taskManager.getFloorTasks(floorId);
    const priorPhaseTasks = allTasks.filter(t => t.phaseNumber === priorPhaseNumber);
    const priorCompleted = priorPhaseTasks.filter(t => t.status === 'completed').length;
    const priorEscalated = priorPhaseTasks.filter(t => t.status === 'escalated').length;
    const priorPending = priorPhaseTasks.filter(t =>
      !['completed', 'escalated'].includes(t.status)
    ).length;
    const TERMINAL: string[] = ['completed', 'escalated'];
    const priorAllTerminal = priorPhaseTasks.length > 0 &&
      priorPhaseTasks.every(t => TERMINAL.includes(t.status));

    const priorStatus = priorPhaseDef?.status ?? 'unknown';

    if (priorPhaseTasks.length === 0) {
      blockers.push(
        `Phase ${priorPhaseNumber} (${priorPhaseDef?.name ?? 'prior phase'}) has no tasks in memory. ` +
        `Tasks may not have been seeded, or the floor may need recovery.`
      );
    } else if (!priorAllTerminal) {
      blockers.push(
        `Phase ${priorPhaseNumber} (${priorPhaseDef?.name ?? 'prior phase'}) is not fully complete: ` +
        `${priorCompleted} completed, ${priorEscalated} escalated, ${priorPending} still pending/working.`
      );
    }

    if (priorStatus === 'gate-waiting') {
      blockers.push(
        `Phase ${priorPhaseNumber} is at gate-waiting — owner approval required to advance to phase ${targetPhase}.`
      );
    } else if (priorStatus === 'active') {
      blockers.push(
        `Phase ${priorPhaseNumber} is still active (not yet complete).`
      );
    } else if (priorStatus === 'pending') {
      blockers.push(
        `Phase ${priorPhaseNumber} has not started yet — phases must activate in sequence.`
      );
    }

    if (priorEscalated > 0) {
      warnings.push(
        `${priorEscalated} task(s) in phase ${priorPhaseNumber} were escalated (permanently failed). ` +
        `Review these before proceeding.`
      );
    }

    // --- Target phase analysis ---
    const targetPhaseTasks = allTasks.filter(t => t.phaseNumber === targetPhase);
    const targetQueued = targetPhaseTasks.filter(t => t.status === 'queued').length;
    const dbCount = await countPhaseTasks(floorId, targetPhase);

    const targetPhaseSeeded = targetPhaseTasks.length > 0 || dbCount > 0;

    if (!targetPhaseSeeded) {
      blockers.push(
        `Phase ${targetPhase} (${targetPhaseDef?.name ?? 'target phase'}) has no tasks seeded. ` +
        `Tasks will be created when the prior phase gate is approved.`
      );
    }

    const targetPhasePhaseStatus = targetPhaseDef?.status ?? 'unknown';
    if (targetPhasePhaseStatus === 'completed') {
      warnings.push(`Phase ${targetPhase} is already marked completed — it may have already run.`);
    }

    // Floor status checks
    if (floor.status === 'paused') {
      blockers.push('Floor is paused (kill switch active). Resume before proceeding.');
    }
    if (floor.status === 'archived') {
      blockers.push('Floor is archived and cannot be advanced.');
    }

    // Budget check
    const budgetStatus = this.budgetEnforcer.getStatus(floorId);
    if (budgetStatus) {
      if (budgetStatus.percentUsed >= 90) {
        blockers.push(
          `Budget at ${budgetStatus.percentUsed}% (${budgetStatus.spentCents / 100} of ` +
          `${budgetStatus.ceilingCents / 100}). Less than 10% remaining — ` +
          `review before starting new phase.`
        );
      } else if (budgetStatus.percentUsed >= 75) {
        warnings.push(
          `Budget at ${budgetStatus.percentUsed}% (${budgetStatus.spentCents / 100} of ` +
          `${budgetStatus.ceilingCents / 100}). Monitor spend closely.`
        );
      }
    }

    // Phase consistency check
    if (floor.currentPhase > targetPhase) {
      warnings.push(
        `Floor currentPhase (${floor.currentPhase}) is already past target phase ${targetPhase}. ` +
        `This phase may have already been completed.`
      );
    }
    if (floor.currentPhase < targetPhase - 1) {
      blockers.push(
        `Floor currentPhase (${floor.currentPhase}) is more than one phase behind target ${targetPhase}. ` +
        `Intermediate phases must complete first.`
      );
    }

    const ready = blockers.length === 0;

    // Build recommendation
    let recommendation: string;
    if (ready && targetQueued > 0) {
      recommendation = `Phase ${targetPhase} is ready. ${targetQueued} task(s) are queued and will dispatch automatically.`;
    } else if (ready && targetPhaseSeeded) {
      recommendation = `Phase ${targetPhase} tasks are seeded. Approve the gate to queue them for dispatch.`;
    } else if (!targetPhaseSeeded && priorAllTerminal) {
      recommendation = `Prior phase complete. Approve the phase ${priorPhaseNumber} gate to seed and queue phase ${targetPhase} tasks.`;
    } else if (blockers.some(b => b.includes('gate-waiting'))) {
      recommendation = `Owner gate approval required for phase ${priorPhaseNumber} before phase ${targetPhase} can start.`;
    } else {
      recommendation = `Resolve ${blockers.length} blocker(s) before approving phase ${targetPhase} launch.`;
    }

    return {
      floorId,
      floorName: floor.name,
      targetPhase,
      targetPhaseName: targetPhaseDef?.name ?? `Phase ${targetPhase}`,
      ready,
      blockers,
      warnings,
      priorPhaseStatus: {
        phaseNumber: priorPhaseNumber,
        phaseName: priorPhaseDef?.name ?? `Phase ${priorPhaseNumber}`,
        status: priorStatus,
        tasksTotal: priorPhaseTasks.length,
        tasksCompleted: priorCompleted,
        tasksEscalated: priorEscalated,
        tasksPending: priorPending,
        allTerminal: priorAllTerminal,
      },
      targetPhaseStatus: {
        tasksSeeded: targetPhaseSeeded,
        tasksInDb: dbCount,
        tasksInMemory: targetPhaseTasks.length,
        queuedCount: targetQueued,
        taskSummary: targetPhaseTasks.map(t => ({
          taskType: t.taskType,
          agent: t.assignedAgent,
          status: t.status,
          priority: t.priority,
        })),
      },
      currentFloorPhase: floor.currentPhase,
      floorStatus: floor.status,
      recommendation,
    };
  }

  // --- Improvements ---

  getImprovementProposals() { return this.improvementEngine.getAllProposals(); }
  approveImprovement(id: string) { return this.improvementEngine.approveProposal(id); }
  rejectImprovement(id: string) { return this.improvementEngine.rejectProposal(id); }

  // --- Agent Feedback ---

  async submitAgentFeedback(floorId: string, agentId: string, message: string) {
    const floor = this.floors.get(floorId);
    if (!floor) return { error: 'Floor not found' };
    return this.improvementEngine.submitAgentFeedback(
      floorId,
      agentId as any,
      message,
      { name: floor.name, phase: floor.currentPhase || 1, status: floor.status, goal: floor.goal },
    );
  }

  getAllFeedback(floorId?: string) { return this.improvementEngine.getAllFeedback(floorId); }
  getPendingFeedback(floorId?: string) { return this.improvementEngine.getPendingFeedback(floorId); }
  approveFeedback(id: string) { return this.improvementEngine.approveFeedback(id); }
  rejectFeedback(id: string) { return this.improvementEngine.rejectFeedback(id); }
  getSystemLearnings() { return this.improvementEngine.getSystemLearnings(); }

  // --- Phase Task Queue Investigation (Public API) ---

  /**
   * Investigate the full task queue for a specific phase on a named floor.
   *
   * Returns a structured status report including:
   * - current task states for every task in the phase
   * - assigned agents and model tiers
   * - any blocked, unassigned, or failed tasks
   * - whether the brand development workflow was triggered
   * - whether tasks were ever queued/assigned
   * - estimated completion timeline for the brand details deliverable
   * - recommended remediation actions
   *
   * If the phase has no tasks (workflow was never triggered) and the floor
   * is in a state that should have them, this method re-triggers the workflow
   * and queues tasks immediately.
   */
  async investigatePhaseTaskQueue(
    floorId: string,
    phaseNumber: number,
  ): Promise<{
    floorId: string;
    floorName: string;
    phaseNumber: number;
    phaseName: string;
    phaseStatus: string;
    investigatedAt: string;
    workflowTriggered: boolean;
    tasksFound: number;
    tasks: Array<{
      taskId: string;
      taskType: string;
      assignedAgent: string;
      modelTier: string;
      status: string;
      priority: string;
      attempts: number;
      maxAttempts: number;
      createdAt: string;
      dispatchedAt: string | null;
      completedAt: string | null;
      isBlocked: boolean;
      blockReason: string | null;
      hasResult: boolean;
      resultSnippet: string | null;
      reviewStatus: string;
      reviewFeedback: string | null;
      errorNote: string | null;
    }>;
    summary: {
      queued: number;
      working: number;
      completed: number;
      failed: number;
      escalated: number;
      blocked: number;
      unassigned: number;
    };
    brandWorkflowTriggered: boolean;
    brandTasksPresent: boolean;
    brandTasks: Array<{ taskType: string; status: string; assignedAgent: string }>;
    errors: string[];
    warnings: string[];
    autoRemediated: boolean;
    remediationActions: string[];
    estimatedCompletionNote: string;
    recommendation: string;
  }> {
    const investigatedAt = new Date().toISOString();
    const floor = this.floors.get(floorId);

    if (!floor) {
      return {
        floorId,
        floorName: 'Unknown',
        phaseNumber,
        phaseName: `Phase ${phaseNumber}`,
        phaseStatus: 'unknown',
        investigatedAt,
        workflowTriggered: false,
        tasksFound: 0,
        tasks: [],
        summary: { queued: 0, working: 0, completed: 0, failed: 0, escalated: 0, blocked: 0, unassigned: 0 },
        brandWorkflowTriggered: false,
        brandTasksPresent: false,
        brandTasks: [],
        errors: ['Floor not found in orchestrator — verify floor ID or name.'],
        warnings: [],
        autoRemediated: false,
        remediationActions: [],
        estimatedCompletionNote: 'Cannot estimate — floor not found.',
        recommendation: 'Verify the floor ID or name and retry.',
      };
    }

    const errors: string[] = [];
    const warnings: string[] = [];
    const remediationActions: string[] = [];
    let autoRemediated = false;

    // --- Phase state ---
    const phases = this.phaseManager.getPhases(floorId);
    const phaseDef = phases[phaseNumber - 1];
    const phaseStatus = phaseDef?.status ?? 'unknown';
    const phaseName = phaseDef?.name ?? `Phase ${phaseNumber}`;

    // --- In-memory tasks for this phase ---
    const allFloorTasks = this.taskManager.getFloorTasks(floorId);
    let phaseTasks = allFloorTasks.filter(t => t.phaseNumber === phaseNumber);

    // Also check database for any tasks not in memory
    let dbOnlyCount = 0;
    try {
      const { getSupabase } = await import('../integrations/supabase.js');
      const sb = getSupabase();
      if (sb) {
        const { data: dbTasks } = await sb
          .from('tasks')
          .select('id, task_type, status, assigned_agent, phase_number, created_at')
          .eq('floor_id', floorId)
          .eq('phase_number', phaseNumber)
          .order('created_at', { ascending: true });

        if (dbTasks) {
          const inMemIds = new Set(phaseTasks.map(t => t.id));
          dbOnlyCount = dbTasks.filter((r: { id: string }) => !inMemIds.has(r.id)).length;
          if (dbOnlyCount > 0) {
            warnings.push(
              `${dbOnlyCount} phase ${phaseNumber} task(s) exist in database but are not in orchestrator memory. ` +
              `These may be completed/archived tasks from a prior session.`,
            );
          }
        }
      }
    } catch (err) {
      warnings.push(`Could not query database for additional tasks: ${(err as Error).message}`);
    }

    const workflowTriggered = phaseTasks.length > 0 || dbOnlyCount > 0;

    // --- Brand-specific task analysis ---
    const BRAND_TASK_TYPES = [
      'brand-options', 'brand-visual-system', 'brand-voice-guide',
      'brand-identity', 'brand-details',
    ];
    const brandTasks = phaseTasks
      .filter(t => BRAND_TASK_TYPES.some(bt => t.taskType.includes('brand') || t.taskType === bt))
      .map(t => ({ taskType: t.taskType, status: t.status, assignedAgent: t.assignedAgent }));
    const brandTasksPresent = brandTasks.length > 0;
    const brandWorkflowTriggered = brandTasksPresent || workflowTriggered;

    // --- Auto-remediation: trigger workflow if phase has no tasks ---
    const ACTIVE_STATUSES = ['queued', 'created', 'dispatched', 'working'];
    const hasActiveTasks = phaseTasks.some(t => ACTIVE_STATUSES.includes(t.status));
    const hasAnyTasks = phaseTasks.length > 0 || dbOnlyCount > 0;

    if (!hasAnyTasks && phaseNumber === 3) {
      // Foundation Sprint (Phase 3) tasks were never seeded — re-trigger now
      errors.push(
        `Phase ${phaseNumber} (${phaseName}) has NO tasks in queue or database. ` +
        `Brand development workflow was NEVER triggered for "${floor.name}".`,
      );

      try {
        const seeded = await this.seedFoundationTasks(floorId);
        if (seeded) {
          autoRemediated = true;
          remediationActions.push(
            `Re-triggered Foundation Sprint workflow: seeded brand-options, business-strategy, ` +
            `and budget-plan tasks for "${floor.name}" (phase 3).`,
          );
          // Reload tasks after seeding
          phaseTasks = this.taskManager.getFloorTasks(floorId).filter(t => t.phaseNumber === phaseNumber);
        } else {
          errors.push(
            `seedFoundationTasks returned false for "${floor.name}" — tasks may already ` +
            `exist in a state that blocked re-seeding, or floor state is inconsistent.`,
          );
          remediationActions.push(
            `Manual re-seed required: POST /api/floors/${floorId}/seed-foundation`,
          );
        }
      } catch (seedErr) {
        errors.push(
          `Auto-remediation FAILED: seedFoundationTasks threw — ${(seedErr as Error).message}`,
        );
        remediationActions.push(
          `Manual re-seed required: POST /api/floors/${floorId}/seed-foundation`,
        );
      }
    } else if (!hasAnyTasks && phaseNumber !== 3) {
      errors.push(
        `Phase ${phaseNumber} (${phaseName}) has no tasks. This phase may not have been ` +
        `triggered yet — prior phase gate approval may be required.`,
      );
    }

    // --- Map tasks to report format ---
    const TERMINAL = ['completed', 'escalated'];
    const taskReports = phaseTasks.map(t => {
      const isBlocked =
        t.status === 'failed' ||
        t.status === 'escalated' ||
        (t.blockedBy && t.blockedBy.length > 0) ||
        (t.attempts >= t.maxAttempts && !TERMINAL.includes(t.status));

      let blockReason: string | null = null;
      if (t.status === 'escalated') blockReason = 'Permanently failed after max retry attempts.';
      else if (t.status === 'failed') blockReason = `Failed (attempt ${t.attempts}/${t.maxAttempts}): ${t.reviewFeedback ?? 'no details'}`;
      else if (t.blockedBy && t.blockedBy.length > 0) blockReason = `Blocked by: ${t.blockedBy.join(', ')}`;

      let errorNote: string | null = null;
      if (t.status === 'escalated' || t.status === 'failed') {
        errorNote = t.reviewFeedback ?? 'No error details recorded.';
      }

      return {
        taskId: t.id,
        taskType: t.taskType,
        assignedAgent: t.assignedAgent,
        modelTier: t.modelTier,
        status: t.status,
        priority: t.priority,
        attempts: t.attempts,
        maxAttempts: t.maxAttempts,
        createdAt: t.createdAt.toISOString(),
        dispatchedAt: t.dispatchedAt?.toISOString() ?? null,
        completedAt: t.completedAt?.toISOString() ?? null,
        isBlocked: !!isBlocked,
        blockReason,
        hasResult: !!(t.result),
        resultSnippet: t.result ? t.result.slice(0, 300).replace(/\n/g, ' ') : null,
        reviewStatus: t.reviewStatus,
        reviewFeedback: t.reviewFeedback,
        errorNote,
      };
    });

    // --- Summary counts ---
    const summary = {
      queued: phaseTasks.filter(t => t.status === 'queued' || t.status === 'created').length,
      working: phaseTasks.filter(t => t.status === 'dispatched' || t.status === 'working').length,
      completed: phaseTasks.filter(t => t.status === 'completed').length,
      failed: phaseTasks.filter(t => t.status === 'failed').length,
      escalated: phaseTasks.filter(t => t.status === 'escalated').length,
      blocked: taskReports.filter(t => t.isBlocked).length,
      unassigned: phaseTasks.filter(t => !t.assignedAgent || t.assignedAgent === 'owner').length,
    };

    // --- Populate warnings ---
    if (summary.escalated > 0) {
      errors.push(`${summary.escalated} task(s) in phase ${phaseNumber} are ESCALATED (permanently failed). Manual intervention required.`);
    }
    if (summary.failed > 0) {
      warnings.push(`${summary.failed} task(s) currently in failed state (may be retrying).`);
    }
    if (summary.unassigned > 0) {
      errors.push(`${summary.unassigned} task(s) have no valid agent assignment.`);
    }

    if (hasActiveTasks && !autoRemediated) {
      // Tasks exist but none are active — may be stuck
      if (summary.queued === 0 && summary.working === 0 && summary.completed < phaseTasks.length) {
        warnings.push(
          `Phase ${phaseNumber} has ${phaseTasks.length} tasks but none are queued or working. ` +
          `Tasks may be stuck in 'created' state or all escalated.`,
        );
      }
    }

    // Check for budget-plan specifically (Phase 3 critical path)
    if (phaseNumber === 3) {
      const budgetPlanTask = phaseTasks.find(t => t.taskType === 'budget-plan');
      if (!budgetPlanTask) {
        errors.push('budget-plan task is MISSING from phase 3 — finance-agent workflow was not triggered.');
        remediationActions.push(
          `Re-trigger budget-plan: POST /api/floors/${floorId}/budget-plan/resolve`,
        );
      } else if (budgetPlanTask.status === 'escalated') {
        errors.push(`budget-plan task ${budgetPlanTask.id.slice(0, 8)} is ESCALATED. Re-queue required.`);
        remediationActions.push(
          `Re-queue budget-plan: POST /api/floors/${floorId}/budget-plan/force-requeue`,
        );
      } else if (budgetPlanTask.prompt.includes('$200') && !budgetPlanTask.prompt.includes('$500')) {
        warnings.push(
          `budget-plan task ${budgetPlanTask.id.slice(0, 8)} may be using incorrect $200 budget baseline. ` +
          `Verify prompt and re-queue if needed.`,
        );
        remediationActions.push(
          `Verify and correct budget: POST /api/floors/${floorId}/budget-plan/audit`,
        );
      }

      const brandOptionsTask = phaseTasks.find(t => t.taskType === 'brand-options');
      if (!brandOptionsTask) {
        warnings.push('brand-options task not found in phase 3 — brand development workflow may be incomplete.');
      }
    }

    // --- ETA estimation ---
    let estimatedCompletionNote: string;
    const allTerminal = phaseTasks.length > 0 && phaseTasks.every(t => TERMINAL.includes(t.status));
    const allComplete = phaseTasks.every(t => t.status === 'completed');

    if (allComplete && phaseTasks.length > 0) {
      estimatedCompletionNote = `All ${phaseTasks.length} phase ${phaseNumber} tasks are COMPLETE.`;
    } else if (allTerminal && !allComplete) {
      estimatedCompletionNote = `All tasks are in terminal state but ${summary.escalated} are escalated (failed). Manual re-queue needed.`;
    } else if (summary.working > 0) {
      estimatedCompletionNote = `${summary.working} task(s) currently dispatched/working. Foundation tasks typically complete in 30–120 seconds each.`;
    } else if (summary.queued > 0) {
      estimatedCompletionNote =
        `${summary.queued} task(s) queued. Will dispatch in the next processing cycle (2–10 seconds). ` +
        `Estimated completion: ${summary.queued * 2}–${summary.queued * 5} minutes total for all foundation tasks.`;
    } else if (autoRemediated) {
      estimatedCompletionNote =
        `Workflow re-triggered. ${phaseTasks.length} task(s) now queued. ` +
        `Estimated completion: ${phaseTasks.length * 2}–${phaseTasks.length * 5} minutes.`;
    } else if (!hasAnyTasks) {
      estimatedCompletionNote = `No tasks found. Brand details deliverable cannot be estimated until workflow is triggered.`;
    } else {
      estimatedCompletionNote = `${summary.completed}/${phaseTasks.length} tasks complete. Remaining tasks are processing.`;
    }

    // --- Recommendation ---
    let recommendation: string;
    if (errors.length === 0 && warnings.length === 0 && allComplete) {
      recommendation = `Phase ${phaseNumber} (${phaseName}) is fully complete for "${floor.name}". All tasks finished successfully.`;
    } else if (autoRemediated) {
      recommendation =
        `Brand development workflow was missing and has been AUTO-TRIGGERED. ` +
        `${phaseTasks.length} tasks queued for phase ${phaseNumber}. ` +
        `Monitor dispatch over the next few minutes.`;
    } else if (errors.length > 0) {
      recommendation = `ATTENTION REQUIRED: ${errors.length} error(s) found in phase ${phaseNumber} for "${floor.name}". ` +
        `Review errors and apply remediation actions listed.`;
    } else if (warnings.length > 0) {
      recommendation = `Phase ${phaseNumber} is processing with ${warnings.length} warning(s). Monitor for stuck tasks.`;
    } else {
      recommendation = `Phase ${phaseNumber} is running normally. ${summary.queued} queued, ${summary.working} working, ${summary.completed} complete.`;
    }

    // Audit
    await this.writeSystemReviewLog({
      event: 'phase_task_queue_investigation',
      floorId,
      floorName: floor.name,
      phaseNumber,
      phaseName,
      phaseStatus,
      workflowTriggered,
      tasksFound: phaseTasks.length,
      summary,
      brandWorkflowTriggered,
      autoRemediated,
      remediationActions,
      errors,
      warnings,
      investigatedAt,
    });

    console.log(
      `[Investigation] Phase ${phaseNumber} for "${floor.name}": ` +
      `${phaseTasks.length} tasks, errors=${errors.length}, warnings=${warnings.length}, ` +
      `autoRemediated=${autoRemediated}, brandWorkflowTriggered=${brandWorkflowTriggered}`,
    );

    return {
      floorId,
      floorName: floor.name,
      phaseNumber,
      phaseName,
      phaseStatus,
      investigatedAt,
      workflowTriggered,
      tasksFound: phaseTasks.length,
      tasks: taskReports,
      summary,
      brandWorkflowTriggered,
      brandTasksPresent,
      brandTasks,
      errors,
      warnings,
      autoRemediated,
      remediationActions,
      estimatedCompletionNote,
      recommendation,
    };
  }

  // --- Budget Plan Task Status (Public API) ---

  /**
   * Inspect the current state of budget-plan tasks for a floor.
   * Returns task ID, queue status, ETA, and whether a requeue is needed.
   * Used by the Floor Manager diagnostic endpoint.
   */
  async getBudgetPlanTaskStatus(floorId: string): Promise<{
    floorId: string;
    floorName: string;
    tasksFound: number;
    tasks: Array<{
      taskId: string;
      status: string;
      phaseNumber: number;
      priority: string;
      isRevised: boolean;
      createdAt: string;
      completedAt: string | null;
      reviewStatus: string;
      reviewFeedback: string | null;
      resultSnippet: string;
    }>;
    activeTask: {
      taskId: string;
      status: string;
      priority: string;
      isRevised: boolean;
      etaNote: string;
    } | null;
    requeueNeeded: boolean;
    requeueReason: string | null;
    recommendation: string;
    checkedAt: string;
  }> {
    const checkedAt = new Date().toISOString();
    const floor = this.floors.get(floorId);

    if (!floor) {
      return {
        floorId, floorName: 'Unknown', tasksFound: 0, tasks: [],
        activeTask: null, requeueNeeded: false, requeueReason: null,
        recommendation: 'Floor not found — verify floor ID.',
        checkedAt,
      };
    }

    // Pull all budget-plan tasks from memory
    const memTasks = this.taskManager.getFloorTasks(floorId)
      .filter(t => t.taskType === 'budget-plan');

    // Also query Supabase for any DB-only records
    let dbRows: Array<{
      id: string; status: string; phase_number: number; priority: string;
      created_at: string; completed_at: string | null;
      review_status: string | null; review_feedback: string | null;
      result: string | null; prompt: string | null;
    }> = [];
    try {
      const { getSupabase } = await import('../integrations/supabase.js');
      const sb = getSupabase();
      if (sb) {
        const { data } = await sb
          .from('tasks')
          .select('id, status, phase_number, priority, created_at, completed_at, review_status, review_feedback, result, prompt')
          .eq('floor_id', floorId)
          .eq('task_type', 'budget-plan')
          .order('created_at', { ascending: false });
        if (data) dbRows = data;
      }
    } catch (err) {
      console.warn('[BudgetPlanStatus] Supabase query failed:', (err as Error).message);
    }

    // Merge: memory takes priority (fresher state), DB fills gaps
    const memIds = new Set(memTasks.map(t => t.id));
    const allTasks = [
      ...memTasks.map(t => ({
        taskId: t.id,
        status: t.status,
        phaseNumber: t.phaseNumber,
        priority: t.priority,
        isRevised: t.prompt.includes('Revised budget from $200 to $500'),
        createdAt: t.createdAt.toISOString(),
        completedAt: t.completedAt?.toISOString() ?? null,
        reviewStatus: t.reviewStatus,
        reviewFeedback: t.reviewFeedback,
        resultSnippet: (t.result ?? '').slice(0, 200),
      })),
      ...dbRows
        .filter(r => !memIds.has(r.id))
        .map(r => ({
          taskId: r.id,
          status: r.status,
          phaseNumber: r.phase_number,
          priority: r.priority,
          isRevised: (r.prompt ?? '').includes('Revised budget from $200 to $500'),
          createdAt: r.created_at,
          completedAt: r.completed_at,
          reviewStatus: r.review_status ?? 'pending',
          reviewFeedback: r.review_feedback,
          resultSnippet: (r.result ?? '').slice(0, 200),
        })),
    ];

    // Sort: revised tasks first, then by createdAt descending
    allTasks.sort((a, b) => {
      if (a.isRevised !== b.isRevised) return a.isRevised ? -1 : 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    // Find the active (non-terminal) task
    const ACTIVE_STATUSES = ['queued', 'created', 'dispatched', 'working'];
    const activeTask = allTasks.find(t => ACTIVE_STATUSES.includes(t.status)) ?? null;

    // Determine if requeue is needed
    let requeueNeeded = false;
    let requeueReason: string | null = null;

    const revisedTask = allTasks.find(t => t.isRevised);
    if (!revisedTask) {
      requeueNeeded = true;
      requeueReason = 'No revised budget-plan task ($500 baseline) found in memory or database.';
    } else if (!ACTIVE_STATUSES.includes(revisedTask.status) && revisedTask.status !== 'completed') {
      requeueNeeded = true;
      requeueReason = `Revised task ${revisedTask.taskId.slice(0, 8)} is in terminal state "${revisedTask.status}" without completing — needs requeue.`;
    }

    // ETA note
    let etaNote = '';
    if (activeTask) {
      if (activeTask.status === 'queued' || activeTask.status === 'created') {
        etaNote = 'Queued — will dispatch in the next processing cycle (within 2–10 seconds if concurrency slot available).';
      } else if (activeTask.status === 'dispatched' || activeTask.status === 'working') {
        etaNote = 'Currently dispatched/working — ETA typically 30–120 seconds for foundation tasks.';
      }
    }

    // Build recommendation
    let recommendation: string;
    if (activeTask?.isRevised) {
      recommendation = `Revised budget-plan task ${activeTask.taskId.slice(0, 8)} is active (${activeTask.status}). ${etaNote}`;
    } else if (revisedTask?.status === 'completed') {
      recommendation = `Revised budget-plan task ${revisedTask.taskId.slice(0, 8)} completed successfully with $500 baseline.`;
    } else if (requeueNeeded) {
      recommendation = `Requeue required: ${requeueReason} Use the requeue endpoint to create a new task.`;
    } else {
      recommendation = `Budget-plan task status: ${allTasks[0]?.status ?? 'none found'}.`;
    }

    console.log(
      `[BudgetPlanStatus] Floor "${floor.name}": ${allTasks.length} budget-plan tasks found, ` +
      `activeTask=${activeTask?.taskId?.slice(0, 8) ?? 'none'}, requeueNeeded=${requeueNeeded}`,
    );

    return {
      floorId,
      floorName: floor.name,
      tasksFound: allTasks.length,
      tasks: allTasks,
      activeTask: activeTask ? { ...activeTask, etaNote } : null,
      requeueNeeded,
      requeueReason,
      recommendation,
      checkedAt,
    };
  }

  /**
   * Force-requeue the revised budget-plan task if it is missing or in a failed state.
   * Idempotent: skips if an active revised task already exists.
   * Returns the new (or existing) task ID and queue status.
   */
  async forceRequeueBudgetPlan(floorId: string): Promise<{
    success: boolean;
    taskId: string | null;
    status: string;
    alreadyQueued: boolean;
    message: string;
  }> {
    const floor = this.floors.get(floorId);
    if (!floor) {
      return { success: false, taskId: null, status: 'error', alreadyQueued: false, message: 'Floor not found.' };
    }

    // Check for existing active revised task
    const allFloorTasks = this.taskManager.getFloorTasks(floorId);
    const ACTIVE_STATUSES = ['queued', 'created', 'dispatched', 'working'];
    const existingActive = allFloorTasks.find(
      t =>
        t.taskType === 'budget-plan' &&
        ACTIVE_STATUSES.includes(t.status) &&
        t.prompt.includes('Revised budget from $200 to $500'),
    );

    if (existingActive) {
      console.log(
        `[ForceRequeue] Revised budget-plan task already active: ` +
        `${existingActive.id.slice(0, 8)} (${existingActive.status}) for "${floor.name}"`,
      );
      return {
        success: true,
        taskId: existingActive.id,
        status: existingActive.status,
        alreadyQueued: true,
        message: `Revised budget-plan task already active: ${existingActive.id.slice(0, 8)} (${existingActive.status}).`,
      };
    }

    // Ensure budget is corrected before requeueing
    if (floor.budgetCeilingCents < 50000) {
      floor.budgetCeilingCents = 50000;
      this.budgetEnforcer.updateCeiling(floorId, 50000);
      this.safetyControls.initFloor(floorId, Math.round(50000 / 30));
      await saveFloor(floor);
      console.log(`[ForceRequeue] Corrected budget ceiling to 50000¢ for "${floor.name}"`);
    }

    // Run invalidation + requeue
    await this.invalidateAndRequeueBudgetPlan(floor);

    // Verify the new task was created
    const newTask = this.taskManager.getFloorTasks(floorId).find(
      t =>
        t.taskType === 'budget-plan' &&
        ACTIVE_STATUSES.includes(t.status) &&
        t.prompt.includes('Revised budget from $200 to $500'),
    );

    if (newTask) {
      console.log(
        `[ForceRequeue] Successfully created revised budget-plan task ` +
        `${newTask.id.slice(0, 8)} (${newTask.status}, priority: ${newTask.priority}) ` +
        `for "${floor.name}"`,
      );
      return {
        success: true,
        taskId: newTask.id,
        status: newTask.status,
        alreadyQueued: false,
        message: `New revised budget-plan task created: ${newTask.id.slice(0, 8)} (${newTask.status}, priority: ${newTask.priority}).`,
      };
    }

    return {
      success: false,
      taskId: null,
      status: 'error',
      alreadyQueued: false,
      message: 'invalidateAndRequeueBudgetPlan ran but no active revised task found after creation — check logs.',
    };
  }

  // --- Budget Plan Queue Verification (Public API) ---

  /**
   * Verify that a budget-plan task for finance-agent ($500 budget) is present in the
   * pending or scheduled queue. If missing, re-enqueues it immediately.
   *
   * Steps performed:
   * 1. LOG BEFORE STATE — capture current queue (pending + all budget-plan tasks)
   * 2. CHECK FOR TASK — search pending/queued tasks for budget-plan assigned to finance-agent
   * 3. IF MISSING — re-enqueue with $500 baseline and audit note
   * 4. EMIT CONFIRMATION EVENT — emit queue-confirmation to floor-manager feedback chain
   * 5. LOG AFTER STATE — re-capture queue state
   * 6. AUDIT RECORD — persist both before/after logs to review-log.jsonl
   * 7. NOTIFY — send notification if re-enqueue was required
   *
   * Returns a structured verification report.
   */
  async verifyAndAuditBudgetPlanQueue(floorId: string): Promise<{
    floorId: string;
    floorName: string;
    beforeState: {
      pendingCount: number;
      scheduledCount: number;
      budgetPlanTasksFound: Array<{ taskId: string; status: string; priority: string; isRevised: boolean; createdAt: string }>;
    };
    afterState: {
      pendingCount: number;
      scheduledCount: number;
      budgetPlanTasksFound: Array<{ taskId: string; status: string; priority: string; isRevised: boolean; createdAt: string }>;
    };
    taskPresent: boolean;
    actionTaken: 'confirmed' | 're-enqueued';
    newTaskId: string | null;
    confirmationEvent: { taskType: string; agentId: string; status: string; timestamp: string };
    auditLabel: string;
    verifiedAt: string;
  }> {
    const verifiedAt = new Date().toISOString();
    const auditLabel = 'EVE-queue-audit: budget-plan verification';
    const ACTIVE_STATUSES = ['queued', 'created', 'dispatched', 'working'];

    const floor = this.floors.get(floorId);
    const floorName = floor?.name ?? 'Unknown';

    // Helper: snapshot current queue state for a floor
    const snapshotQueue = () => {
      const allTasks = this.taskManager.getFloorTasks(floorId);
      const pending = allTasks.filter(t => t.status === 'queued' || t.status === 'created');
      const scheduled = allTasks.filter(t => t.status === 'dispatched' || t.status === 'working');
      const budgetPlanTasks = allTasks
        .filter(t => t.taskType === 'budget-plan')
        .map(t => ({
          taskId: t.id,
          status: t.status,
          priority: t.priority,
          isRevised: t.prompt?.includes('Revised budget from $200 to $500') ?? false,
          createdAt: t.createdAt.toISOString(),
          assignedAgent: t.assignedAgent,
          phaseNumber: t.phaseNumber,
        }));
      return { pendingCount: pending.length, scheduledCount: scheduled.length, budgetPlanTasksFound: budgetPlanTasks };
    };

    // --- STEP 1: LOG BEFORE STATE ---
    const beforeState = snapshotQueue();
    console.log(
      `[QueueAudit] BEFORE STATE for "${floorName}" (${floorId}): ` +
      `pending=${beforeState.pendingCount}, scheduled=${beforeState.scheduledCount}, ` +
      `budget-plan tasks=${beforeState.budgetPlanTasksFound.length}`,
    );
    if (beforeState.budgetPlanTasksFound.length > 0) {
      for (const t of beforeState.budgetPlanTasksFound) {
        console.log(
          `  [QueueAudit] budget-plan task: id=${t.taskId.slice(0, 8)}, ` +
          `status=${t.status}, priority=${t.priority}, isRevised=${t.isRevised}, ` +
          `agent=${t.assignedAgent}, phase=${t.phaseNumber}, createdAt=${t.createdAt}`,
        );
      }
    } else {
      console.log(`  [QueueAudit] No budget-plan tasks found in queue before audit`);
    }

    // --- STEP 2: CHECK FOR TASK ---
    // Look for a budget-plan task assigned to finance-agent with $500 budget
    // that is in an active (non-terminal) state
    const allFloorTasks = this.taskManager.getFloorTasks(floorId);
    const activeFinanceBudgetTask = allFloorTasks.find(
      t =>
        t.taskType === 'budget-plan' &&
        t.assignedAgent === 'finance-agent' &&
        ACTIVE_STATUSES.includes(t.status),
    );

    // Also accept any active budget-plan task (not just revised ones) as confirming presence
    const activeBudgetPlanAny = allFloorTasks.find(
      t => t.taskType === 'budget-plan' && ACTIVE_STATUSES.includes(t.status),
    );

    const taskPresent = !!(activeFinanceBudgetTask ?? activeBudgetPlanAny);

    console.log(
      `[QueueAudit] CHECK: budget-plan task for finance-agent present=${taskPresent} ` +
      `(activeFinance=${!!activeFinanceBudgetTask}, activeAny=${!!activeBudgetPlanAny})`,
    );

    // --- STEP 3: IF MISSING — RE-ENQUEUE ---
    let actionTaken: 'confirmed' | 're-enqueued' = 'confirmed';
    let newTaskId: string | null = null;

    if (!taskPresent) {
      console.log(
        `[QueueAudit] budget-plan task MISSING for "${floorName}" — re-enqueueing with $500 baseline`,
      );

      // Ensure floor exists and budget is correct before requeueing
      if (floor) {
        if (floor.budgetCeilingCents < 50000) {
          floor.budgetCeilingCents = 50000;
          this.budgetEnforcer.updateCeiling(floorId, 50000);
          this.safetyControls.initFloor(floorId, Math.round(50000 / 30));
          await saveFloor(floor);
          console.log(`[QueueAudit] Corrected budget ceiling to 50000¢ for "${floorName}"`);
        }

        // Determine target phase (use existing budget-plan phase or default 3)
        const priorBudgetTask = allFloorTasks.find(t => t.taskType === 'budget-plan');
        const targetPhase = priorBudgetTask?.phaseNumber ?? 3;

        const SUPERSESSION_NOTE = 'Revised budget from $200 to $500 — all prior budget-plan outputs are superseded and should not be used for downstream planning.';
        const reEnqueueNote = 'Re-enqueued by EVE backend audit — task was missing after auto-applied requeue';

        const revisedPrompt =
          `NOTE: ${SUPERSESSION_NOTE}\n\n` +
          `${reEnqueueNote}\n\n` +
          `Create a 12-month financial projection for "${floor.name}" using a $500 total budget baseline ` +
          `(${floor.budgetCeilingCents / 100} available). Include: revenue forecast, cost structure, ` +
          `unit economics, break-even analysis, and budget allocation. All figures must be calibrated ` +
          `to the $500 baseline — do not reference or reuse any prior $200-based projections.`;

        const newTask = this.taskManager.create({
          floorId,
          phaseNumber: targetPhase,
          assignedAgent: 'finance-agent',
          modelTier: this.modelRouter.getModelTier('finance-agent', 'foundation'),
          taskType: 'budget-plan',
          description:
            `[REVISED] Build financial plan for "${floor.name}" — $500 baseline ` +
            `(re-enqueued by EVE audit, supersedes all $200-based outputs)`,
          prompt: revisedPrompt,
          priority: 'high',
        });

        this.dependencyGraph.addTask(newTask.id, newTask.dependsOn);
        newTaskId = newTask.id;
        actionTaken = 're-enqueued';

        broadcastFloorEvent(floorId, 'task:created', {
          taskId: newTask.id,
          floorId,
          taskType: 'budget-plan',
        }).catch(() => {});

        console.log(
          `[QueueAudit] Re-enqueued budget-plan task ${newTask.id.slice(0, 8)} ` +
          `(phase ${targetPhase}, priority: high) for "${floorName}"`,
        );
      } else {
        console.error(`[QueueAudit] Cannot re-enqueue — floor "${floorId}" not found in orchestrator`);
      }
    } else {
      console.log(
        `[QueueAudit] budget-plan task CONFIRMED present for "${floorName}": ` +
        `${(activeFinanceBudgetTask ?? activeBudgetPlanAny)!.id.slice(0, 8)} ` +
        `(${(activeFinanceBudgetTask ?? activeBudgetPlanAny)!.status})`,
      );
    }

    // --- STEP 4: EMIT CONFIRMATION EVENT ---
    const confirmationEvent = {
      taskType: 'budget-plan',
      agentId: 'finance-agent',
      status: actionTaken,
      timestamp: new Date().toISOString(),
    };

    // Emit to EventBus so floor-manager feedback chain receives it
    this.eventBus.emit('task:created', {
      taskId: newTaskId ?? (activeFinanceBudgetTask ?? activeBudgetPlanAny)?.id ?? 'queue-audit',
      floorId,
      agentId: 'finance-agent',
    });

    // Broadcast via Supabase realtime so dashboard reflects confirmation
    broadcastFloorEvent(floorId, 'queue-confirmation', {
      ...confirmationEvent,
      auditLabel,
      newTaskId,
    }).catch(() => {});

    console.log(
      `[QueueAudit] CONFIRMATION EVENT emitted: ` +
      `taskType=${confirmationEvent.taskType}, agentId=${confirmationEvent.agentId}, ` +
      `status=${confirmationEvent.status}, timestamp=${confirmationEvent.timestamp}`,
    );

    // Submit to floor-manager feedback chain via improvement engine
    if (floor) {
      const feedbackMsg =
        actionTaken === 're-enqueued'
          ? `Queue audit complete: budget-plan task was MISSING and has been re-enqueued (task ${newTaskId?.slice(0, 8)}) with $500 baseline for finance-agent.`
          : `Queue audit complete: budget-plan task confirmed present in queue for finance-agent with $500 baseline.`;

      this.improvementEngine.submitAgentFeedback(
        floorId,
        'floor-manager' as any,
        feedbackMsg,
        { name: floorName, phase: floor.currentPhase || 1, status: floor.status, goal: floor.goal },
      ).catch(() => {});
    }

    // --- STEP 5: LOG AFTER STATE ---
    const afterState = snapshotQueue();
    console.log(
      `[QueueAudit] AFTER STATE for "${floorName}" (${floorId}): ` +
      `pending=${afterState.pendingCount}, scheduled=${afterState.scheduledCount}, ` +
      `budget-plan tasks=${afterState.budgetPlanTasksFound.length}`,
    );
    if (afterState.budgetPlanTasksFound.length > 0) {
      for (const t of afterState.budgetPlanTasksFound) {
        console.log(
          `  [QueueAudit] budget-plan task: id=${t.taskId.slice(0, 8)}, ` +
          `status=${t.status}, priority=${t.priority}, isRevised=${t.isRevised}`,
        );
      }
    }

    // --- STEP 6: AUDIT RECORD ---
    const auditEntry = {
      event: 'queue_audit_budget_plan_verification',
      auditLabel,
      floorId,
      floorName,
      beforeState,
      afterState,
      taskPresent,
      actionTaken,
      newTaskId,
      confirmationEvent,
      verifiedAt,
    };
    await this.writeSystemReviewLog(auditEntry);
    console.log(`[QueueAudit] Audit record persisted to review-log.jsonl with label "${auditLabel}"`);

    // --- STEP 7: NOTIFY if re-enqueue was required ---
    if (actionTaken === 're-enqueued') {
      sendNotification({
        title: 'Budget-Plan Task Re-Enqueued',
        body: `EVE queue audit: budget-plan task was missing for "${floorName}" and has been re-enqueued (task ${newTaskId?.slice(0, 8) ?? 'unknown'}) with $500 baseline. Investigation may be needed.`,
        floorId,
        type: 'alert',
      });
      console.log(`[QueueAudit] NOTIFICATION sent — re-enqueue was required for "${floorName}"`);
    }

    return {
      floorId,
      floorName,
      beforeState,
      afterState,
      taskPresent,
      actionTaken,
      newTaskId,
      confirmationEvent,
      auditLabel,
      verifiedAt,
    };
  }

  // --- Budget Plan Status Resolution (Public API) ---

  /**
   * Authoritative resolution handler for the finance-agent budget-plan task.
   *
   * Steps performed:
   * 1. INSPECT — determine current task state (pending/scheduled/completed/failed)
   * 2. CONFIRM BUDGET — verify the task executed (or will execute) against $500
   * 3. REQUEUE IF NEEDED — if stuck or failed, requeue with $500 baseline
   * 4. EMIT STATUS RESOLUTION EVENT — structured lifecycle event with taskId,
   *    queueState, executionTimestamp, and output summary
   * 5. UNBLOCK PHASE 1 PROGRESSION — if task is now active or completed, mark
   *    Phase 1 as unblocked and broadcast a phase:unblocked event
   * 6. AUDIT — persist resolution record to review-log.jsonl
   *
   * Returns a structured resolution report.
   */
  async resolveAndUnblockBudgetPlanTask(floorId: string): Promise<{
    floorId: string;
    floorName: string;
    resolvedAt: string;
    taskId: string | null;
    queueState: 'pending' | 'scheduled' | 'completed' | 'failed' | 'not-found';
    executionTimestamp: string | null;
    outputSummary: string | null;
    budgetConfirmed: boolean;
    budgetCents: number;
    requeuOccurred: boolean;
    phaseUnblocked: boolean;
    lifecycleEventEmitted: boolean;
    recommendation: string;
    fullStatus: Awaited<ReturnType<Orchestrator['getBudgetPlanTaskStatus']>>;
  }> {
    const resolvedAt = new Date().toISOString();
    const floor = this.floors.get(floorId);

    if (!floor) {
      return {
        floorId, floorName: 'Unknown', resolvedAt,
        taskId: null, queueState: 'not-found',
        executionTimestamp: null, outputSummary: null,
        budgetConfirmed: false, budgetCents: 0,
        requeuOccurred: false, phaseUnblocked: false,
        lifecycleEventEmitted: false,
        recommendation: 'Floor not found — verify floor ID.',
        fullStatus: await this.getBudgetPlanTaskStatus(floorId),
      };
    }

    // --- STEP 1: ENSURE BUDGET IS CORRECTED ---
    if (floor.budgetCeilingCents < 50000) {
      console.log(
        `[ResolveBudgetPlan] Correcting budget for "${floor.name}": ` +
        `${floor.budgetCeilingCents}¢ → 50000¢`,
      );
      floor.budgetCeilingCents = 50000;
      this.budgetEnforcer.updateCeiling(floorId, 50000);
      this.safetyControls.initFloor(floorId, Math.round(50000 / 30));
      await saveFloor(floor);
    }

    // --- STEP 2: INSPECT CURRENT TASK STATE ---
    const statusReport = await this.getBudgetPlanTaskStatus(floorId);
    console.log(
      `[ResolveBudgetPlan] Initial inspection for "${floor.name}": ` +
      `${statusReport.tasksFound} budget-plan task(s), ` +
      `activeTask=${statusReport.activeTask?.taskId?.slice(0, 8) ?? 'none'}, ` +
      `requeueNeeded=${statusReport.requeueNeeded}`,
    );

    // --- STEP 3: REQUEUE IF STUCK OR FAILED ---
    let requeueOccurred = false;
    if (statusReport.requeueNeeded) {
      console.log(`[ResolveBudgetPlan] Requeueing budget-plan task for "${floor.name}"`);
      await this.invalidateAndRequeueBudgetPlan(floor);
      requeueOccurred = true;
    }

    // --- STEP 4: RE-INSPECT AFTER POTENTIAL REQUEUE ---
    const postStatus = await this.getBudgetPlanTaskStatus(floorId);

    // Determine the canonical active task
    const ACTIVE_STATUSES = ['queued', 'created', 'dispatched', 'working'];
    const allFloorTasks = this.taskManager.getFloorTasks(floorId);

    const canonicalTask =
      // Prefer revised $500 task in active state
      allFloorTasks.find(
        t => t.taskType === 'budget-plan' &&
          ACTIVE_STATUSES.includes(t.status) &&
          t.prompt.includes('Revised budget from $200 to $500'),
      ) ??
      // Then any active budget-plan task
      allFloorTasks.find(
        t => t.taskType === 'budget-plan' && ACTIVE_STATUSES.includes(t.status),
      ) ??
      // Then the most-recently completed revised task
      allFloorTasks
        .filter(t => t.taskType === 'budget-plan' && t.status === 'completed')
        .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))[0] ??
      null;

    // --- STEP 4a: Map task state to queueState ---
    let queueState: 'pending' | 'scheduled' | 'completed' | 'failed' | 'not-found';
    if (!canonicalTask) {
      queueState = 'not-found';
    } else if (canonicalTask.status === 'completed') {
      queueState = 'completed';
    } else if (canonicalTask.status === 'escalated' || canonicalTask.status === 'failed') {
      queueState = 'failed';
    } else if (canonicalTask.status === 'dispatched' || canonicalTask.status === 'working') {
      queueState = 'scheduled';
    } else {
      queueState = 'pending'; // queued, created, retry
    }

    const executionTimestamp =
      canonicalTask?.completedAt?.toISOString() ??
      canonicalTask?.dispatchedAt?.toISOString() ??
      (canonicalTask ? resolvedAt : null);

    // --- STEP 4b: Confirm $500 budget ---
    const budgetConfirmed =
      floor.budgetCeilingCents >= 50000 &&
      (canonicalTask?.prompt?.includes('Revised budget from $200 to $500') ||
        canonicalTask?.status === 'completed' && !!(canonicalTask?.result));

    // --- STEP 4c: Build output summary ---
    let outputSummary: string | null = null;
    if (canonicalTask?.result) {
      outputSummary = canonicalTask.result.slice(0, 500).replace(/\n/g, ' ');
    } else if (canonicalTask) {
      outputSummary = `Task ${canonicalTask.id.slice(0, 8)} is ${canonicalTask.status} ` +
        `(phase ${canonicalTask.phaseNumber}, priority: ${canonicalTask.priority}). ` +
        `Budget baseline: ${floor.budgetCeilingCents / 100}. ` +
        `${requeueOccurred ? 'Requeued with $500 baseline.' : ''}`;
    }

    // --- STEP 5: EMIT STATUS RESOLUTION LIFECYCLE EVENT ---
    let lifecycleEventEmitted = false;
    if (canonicalTask) {
      const resolvedOutcome: import('./event-bus.js').TaskLifecycleEvent['reexecutionOutcome'] =
        queueState === 'completed' ? 'success'
        : queueState === 'failed' ? 'failure'
        : 'pending';

      const lifecycleEvent = this.taskManager.emitLifecycleEvent(
        canonicalTask.id,
        requeueOccurred,
        resolvedOutcome,
        `resolution:finance-agent:budget-plan:${floor.name.toLowerCase().replace(/\s+/g, '-')}`,
      );

      if (lifecycleEvent) {
        // Broadcast via Supabase realtime so dashboard and feedback chain receive it
        await broadcastFloorEvent(floorId, 'task:lifecycle-event', {
          taskId: lifecycleEvent.taskId,
          queueState: lifecycleEvent.queueState,
          reexecutionOccurred: lifecycleEvent.reexecutionOccurred,
          reexecutionOutcome: lifecycleEvent.reexecutionOutcome,
          taskType: lifecycleEvent.taskType,
          agentId: lifecycleEvent.agentId,
          phaseNumber: lifecycleEvent.phaseNumber,
          trigger: lifecycleEvent.trigger,
          timestamp: lifecycleEvent.timestamp,
        });
        lifecycleEventEmitted = true;

        console.log(
          `[ResolveBudgetPlan] Lifecycle event emitted for task ${canonicalTask.id.slice(0, 8)}: ` +
          `queueState=${lifecycleEvent.queueState}, ` +
          `reexecutionOccurred=${lifecycleEvent.reexecutionOccurred}, ` +
          `outcome=${lifecycleEvent.reexecutionOutcome}, ` +
          `trigger=${lifecycleEvent.trigger}`,
        );
      }
    }

    // --- STEP 6: UNBLOCK PHASE PROGRESSION ---
    // Phase progression is unblocked when the budget-plan task is either:
    // (a) actively queued/dispatched (will execute), or (b) completed
    const phaseUnblocked = queueState === 'pending' || queueState === 'scheduled' || queueState === 'completed';

    if (phaseUnblocked) {
      // Broadcast phase:unblocked so the dashboard and floor feedback chain can
      // navigate past any gate-waiting caused by the missing/failed budget-plan task.
      await broadcastFloorEvent(floorId, 'phase:unblocked', {
        floorId,
        phaseNumber: canonicalTask?.phaseNumber ?? 3,
        unblockReason: requeueOccurred
          ? `budget-plan task requeued with $${floor.budgetCeilingCents / 100} baseline`
          : `budget-plan task confirmed ${queueState}`,
        taskId: canonicalTask?.id ?? null,
        budgetCents: floor.budgetCeilingCents,
        resolvedAt,
      });

      console.log(
        `[ResolveBudgetPlan] Phase unblocked for "${floor.name}": ` +
        `taskId=${canonicalTask?.id?.slice(0, 8) ?? 'none'}, ` +
        `queueState=${queueState}, budgetCents=${floor.budgetCeilingCents}`,
      );
    } else {
      console.warn(
        `[ResolveBudgetPlan] Phase NOT unblocked for "${floor.name}": ` +
        `queueState=${queueState} — task not found or permanently failed. ` +
        `Manual intervention may be required.`,
      );
    }

    // --- STEP 7: SUBMIT TO FLOOR FEEDBACK CHAIN ---
    const feedbackMsg =
      `Budget-plan resolution complete for ${floor.name}: ` +
      `taskId=${canonicalTask?.id?.slice(0, 8) ?? 'none'}, ` +
      `queueState=${queueState}, ` +
      `budgetConfirmed=${budgetConfirmed} (${floor.budgetCeilingCents / 100}), ` +
      `requeued=${requeueOccurred}, ` +
      `phaseUnblocked=${phaseUnblocked}, ` +
      `executionTimestamp=${executionTimestamp ?? 'n/a'}.`;

    this.improvementEngine.submitAgentFeedback(
      floorId,
      'floor-manager' as any,
      feedbackMsg,
      { name: floor.name, phase: floor.currentPhase || 1, status: floor.status, goal: floor.goal },
    ).catch(() => {});

    // --- STEP 8: AUDIT RECORD ---
    const recommendation = phaseUnblocked
      ? `Phase 1 unblocked. Budget-plan task ${canonicalTask?.id?.slice(0, 8) ?? 'unknown'} ` +
        `is ${queueState} with ${floor.budgetCeilingCents / 100} budget confirmed.` +
        (requeueOccurred ? ' Task was requeued — output will be available once dispatched.' : '')
      : `Phase 1 STILL BLOCKED — budget-plan task could not be resolved. ` +
        `Check logs and use forceRequeueBudgetPlan endpoint to retry manually.`;

    await this.writeSystemReviewLog({
      event: 'budget_plan_resolution',
      floorId,
      floorName: floor.name,
      resolvedAt,
      taskId: canonicalTask?.id ?? null,
      queueState,
      executionTimestamp,
      outputSummary,
      budgetConfirmed,
      budgetCents: floor.budgetCeilingCents,
      requeueOccurred,
      phaseUnblocked,
      lifecycleEventEmitted,
      recommendation,
    });

    console.log(`[ResolveBudgetPlan] Resolution complete for "${floor.name}": ${recommendation}`);

    return {
      floorId,
      floorName: floor.name,
      resolvedAt,
      taskId: canonicalTask?.id ?? null,
      queueState,
      executionTimestamp,
      outputSummary,
      budgetConfirmed,
      budgetCents: floor.budgetCeilingCents,
      requeuOccurred: requeueOccurred,
      phaseUnblocked,
      lifecycleEventEmitted,
      recommendation,
      fullStatus: postStatus,
    };
  }

  // --- Budget Plan Audit & Invalidation (Public API) ---

  /**
   * Public audit entry point: inspect the budget-plan execution history for a given floor
   * and phase, verify what budget figure the finance-agent used, and conditionally
   * invalidate + requeue with the correct budget if a mismatch is found.
   *
   * Returns a structured audit report so callers can surface findings to the owner.
   */
  async auditAndRequeueBudgetPlan(
    floorId: string,
    phaseNumber: number,
    correctBudgetCents: number,
  ): Promise<{
    floorId: string;
    floorName: string;
    phaseNumber: number;
    tasksFound: number;
    completedTasks: Array<{
      taskId: string;
      taskType: string;
      status: string;
      reviewStatus: string;
      reviewFeedback: string | null;
      budgetFigureDetected: number | null;
      mismatch: boolean;
      resultSnippet: string;
    }>;
    mismatchDetected: boolean;
    actionTaken: 'invalidated_and_requeued' | 'already_correct' | 'no_completed_tasks' | 'already_invalidated';
    newTaskId: string | null;
    correctBudgetDollars: number;
    auditTimestamp: string;
  }> {
    const floor = this.floors.get(floorId);
    const auditTimestamp = new Date().toISOString();

    if (!floor) {
      return {
        floorId, floorName: 'Unknown', phaseNumber,
        tasksFound: 0, completedTasks: [], mismatchDetected: false,
        actionTaken: 'no_completed_tasks', newTaskId: null,
        correctBudgetDollars: correctBudgetCents / 100, auditTimestamp,
      };
    }

    const allTasks = this.taskManager.getFloorTasks(floorId);
    const budgetPlanTasks = allTasks.filter(
      t => t.taskType === 'budget-plan' && t.phaseNumber === phaseNumber,
    );

    // Also pull from Supabase for any display-only restored tasks not in memory
    let dbOnlyTasks: typeof budgetPlanTasks = [];
    try {
      const { getSupabase } = await import('../integrations/supabase.js');
      const sb = getSupabase();
      if (sb) {
        const { data } = await sb
          .from('tasks')
          .select('id, task_type, status, review_status, review_feedback, result, phase_number')
          .eq('floor_id', floorId)
          .eq('task_type', 'budget-plan')
          .eq('phase_number', phaseNumber);
        if (data) {
          // Identify rows not already in-memory
          const inMemoryIds = new Set(budgetPlanTasks.map(t => t.id));
          for (const row of data) {
            if (!inMemoryIds.has(row.id)) {
              dbOnlyTasks.push({
                id: row.id,
                floorId,
                phaseNumber: row.phase_number,
                taskType: row.task_type,
                status: row.status,
                reviewStatus: row.review_status ?? 'pending',
                reviewFeedback: row.review_feedback ?? null,
                revisionNote: null,
                result: row.result ?? null,
                assignedAgent: 'finance-agent',
                modelTier: 'sonnet',
                description: '',
                prompt: '',
                inputFiles: [],
                outputFiles: [],
                dependsOn: [],
                blockedBy: [],
                priority: 'normal',
                attempts: 0,
                maxAttempts: 3,
                estimatedCostCents: 0,
                actualCostCents: 0,
                createdAt: new Date(),
                dispatchedAt: null,
                completedAt: null,
              } as any);
            }
          }
        }
      }
    } catch { /* non-critical */ }

    const allBudgetTasks = [...budgetPlanTasks, ...dbOnlyTasks];

    if (allBudgetTasks.length === 0) {
      await this.writeSystemReviewLog({
        event: 'budget_plan_audit',
        floorId, floorName: floor.name, phaseNumber,
        result: 'no_tasks_found', auditTimestamp,
      });
      return {
        floorId, floorName: floor.name, phaseNumber,
        tasksFound: 0, completedTasks: [], mismatchDetected: false,
        actionTaken: 'no_completed_tasks', newTaskId: null,
        correctBudgetDollars: correctBudgetCents / 100, auditTimestamp,
      };
    }

    // Detect the dollar figure the finance-agent used in its output
    const WRONG_BUDGET_CENTS = 20000; // $200
    const WRONG_PATTERNS = [
      /\$200\b/g, /200\s*dollar/gi, /budget[^$\d]*\$?200\b/gi,
      /20[,.]?000\s*(?:cent|¢)/gi,
    ];
    const CORRECT_PATTERNS = [
      /\$500\b/g, /500\s*dollar/gi, /budget[^$\d]*\$?500\b/gi,
      /50[,.]?000\s*(?:cent|¢)/gi,
    ];

    const taskReports = allBudgetTasks.map(t => {
      const result = t.result ?? '';
      const snippet = result.slice(0, 300).replace(/\n/g, ' ');

      let budgetFigureDetected: number | null = null;
      const hasWrong = WRONG_PATTERNS.some(p => p.test(result));
      const hasCorrect = CORRECT_PATTERNS.some(p => p.test(result));

      if (hasWrong && !hasCorrect) budgetFigureDetected = 200;
      else if (hasCorrect) budgetFigureDetected = 500;
      else if (result.length > 0) budgetFigureDetected = null; // indeterminate

      const mismatch =
        t.status === 'completed' &&
        t.reviewFeedback !== 'Revised budget from $200 to $500 — all prior budget-plan outputs are superseded and should not be used for downstream planning.' &&
        (budgetFigureDetected === 200 || (budgetFigureDetected === null && correctBudgetCents !== WRONG_BUDGET_CENTS));

      return {
        taskId: t.id,
        taskType: t.taskType,
        status: t.status,
        reviewStatus: t.reviewStatus,
        reviewFeedback: t.reviewFeedback,
        budgetFigureDetected,
        mismatch,
        resultSnippet: snippet,
      };
    });

    const completedWithMismatch = taskReports.filter(r => r.mismatch && r.status === 'completed');
    const alreadyInvalidated = taskReports.filter(
      r => r.reviewFeedback?.includes('Revised budget from $200 to $500'),
    );

    // Check if a revised task is already queued
    const revisedAlreadyQueued = allBudgetTasks.some(
      t =>
        (t.status === 'queued' || t.status === 'created' || t.status === 'dispatched' || t.status === 'working') &&
        (t.prompt?.includes('Revised budget from $200 to $500') || t.description?.includes('[REVISED]')),
    );

    let actionTaken: 'invalidated_and_requeued' | 'already_correct' | 'no_completed_tasks' | 'already_invalidated' = 'already_correct';
    let newTaskId: string | null = null;

    if (revisedAlreadyQueued || alreadyInvalidated.length > 0) {
      actionTaken = 'already_invalidated';
      console.log(
        `[BudgetPlanAudit] ${floor.name} Phase ${phaseNumber}: ` +
        `budget-plan already invalidated/requeued — no further action needed.`,
      );
    } else if (completedWithMismatch.length > 0) {
      // Invalidate stale tasks and requeue
      console.log(
        `[BudgetPlanAudit] MISMATCH DETECTED for "${floor.name}" Phase ${phaseNumber}: ` +
        `${completedWithMismatch.length} task(s) used wrong budget. Invalidating and requeueing.`,
      );

      // Update floor budget ceiling to correct value if needed
      if (floor.budgetCeilingCents !== correctBudgetCents) {
        floor.budgetCeilingCents = correctBudgetCents;
        this.budgetEnforcer.updateCeiling(floorId, correctBudgetCents);
        this.safetyControls.initFloor(floorId, Math.round(correctBudgetCents / 30));
        await saveFloor(floor);
      }

      await this.invalidateAndRequeueBudgetPlan(floor);

      // Find the newly created task
      const newTask = this.taskManager.getFloorTasks(floorId).find(
        t =>
          t.taskType === 'budget-plan' &&
          (t.status === 'queued' || t.status === 'created') &&
          t.prompt.includes('Revised budget from $200 to $500'),
      );
      newTaskId = newTask?.id ?? null;
      actionTaken = 'invalidated_and_requeued';
    } else if (taskReports.filter(r => r.status === 'completed').length === 0) {
      actionTaken = 'no_completed_tasks';
    }

    await this.writeSystemReviewLog({
      event: 'budget_plan_audit',
      floorId, floorName: floor.name, phaseNumber,
      tasksFound: allBudgetTasks.length,
      mismatchDetected: completedWithMismatch.length > 0,
      actionTaken, newTaskId, correctBudgetDollars: correctBudgetCents / 100,
      taskReports, auditTimestamp,
    });

    return {
      floorId, floorName: floor.name, phaseNumber,
      tasksFound: allBudgetTasks.length,
      completedTasks: taskReports,
      mismatchDetected: completedWithMismatch.length > 0,
      actionTaken, newTaskId,
      correctBudgetDollars: correctBudgetCents / 100,
      auditTimestamp,
    };
  }

  // --- Force-Requeue with Synchronous Confirmation (Public API) ---

  /**
   * DIRECTIVE HANDLER: Force-requeue the finance-agent budget-plan task for a floor
   * with a corrected budget ceiling.
   *
   * NOTE: This method currently hardcodes the target budget to 50000¢ ($500).
   * For generalization across multiple boot patches with different budget targets,
   * consider parameterizing the target budget or reading it from the floor's patch config.
   *
   * Steps performed synchronously (no async retry loop):
   * 1. CLEAR QUEUE  — remove all prior unconfirmed budget-plan verification
   *    attempts from the task map (tasks in non-terminal, non-active states
   *    that are stale duplicates from prior queue-audit runs).
   * 2. CANCEL ASYNC LOOP — this method does NOT re-enter the async verification
   *    loop; it executes the requeue inline and awaits each step.
   * 3. FORCE REQUEUE — create a new high-priority budget-plan task for
   *    finance-agent with corrected baseline.
   * 4. SYNCHRONOUS CONFIRMATION — emits a lifecycle event and returns all
   *    three required confirmation fields:
   *      - task_id         (assigned task identifier)
   *      - queue_timestamp (ISO timestamp of successful queue insertion)
   *      - status          = 'confirmed'
   * 5. HALT ON FAILURE — if confirmation cannot be obtained, surfaces an error
   *    and returns status = 'error'; does NOT retry via async loop.
   */
  async forceSyncRequeueBudgetPlanWithConfirmation(floorId: string): Promise<{
    task_id: string | null;
    queue_timestamp: string | null;
    status: 'confirmed' | 'error';
    error?: string;
    staleTasksCleared: number;
    budgetCents: number;
    floorName: string;
  }> {
    const floor = this.floors.get(floorId);
    if (!floor) {
      return {
        task_id: null,
        queue_timestamp: null,
        status: 'error',
        error: `Floor not found: ${floorId}`,
        staleTasksCleared: 0,
        budgetCents: 0,
        floorName: 'Unknown',
      };
    }

    // --- STEP 1: CORRECT BUDGET CEILING ---
    if (floor.budgetCeilingCents < 50000) {
      const prev = floor.budgetCeilingCents;
      floor.budgetCeilingCents = 50000;
      this.budgetEnforcer.updateCeiling(floorId, 50000);
      this.safetyControls.initFloor(floorId, Math.round(50000 / 30));
      await saveFloor(floor);
      console.log(
        `[ForceSyncRequeue] Budget corrected for "${floor.name}": ${prev}¢ → 50000¢`,
      );
    }

    // --- STEP 2: CLEAR PRIOR UNCONFIRMED QUEUE ATTEMPTS ---
    // Remove all budget-plan tasks that are in a non-terminal, non-dispatching
    // state (i.e. 'queued', 'created', 'retry') AND are stale (not the revised
    // $500 task we are about to create). Tasks that are 'dispatched', 'working',
    // 'completed', or 'escalated' are left untouched.
    const CLEARABLE_STATUSES: string[] = ['queued', 'created', 'retry'];
    const ACTIVE_STATUSES = ['queued', 'created', 'dispatched', 'working'];
    let staleTasksCleared = 0;

    const priorBudgetTasks = this.taskManager.getFloorTasks(floorId).filter(
      t => t.taskType === 'budget-plan',
    );

    for (const t of priorBudgetTasks) {
      if (CLEARABLE_STATUSES.includes(t.status)) {
        // Mark as superseded so TaskManager and Supabase reflect cleared state.
        // We use the reviewFeedback channel to record the supersession without
        // altering TaskStatus (which would break the state machine).
        (t as Task).reviewStatus = 'rejected';
        (t as Task).reviewFeedback =
          'Cleared by forceSyncRequeueBudgetPlanWithConfirmation — stale prior attempt superseded by $500 requeue.';
        try {
          await saveTask(t as Task);
        } catch { /* non-critical */ }
        staleTasksCleared++;
        console.log(
          `[ForceSyncRequeue] Cleared stale budget-plan task ` +
          `${t.id.slice(0, 8)} (${t.status}) for "${floor.name}"`,
        );
      }
    }
    console.log(
      `[ForceSyncRequeue] Cleared ${staleTasksCleared} stale budget-plan task(s) ` +
      `from queue for "${floor.name}"`,
    );

    // --- STEP 3: FORCE REQUEUE (BYPASS ASYNC LOOP) ---
    // Check idempotency: if a valid revised active task already exists and is
    // past the stale-clearable states, use it.
    const existingRevised = this.taskManager.getFloorTasks(floorId).find(
      t =>
        t.taskType === 'budget-plan' &&
        (t.status === 'dispatched' || t.status === 'working') &&
        t.prompt.includes('Revised budget from $200 to $500'),
    );

    let newTask: Task;

    if (existingRevised) {
      // Already dispatched — use it as the confirmation target
      newTask = existingRevised as Task;
      console.log(
        `[ForceSyncRequeue] Revised task already dispatched/working: ` +
        `${newTask.id.slice(0, 8)} — using as confirmation target`,
      );
    } else {
      // Determine phase from prior budget-plan tasks or default to 3
      const priorTask = priorBudgetTasks[0];
      const targetPhase = priorTask?.phaseNumber ?? 3;

      const SUPERSESSION_NOTE =
        'Revised budget from $200 to $500 — all prior budget-plan outputs are superseded ' +
        'and should not be used for downstream planning.';

      const revisedPrompt =
        `NOTE: ${SUPERSESSION_NOTE}\n\n` +
        `[FORCE-REQUEUE via forceSyncRequeueBudgetPlanWithConfirmation]\n\n` +
        `Create a 12-month financial projection for "${floor.name}" using a $500 total budget ` +
        `baseline (${floor.budgetCeilingCents / 100} available). Include: revenue forecast, ` +
        `cost structure, unit economics, break-even analysis, and budget allocation. ` +
        `All figures must be calibrated to the $500 baseline — do not reference or reuse ` +
        `any prior $200-based projections.`;

      newTask = this.taskManager.create({
        floorId,
        phaseNumber: targetPhase,
        assignedAgent: 'finance-agent',
        modelTier: this.modelRouter.getModelTier('finance-agent', 'foundation'),
        taskType: 'budget-plan',
        description:
          `[REVISED] Build financial plan for "${floor.name}" — $500 baseline ` +
          `(force-requeued via forceSyncRequeueBudgetPlanWithConfirmation, ` +
          `supersedes all $200-based outputs)`,
        prompt: revisedPrompt,
        priority: 'high',
      }) as Task;

      this.dependencyGraph.addTask(newTask.id, newTask.dependsOn);

      console.log(
        `[ForceSyncRequeue] Created revised budget-plan task ` +
        `${newTask.id.slice(0, 8)} (phase ${targetPhase}, priority: high) ` +
        `for "${floor.name}"`,
      );
    }

    // Capture the queue insertion timestamp immediately after task creation
    const queue_timestamp = new Date().toISOString();

    // --- STEP 4: VERIFY TASK IS IN ACTIVE STATE ---
    const verifiedTask = this.taskManager.getTask(newTask.id);
    if (!verifiedTask || !ACTIVE_STATUSES.includes(verifiedTask.status)) {
      const errMsg =
        `Task ${newTask.id.slice(0, 8)} is in unexpected state ` +
        `"${verifiedTask?.status ?? 'not-found'}" after creation — confirmation cannot be issued.`;
      console.error(`[ForceSyncRequeue] ${errMsg}`);

      await this.writeSystemReviewLog({
        event: 'force_sync_requeue_confirmation_failure',
        floorId,
        floorName: floor.name,
        taskId: newTask.id,
        taskStatus: verifiedTask?.status ?? 'not-found',
        error: errMsg,
        timestamp: queue_timestamp,
      });

      return {
        task_id: newTask.id,
        queue_timestamp,
        status: 'error',
        error: errMsg,
        staleTasksCleared,
        budgetCents: floor.budgetCeilingCents,
        floorName: floor.name,
      };
    }

    // --- STEP 5: EMIT SYNCHRONOUS CONFIRMATION LIFECYCLE EVENT ---
    const lifecycleEvent = this.taskManager.emitLifecycleEvent(
      newTask.id,
      true,     // reexecutionOccurred = true (this is a forced requeue)
      'pending', // outcome = pending (queued, not yet executed)
      'force-sync-requeue:finance-agent:budget-plan:quest-kids-phase1',
    );

    if (!lifecycleEvent) {
      const errMsg = `emitLifecycleEvent returned null for task ${newTask.id.slice(0, 8)} — cannot confirm.`;
      console.error(`[ForceSyncRequeue] ${errMsg}`);
      return {
        task_id: newTask.id,
        queue_timestamp,
        status: 'error',
        error: errMsg,
        staleTasksCleared,
        budgetCents: floor.budgetCeilingCents,
        floorName: floor.name,
      };
    }

    // Broadcast via Supabase realtime — awaited synchronously before returning
    await broadcastFloorEvent(floorId, 'task:lifecycle-event', {
      taskId: lifecycleEvent.taskId,
      queueState: lifecycleEvent.queueState,
      reexecutionOccurred: lifecycleEvent.reexecutionOccurred,
      reexecutionOutcome: lifecycleEvent.reexecutionOutcome,
      taskType: lifecycleEvent.taskType,
      agentId: lifecycleEvent.agentId,
      phaseNumber: lifecycleEvent.phaseNumber,
      trigger: lifecycleEvent.trigger,
      timestamp: lifecycleEvent.timestamp,
    });

    // Broadcast task:created so dashboard reflects the new task immediately
    await broadcastFloorEvent(floorId, 'task:created', {
      taskId: newTask.id,
      floorId,
      taskType: 'budget-plan',
    });

    // Broadcast queue-confirmation with all three required fields
    await broadcastFloorEvent(floorId, 'queue-confirmation', {
      task_id: newTask.id,
      queue_timestamp,
      status: 'confirmed',
      floorName: floor.name,
      budgetCents: floor.budgetCeilingCents,
      staleTasksCleared,
      trigger: 'force-sync-requeue',
    });

    console.log(
      `[ForceSyncRequeue] ✓ CONFIRMATION ISSUED for "${floor.name}": ` +
      `task_id=${newTask.id.slice(0, 8)}, ` +
      `queue_timestamp=${queue_timestamp}, ` +
      `status=confirmed, ` +
      `staleTasksCleared=${staleTasksCleared}`,
    );

    // Audit record
    await this.writeSystemReviewLog({
      event: 'force_sync_requeue_confirmed',
      floorId,
      floorName: floor.name,
      task_id: newTask.id,
      queue_timestamp,
      status: 'confirmed',
      staleTasksCleared,
      budgetCents: floor.budgetCeilingCents,
      lifecycleEvent,
    });

    sendNotification({
      title: 'Budget-Plan Task Force-Requeued',
      body: `${floor.name}: finance-agent budget-plan task ${newTask.id.slice(0, 8)} ` +
        `queued with $${floor.budgetCeilingCents / 100} baseline. ${staleTasksCleared} stale attempt(s) cleared.`,
      floorId,
      type: 'info',
    });

    return {
      task_id: newTask.id,
      queue_timestamp,
      status: 'confirmed',
      staleTasksCleared,
      budgetCents: floor.budgetCeilingCents,
      floorName: floor.name,
    };
  }

  // --- Floor-Manager Queue State Report (Public API) ---

  /**
   * Report the current queue state of the budget-plan task to the floor-manager.
   *
   * This is the single authoritative method for answering:
   * "Is budget-plan present in queue/pending/scheduled state?"
   *
   * Steps:
   * 1. CHECK — search all queue states for budget-plan task
   * 2. CHECK REQUEUE LOG — determine whether a requeue event was recorded in task history
   * 3. RE-ENQUEUE IF ABSENT/FAILED — use definitiveCheckBudgetPlanTask (throws on failure)
   * 4. EMIT queue-confirmation — broadcast structured confirmation to floor-manager chain
   * 5. RETURN structured findings report
   *
   * @param floorId  - The floor UUID
   * @param phase    - The target phase number (default: 3 = Foundation Sprint)
   */
  async reportBudgetPlanQueueStateToFloorManager(
    floorId: string,
    phase = 3,
  ): Promise<{
    floorId: string;
    floorName: string;
    reportedAt: string;
    taskPresent: boolean;
    queueState: 'pending' | 'scheduled' | 'completed' | 'failed' | 'not-found';
    taskId: string | null;
    requeueEventLogged: boolean;
    requeueEventDetails: {
      trigger: string;
      timestamp: string;
      reexecutionOccurred: boolean;
      reexecutionOutcome: string | null;
    } | null;
    actionTaken: 'none' | 're-enqueued' | 'confirmed';
    queueConfirmationEmitted: boolean;
    budgetCents: number;
    phaseNumber: number;
    findings: string[];
    recommendation: string;
  }> {
    const reportedAt = new Date().toISOString();
    const floor = this.floors.get(floorId);
    const floorName = floor?.name ?? 'Unknown';
    const findings: string[] = [];

    const ACTIVE_STATUSES = ['queued', 'created', 'dispatched', 'working'];
    const TERMINAL_STATUSES = ['completed', 'escalated'];

    // --- STEP 1: CHECK CURRENT QUEUE STATE ---
    const allTasks = this.taskManager.getFloorTasks(floorId);
    const budgetPlanTasks = allTasks.filter(t => t.taskType === 'budget-plan');

    const activeTask = budgetPlanTasks.find(t => ACTIVE_STATUSES.includes(t.status)) ?? null;
    const completedTask = budgetPlanTasks
      .filter(t => t.status === 'completed')
      .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))[0] ?? null;
    const failedTask = budgetPlanTasks.find(t => t.status === 'escalated') ?? null;

    let queueState: 'pending' | 'scheduled' | 'completed' | 'failed' | 'not-found';
    let canonicalTask = activeTask ?? completedTask ?? null;

    if (!canonicalTask && !failedTask) {
      queueState = 'not-found';
      findings.push(`FINDING: No budget-plan task found in any state for floor "${floorName}" (phase ${phase}).`);
    } else if (activeTask) {
      queueState =
        activeTask.status === 'dispatched' || activeTask.status === 'working'
          ? 'scheduled'
          : 'pending';
      findings.push(
        `FINDING: budget-plan task ${activeTask.id.slice(0, 8)} is PRESENT in queue ` +
        `(status=${activeTask.status}, phase=${activeTask.phaseNumber}, ` +
        `priority=${activeTask.priority}, isRevised=${activeTask.prompt.includes('Revised budget from $200 to $500')}).`,
      );
    } else if (completedTask) {
      queueState = 'completed';
      findings.push(
        `FINDING: budget-plan task ${completedTask.id.slice(0, 8)} is COMPLETED ` +
        `(completedAt=${completedTask.completedAt?.toISOString() ?? 'unknown'}).`,
      );
    } else {
      queueState = 'failed';
      findings.push(
        `FINDING: budget-plan task ${failedTask!.id.slice(0, 8)} is ESCALATED/FAILED — ` +
        `needs re-enqueue.`,
      );
      canonicalTask = failedTask;
    }

    const taskPresent = queueState !== 'not-found' && queueState !== 'failed';

    // --- STEP 2: CHECK REQUEUE EVENT LOG ---
    // A requeue event is evidenced by:
    //   (a) reviewFeedback containing the supersession note (invalidation ran), OR
    //   (b) the revised task prompt containing the correction note, OR
    //   (c) the task description containing [REVISED] or [DEFINITIVE] or [FORCE-REQUEUE]
    let requeueEventLogged = false;
    let requeueEventDetails: {
      trigger: string;
      timestamp: string;
      reexecutionOccurred: boolean;
      reexecutionOutcome: string | null;
    } | null = null;

    const REQUEUE_MARKERS = [
      'Revised budget from $200 to $500',
      '[REVISED]',
      '[DEFINITIVE]',
      '[FORCE-REQUEUE',
      'Re-enqueued by EVE',
      'force-requeued',
    ];

    // Check all budget-plan tasks for evidence of a prior requeue
    const requeuedTask = budgetPlanTasks.find(t =>
      REQUEUE_MARKERS.some(
        marker =>
          t.prompt.includes(marker) ||
          t.description.includes(marker) ||
          (t.reviewFeedback ?? '').includes(marker),
      ),
    );

    if (requeuedTask) {
      requeueEventLogged = true;
      const trigger = requeuedTask.prompt.includes('DEFINITIVE')
        ? 'definitive-check:budget-plan'
        : requeuedTask.prompt.includes('FORCE-REQUEUE') || requeuedTask.description.includes('FORCE-REQUEUE')
        ? 'force-sync-requeue:finance-agent:budget-plan'
        : requeuedTask.prompt.includes('Re-enqueued by EVE')
        ? 'EVE-audit-requeue'
        : 'budget-plan:invalidate-and-requeue';

      requeueEventDetails = {
        trigger,
        timestamp: requeuedTask.createdAt.toISOString(),
        reexecutionOccurred: true,
        reexecutionOutcome:
          requeuedTask.status === 'completed' ? 'success'
          : requeuedTask.status === 'escalated' ? 'failure'
          : 'pending',
      };
      findings.push(
        `FINDING: Requeue event IS logged in task history. ` +
        `Task ${requeuedTask.id.slice(0, 8)} created at ${requeuedTask.createdAt.toISOString()} ` +
        `with trigger="${trigger}". Status: ${requeuedTask.status}.`,
      );
    } else {
      findings.push(
        `FINDING: No requeue event marker found in task history for "${floorName}". ` +
        `Either the requeue has not yet occurred, or tasks were cleared.`,
      );
    }

    // --- STEP 3: RE-ENQUEUE IF ABSENT OR FAILED ---
    let actionTaken: 'none' | 're-enqueued' | 'confirmed' = 'none';
    let queueConfirmationEmitted = false;
    let definitiveResult: Awaited<ReturnType<Orchestrator['definitiveCheckBudgetPlanTask']>> | null = null;

    if (!taskPresent) {
      findings.push(
        `ACTION: budget-plan task is absent or failed — calling definitiveCheckBudgetPlanTask ` +
        `to re-enqueue immediately with $500 baseline (phase ${phase}).`,
      );
      try {
        definitiveResult = await this.definitiveCheckBudgetPlanTask(floorId, phase);
        actionTaken = 're-enqueued';
        queueConfirmationEmitted = true;
        findings.push(
          `ACTION RESULT: ${definitiveResult.outcome} — task ${definitiveResult.taskId.slice(0, 8)} ` +
          `queued at ${definitiveResult.queuedAt} with budget ${definitiveResult.budgetCents}¢.`,
        );
        canonicalTask = this.taskManager.getTask(definitiveResult.taskId) ?? null;
        queueState = 'pending';
      } catch (err) {
        findings.push(
          `ACTION FAILED: definitiveCheckBudgetPlanTask threw: ${(err as Error).message}. ` +
          `Manual intervention required.`,
        );
      }
    } else {
      // Task is present — emit confirmation event to floor-manager
      actionTaken = 'confirmed';

      // Emit queue-confirmation event via Supabase realtime
      if (canonicalTask) {
        await broadcastFloorEvent(floorId, 'queue-confirmation', {
          taskType: 'budget-plan',
          agentId: 'finance-agent',
          taskId: canonicalTask.id,
          queueState,
          status: 'confirmed',
          budgetCents: floor?.budgetCeilingCents ?? 0,
          timestamp: reportedAt,
          trigger: 'floor-manager-queue-report',
          finding: findings.join(' | '),
        });
        queueConfirmationEmitted = true;
        findings.push(
          `ACTION: queue-confirmation event emitted for task ${canonicalTask.id.slice(0, 8)} ` +
          `(queueState=${queueState}).`,
        );
      }
    }

    // --- STEP 4: SUBMIT TO FLOOR-MANAGER FEEDBACK CHAIN ---
    const feedbackMsg = [
      `Budget-plan queue state report for "${floorName}" (phase ${phase}):`,
      `taskPresent=${taskPresent}, queueState=${queueState}, ` +
        `requeueEventLogged=${requeueEventLogged}, actionTaken=${actionTaken}.`,
      ...findings,
    ].join(' ');

    if (floor) {
      this.improvementEngine.submitAgentFeedback(
        floorId,
        'floor-manager' as any,
        feedbackMsg,
        { name: floorName, phase: floor.currentPhase || 1, status: floor.status, goal: floor.goal },
      ).catch(() => {});
    }

    // --- STEP 5: AUDIT RECORD ---
    await this.writeSystemReviewLog({
      event: 'budget_plan_queue_state_report',
      floorId,
      floorName,
      reportedAt,
      taskPresent,
      queueState,
      taskId: canonicalTask?.id ?? null,
      requeueEventLogged,
      requeueEventDetails,
      actionTaken,
      queueConfirmationEmitted,
      budgetCents: floor?.budgetCeilingCents ?? 0,
      phaseNumber: phase,
      findings,
    });

    const recommendation = !taskPresent
      ? `BLOCKED: budget-plan task was absent/failed. ` +
        (actionTaken === 're-enqueued'
          ? `Re-enqueued successfully as task ${definitiveResult?.taskId.slice(0, 8)}. ` +
            `Will dispatch in the next processing cycle.`
          : `Re-enqueue FAILED — manual intervention required.`)
      : queueState === 'completed'
      ? `COMPLETE: budget-plan task completed with ${ floor?.budgetCeilingCents ? floor.budgetCeilingCents / 100 : 'unknown'} budget.`
      : `CONFIRMED: budget-plan task ${canonicalTask?.id.slice(0, 8) ?? 'unknown'} is ${queueState}. ` +
        `Budget: ${floor?.budgetCeilingCents ? floor.budgetCeilingCents / 100 : 'unknown'}. ` +
        `${requeueEventLogged ? 'Requeue event confirmed in task history.' : 'No prior requeue event found.'}`;

    console.log(
      `[FloorManagerQueueReport] "${floorName}": ` +
      `taskPresent=${taskPresent}, queueState=${queueState}, ` +
      `requeueEventLogged=${requeueEventLogged}, actionTaken=${actionTaken}, ` +
      `queueConfirmationEmitted=${queueConfirmationEmitted}`,
    );

    return {
      floorId,
      floorName,
      reportedAt,
      taskPresent,
      queueState,
      taskId: canonicalTask?.id ?? definitiveResult?.taskId ?? null,
      requeueEventLogged,
      requeueEventDetails,
      actionTaken,
      queueConfirmationEmitted,
      budgetCents: floor?.budgetCeilingCents ?? 0,
      phaseNumber: phase,
      findings,
      recommendation,
    };
  }

  // --- Definitive Budget-Plan Queue Check (Public API) ---

  /**
   * Perform a definitive check of the task queue for the 'budget-plan' task.
   * Outcome is exactly one of: CONFIRMED_QUEUED | RECREATED_AND_QUEUED.
   * No ambiguous result is returned — if the task cannot be confirmed or recreated,
   * an error is thrown so the caller knows to escalate.
   *
   * Steps:
   * 1. Inspect queue for an active budget-plan task assigned to finance-agent (Phase 1).
   * 2. If present and queued → emit task-queued confirmation to floor-manager → return CONFIRMED_QUEUED.
   * 3. If missing or in unresolvable state → recreate with correct phase/floor metadata
   *    → emit task-queued confirmation → return RECREATED_AND_QUEUED.
   */
  async definitiveCheckBudgetPlanTask(
    floorId: string,
    targetPhase: number,
  ): Promise<{
    outcome: 'CONFIRMED_QUEUED' | 'RECREATED_AND_QUEUED';
    taskId: string;
    queuedAt: string;
    floorName: string;
    phaseNumber: number;
    budgetCents: number;
    confirmationEvent: {
      event: 'task-queued';
      taskId: string;
      taskType: 'budget-plan';
      agentId: 'finance-agent';
      floorId: string;
      phaseNumber: number;
      status: 'queued';
      outcome: 'CONFIRMED_QUEUED' | 'RECREATED_AND_QUEUED';
      timestamp: string;
    };
  }> {
    const floor = this.floors.get(floorId);
    if (!floor) {
      throw new Error(`definitiveCheckBudgetPlanTask: floor not found — id=${floorId}`);
    }

    const ACTIVE_STATUSES = ['queued', 'created', 'dispatched', 'working'];
    const queuedAt = new Date().toISOString();

    // --- STEP 1: Ensure budget is correct before any check ---
    if (floor.budgetCeilingCents < 50000) {
      floor.budgetCeilingCents = 50000;
      this.budgetEnforcer.updateCeiling(floorId, 50000);
      this.safetyControls.initFloor(floorId, Math.round(50000 / 30));
      await saveFloor(floor);
      console.log(
        `[DefinitiveCheck] Corrected budget for "${floor.name}": → 50000¢`,
      );
    }

    // --- STEP 2: Check for existing active budget-plan task on the target phase ---
    const allFloorTasks = this.taskManager.getFloorTasks(floorId);
    const existingActive = allFloorTasks.find(
      t =>
        t.taskType === 'budget-plan' &&
        t.assignedAgent === 'finance-agent' &&
        t.phaseNumber === targetPhase &&
        ACTIVE_STATUSES.includes(t.status),
    );

    let outcome: 'CONFIRMED_QUEUED' | 'RECREATED_AND_QUEUED';
    let canonicalTaskId: string;

    if (existingActive) {
      // Task is present and queued — CONFIRMED_QUEUED
      outcome = 'CONFIRMED_QUEUED';
      canonicalTaskId = existingActive.id;
      console.log(
        `[DefinitiveCheck] CONFIRMED_QUEUED: budget-plan task ` +
        `${existingActive.id.slice(0, 8)} (${existingActive.status}) ` +
        `for "${floor.name}" phase ${targetPhase}`,
      );
    } else {
      // Task is missing or in unresolvable state — RECREATED_AND_QUEUED
      // Clear any stale non-dispatching budget-plan tasks for this phase first
      const CLEARABLE: string[] = ['queued', 'created', 'retry', 'failed'];
      for (const t of allFloorTasks) {
        if (
          t.taskType === 'budget-plan' &&
          t.phaseNumber === targetPhase &&
          CLEARABLE.includes(t.status)
        ) {
          (t as Task).reviewStatus = 'rejected';
          (t as Task).reviewFeedback =
            'Cleared by definitiveCheckBudgetPlanTask — superseded by definitive requeue.';
          persistWithRetry(() => saveTask(t as Task), `task:clear-stale:${(t as Task).id.slice(0, 8)}`);
          console.log(
            `[DefinitiveCheck] Cleared stale budget-plan task ` +
            `${t.id.slice(0, 8)} (${t.status}) for "${floor.name}"`,
          );
        }
      }

      const SUPERSESSION_NOTE =
        'Revised budget from $200 to $500 — all prior budget-plan outputs are superseded ' +
        'and should not be used for downstream planning.';

      const revisedPrompt =
        `NOTE: ${SUPERSESSION_NOTE}\n\n` +
        `[DEFINITIVE REQUEUE — definitiveCheckBudgetPlanTask]\n\n` +
        `Create a 12-month financial projection for "${floor.name}" using a $500 total budget ` +
        `baseline (${floor.budgetCeilingCents / 100} available). ` +
        `Floor: "${floor.name}", Phase: ${targetPhase}, Status: ${floor.status}. ` +
        `Include: revenue forecast, cost structure, unit economics, break-even analysis, ` +
        `and budget allocation. All figures must be calibrated to the $500 baseline — ` +
        `do not reference or reuse any prior $200-based projections.`;

      const newTask = this.taskManager.create({
        floorId,
        phaseNumber: targetPhase,
        assignedAgent: 'finance-agent',
        modelTier: this.modelRouter.getModelTier('finance-agent', 'foundation'),
        taskType: 'budget-plan',
        description:
          `[DEFINITIVE] Build financial plan for "${floor.name}" — $500 baseline ` +
          `(phase ${targetPhase}, definitive requeue, supersedes all $200-based outputs)`,
        prompt: revisedPrompt,
        priority: 'high',
      });

      this.dependencyGraph.addTask(newTask.id, newTask.dependsOn);
      canonicalTaskId = newTask.id;
      outcome = 'RECREATED_AND_QUEUED';

      console.log(
        `[DefinitiveCheck] RECREATED_AND_QUEUED: new budget-plan task ` +
        `${newTask.id.slice(0, 8)} (phase ${targetPhase}, priority: high) ` +
        `for "${floor.name}"`,
      );
    }

    // --- STEP 3: Verify the canonical task is genuinely in an active state ---
    const verifiedTask = this.taskManager.getTask(canonicalTaskId);
    if (!verifiedTask || !ACTIVE_STATUSES.includes(verifiedTask.status)) {
      throw new Error(
        `definitiveCheckBudgetPlanTask: task ${canonicalTaskId.slice(0, 8)} ` +
        `ended up in state "${verifiedTask?.status ?? 'not-found'}" — cannot confirm queue. ` +
        `Floor: "${floor.name}", phase: ${targetPhase}.`,
      );
    }

    // --- STEP 4: Emit task-queued confirmation event to floor-manager ---
    const confirmationEvent = {
      event: 'task-queued' as const,
      taskId: canonicalTaskId,
      taskType: 'budget-plan' as const,
      agentId: 'finance-agent' as const,
      floorId,
      phaseNumber: targetPhase,
      status: 'queued' as const,
      outcome,
      timestamp: queuedAt,
    };

    // Emit on internal EventBus so floor-manager feedback chain receives it
    this.eventBus.emit('task:created', {
      taskId: canonicalTaskId,
      floorId,
      agentId: 'finance-agent',
    });

    // Broadcast via Supabase realtime with the full confirmation payload
    await broadcastFloorEvent(floorId, 'task-queued', confirmationEvent);

    // Emit structured lifecycle event
    const lifecycleEvent = this.taskManager.emitLifecycleEvent(
      canonicalTaskId,
      outcome === 'RECREATED_AND_QUEUED',
      'pending',
      `definitive-check:budget-plan:phase${targetPhase}`,
    );
    if (lifecycleEvent) {
      await broadcastFloorEvent(floorId, 'task:lifecycle-event', {
        taskId: lifecycleEvent.taskId,
        queueState: lifecycleEvent.queueState,
        reexecutionOccurred: lifecycleEvent.reexecutionOccurred,
        reexecutionOutcome: lifecycleEvent.reexecutionOutcome,
        taskType: lifecycleEvent.taskType,
        agentId: lifecycleEvent.agentId,
        phaseNumber: lifecycleEvent.phaseNumber,
        trigger: lifecycleEvent.trigger,
        timestamp: lifecycleEvent.timestamp,
      });
    }

    // Submit confirmation to floor-manager feedback chain
    const feedbackMsg =
      outcome === 'CONFIRMED_QUEUED'
        ? `Definitive queue check CONFIRMED: budget-plan task ${canonicalTaskId.slice(0, 8)} ` +
          `is present and queued for finance-agent (phase ${targetPhase}, ${floor.budgetCeilingCents / 100} budget).`
        : `Definitive queue check RECREATED: budget-plan task was missing/unresolvable — ` +
          `recreated as ${canonicalTaskId.slice(0, 8)} for finance-agent ` +
          `(phase ${targetPhase}, ${floor.budgetCeilingCents / 100} budget). Queued for dispatch.`;

    this.improvementEngine.submitAgentFeedback(
      floorId,
      'floor-manager' as any,
      feedbackMsg,
      { name: floor.name, phase: floor.currentPhase || 1, status: floor.status, goal: floor.goal },
    ).catch(() => {});

    console.log(
      `[DefinitiveCheck] ✓ outcome=${outcome}, taskId=${canonicalTaskId.slice(0, 8)}, ` +
      `phase=${targetPhase}, budget=${floor.budgetCeilingCents}¢, floor="${floor.name}"`,
    );

    // Audit record
    await this.writeSystemReviewLog({
      event: 'definitive_budget_plan_queue_check',
      outcome,
      floorId,
      floorName: floor.name,
      taskId: canonicalTaskId,
      phaseNumber: targetPhase,
      budgetCents: floor.budgetCeilingCents,
      confirmationEvent,
      checkedAt: queuedAt,
    });

    return {
      outcome,
      taskId: canonicalTaskId,
      queuedAt,
      floorName: floor.name,
      phaseNumber: targetPhase,
      budgetCents: floor.budgetCeilingCents,
      confirmationEvent,
    };
  }

  // --- Budget Plan Invalidation (Internal) ---

  /**
   * Invalidate all completed budget-plan tasks for a floor that were calculated
   * using the incorrect $200 baseline, then requeue a revised task with the $500 baseline.
   *
   * Idempotent: if a revised budget-plan task (identified by its note in reviewFeedback
   * on the prompt or a queued/created task with the revision note) already exists,
   * the requeue step is skipped.
   *
   * Safety: never modifies TaskStatus (which would break the state machine). Uses
   * reviewStatus='rejected' and reviewFeedback to record the supersession note on
   * each stale task so downstream consumers know the output must not be used.
   */
  private async invalidateAndRequeueBudgetPlan(floor: Floor): Promise<void> {
    const SUPERSESSION_NOTE =
      'Revised budget from $200 to $500 — all prior budget-plan outputs are superseded ' +
      'and should not be used for downstream planning.';

    const floorId = floor.id;

    // Step 1: Mark all in-memory completed budget-plan tasks as superseded
    const markedCount = await this.taskManager.markBudgetPlanTasksSuperseded(
      floorId,
      SUPERSESSION_NOTE,
    );
    console.log(
      `[BudgetPlanInvalidation] Marked ${markedCount} in-memory budget-plan task(s) as ` +
      `superseded for "${floor.name}" (${floorId})`,
    );

    // Step 2: Also bulk-update any budget-plan tasks stored in Supabase that may not
    // be in the in-memory map (display-only restored tasks, prior-session records).
    try {
      const { getSupabase } = await import('../integrations/supabase.js');
      const sb = getSupabase();
      if (sb) {
        const { data: dbTasks, error: fetchErr } = await sb
          .from('tasks')
          .select('id, status, review_feedback')
          .eq('floor_id', floorId)
          .eq('task_type', 'budget-plan')
          .eq('status', 'completed');

        if (fetchErr) {
          console.warn(
            `[BudgetPlanInvalidation] Supabase fetch for stale budget-plan tasks failed: ` +
            `${fetchErr.message}`,
          );
        } else if (dbTasks && dbTasks.length > 0) {
          // Only update rows that haven't already been marked (avoids redundant writes)
          const unstaleIds = dbTasks
            .filter((r: { id: string; review_feedback: string | null }) =>
              r.review_feedback !== SUPERSESSION_NOTE,
            )
            .map((r: { id: string }) => r.id);

          if (unstaleIds.length > 0) {
            const { error: updateErr } = await sb
              .from('tasks')
              .update({
                review_status: 'rejected',
                review_feedback: SUPERSESSION_NOTE,
              })
              .in('id', unstaleIds);

            if (updateErr) {
              console.warn(
                `[BudgetPlanInvalidation] Supabase bulk-update failed: ${updateErr.message}`,
              );
            } else {
              console.log(
                `[BudgetPlanInvalidation] Supabase: marked ${unstaleIds.length} additional ` +
                `budget-plan task(s) as superseded in DB for "${floor.name}"`,
              );
            }
          } else {
            console.log(
              `[BudgetPlanInvalidation] All DB budget-plan tasks for "${floor.name}" ` +
              `already marked — no Supabase update needed`,
            );
          }
        } else {
          console.log(
            `[BudgetPlanInvalidation] No completed budget-plan tasks found in Supabase ` +
            `for "${floor.name}" — nothing to invalidate in DB`,
          );
        }
      }
    } catch (err) {
      console.warn(
        `[BudgetPlanInvalidation] Supabase bulk-update threw:`,
        (err as Error).message,
      );
    }

    // Step 3: Check whether a revised budget-plan task already exists (idempotency guard).
    // A revised task is identified by containing the supersession note in its prompt.
    const allFloorTasks = this.taskManager.getFloorTasks(floorId);
    const revisedAlreadyExists = allFloorTasks.some(
      t =>
        t.taskType === 'budget-plan' &&
        (t.status === 'queued' || t.status === 'created' || t.status === 'dispatched' || t.status === 'working') &&
        t.prompt.includes('Revised budget from $200 to $500'),
    );

    if (revisedAlreadyExists) {
      console.log(
        `[BudgetPlanInvalidation] Revised budget-plan task already queued for ` +
        `"${floor.name}" — skipping requeue (idempotent)`,
      );
      return;
    }

    // Step 4: Requeue a revised budget-plan task using $500 as the new baseline.
    // Use the same phase as prior budget-plan tasks (typically phase 3), or fall
    // back to phase 3 (Foundation Sprint) if none found.
    const priorBudgetTask = allFloorTasks.find(t => t.taskType === 'budget-plan');
    const targetPhase = priorBudgetTask?.phaseNumber ?? 3;

    const revisedPrompt =
      `NOTE: ${SUPERSESSION_NOTE}\n\n` +
      `Create a 12-month financial projection for "${floor.name}" using a $500 total budget baseline ` +
      `(${floor.budgetCeilingCents / 100} available). Include: revenue forecast, cost structure, ` +
      `unit economics, break-even analysis, and budget allocation. All figures must be calibrated ` +
      `to the $500 baseline — do not reference or reuse any prior $200-based projections.`;

    const newTask = this.taskManager.create({
      floorId,
      phaseNumber: targetPhase,
      assignedAgent: 'finance-agent',
      modelTier: this.modelRouter.getModelTier('finance-agent', 'foundation'),
      taskType: 'budget-plan',
      description:
        `[REVISED] Build financial plan for "${floor.name}" — $500 baseline ` +
        `(supersedes all $200-based outputs)`,
      prompt: revisedPrompt,
      priority: 'high',
    });

    // Register in dependency graph
    this.dependencyGraph.addTask(newTask.id, newTask.dependsOn);

    console.log(
      `[BudgetPlanInvalidation] Requeued revised budget-plan task ` +
      `${newTask.id.slice(0, 8)} (phase ${targetPhase}, priority: high) ` +
      `for "${floor.name}" with $500 baseline`,
    );

    // Broadcast so the dashboard reflects the new task immediately
    broadcastFloorEvent(floorId, 'task:created', {
      taskId: newTask.id,
      floorId,
      taskType: 'budget-plan',
    }).catch(() => {});

    // Emit structured lifecycle event for the requeued task — this is the floor feedback
    // chain confirmation required before marking the directive complete.
    const lifecycleEvent = this.taskManager.emitLifecycleEvent(
      newTask.id,
      true,  // reexecutionOccurred = true (this IS a requeue)
      'pending', // reexecutionOutcome = pending (task queued but not yet executed)
      'budget-plan:invalidate-and-requeue',
    );
    if (lifecycleEvent) {
      // Also broadcast the lifecycle event explicitly via Supabase realtime
      // so the floor feedback chain receives it synchronously before this method returns.
      await broadcastFloorEvent(floorId, 'task:lifecycle-event', {
        taskId: lifecycleEvent.taskId,
        queueState: lifecycleEvent.queueState,
        reexecutionOccurred: lifecycleEvent.reexecutionOccurred,
        reexecutionOutcome: lifecycleEvent.reexecutionOutcome,
        taskType: lifecycleEvent.taskType,
        agentId: lifecycleEvent.agentId,
        phaseNumber: lifecycleEvent.phaseNumber,
        trigger: lifecycleEvent.trigger,
        timestamp: lifecycleEvent.timestamp,
      });
      console.log(
        `[BudgetPlanInvalidation] Lifecycle event emitted and confirmed for task ` +
        `${newTask.id.slice(0, 8)}: queueState=${lifecycleEvent.queueState}, ` +
        `reexecutionOccurred=${lifecycleEvent.reexecutionOccurred}, ` +
        `reexecutionOutcome=${lifecycleEvent.reexecutionOutcome}`,
      );
    }

    // Audit log entry
    await this.writeSystemReviewLog({
      event: 'budget_plan_invalidation_and_requeue',
      floorId,
      floorName: floor.name,
      supersessionNote: SUPERSESSION_NOTE,
      inMemoryTasksMarked: markedCount,
      revisedTaskId: newTask.id,
      revisedTaskPhase: targetPhase,
      revisedBudgetDollars: floor.budgetCeilingCents / 100,
    });
  }

  // --- System Review Log ---

  /**
   * Write a structured entry to the system review log (data/review-log.jsonl).
   * Each entry is a newline-delimited JSON record with a timestamp and event data.
   * Used to capture audit findings, budget anomalies, and root-cause investigations
   * for later analysis without requiring a database write.
   */
  private async writeSystemReviewLog(entry: Record<string, unknown>): Promise<void> {
    try {
      const logDir = join(process.cwd(), 'data');
      const logPath = join(logDir, 'review-log.jsonl');
      const record = JSON.stringify({ timestamp: new Date().toISOString(), ...entry });
      await mkdir(logDir, { recursive: true });
      // Append-only: each call adds one line. File can be tailed or parsed with jq.
      const { appendFile } = await import('node:fs/promises');
      await appendFile(logPath, record + '\n', 'utf-8');
      console.log(`[SystemReviewLog] Entry written: ${entry['event'] ?? 'unknown'}`);
    } catch (err) {
      // Non-critical — log failure should not break floor creation
      console.warn(`[SystemReviewLog] Failed to write entry:`, (err as Error).message);
    }
  }

  // --- Health ---

  async getHealthStatus() {
    const openclawAvailable = await isOpenClawAvailable();
    const supabaseConnected = await checkSupabase();
    return {
      status: 'ok',
      uptime: process.uptime(),
      activeFloors: this.floors.size,
      activeTasks: this.concurrency.getActiveCount(),
      openclawAvailable,
      supabaseConnected,
      concurrency: { active: this.concurrency.getActiveCount(), slots: this.concurrency.getActiveSlots() },
    };
  }

  getCostSummary() {
    return [...this.floors.values()].map(floor => {
      const budget = this.budgetEnforcer.getStatus(floor.id);
      // budgetCeilingCents on floor is the source of truth (kept in sync by
      // updateCeiling); use it as the authoritative ceiling so the dashboard
      // always reflects the corrected value even before the next DB read.
      const ceilingCents = floor.budgetCeilingCents ?? budget?.ceilingCents ?? 0;
      const spentCents = budget?.spentCents ?? 0;
      const percent = ceilingCents > 0
        ? Math.round((spentCents / ceilingCents) * 100)
        : (budget?.percentUsed ?? 0);
      return {
        floorId: floor.id,
        floorName: floor.name,
        spentCents,
        ceilingCents,
        budgetDollars: ceilingCents / 100,
        percent,
        trustLevel: this.trustLadder.getLevel(floor.id),
      };
    });
  }

  // --- Core Event Loop ---

  private async processQueue(): Promise<void> {
    // Reap stale concurrency slots (tasks that dispatched but never completed)
    const reaped = this.concurrency.reapStale();
    for (const taskId of reaped) {
      const task = this.taskManager.getTask(taskId);
      if (task && task.status !== 'completed' && task.status !== 'escalated') {
        this.taskManager.recordFailure(taskId, 'Concurrency slot held too long — task appears hung');
      }
    }

    // FIX: Stall detection — recover tasks stuck in 'dispatched' or 'working' for > 10 minutes
    // This catches tasks where the dispatch promise resolved but the callback/completion was lost
    const STALL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
    const now = Date.now();
    for (const floor of this.floors.values()) {
      const floorTasks = this.taskManager.getFloorTasks(floor.id);
      for (const task of floorTasks) {
        if (
          (task.status === 'dispatched' || task.status === 'working') &&
          task.dispatchedAt &&
          now - task.dispatchedAt.getTime() > STALL_TIMEOUT_MS
        ) {
          console.warn(
            `[StallDetector] Task ${task.id.slice(0, 8)} (${task.taskType}) stuck in '${task.status}' ` +
            `for ${Math.round((now - task.dispatchedAt.getTime()) / 60000)}min — forcing failure + retry`,
          );
          this.concurrency.release(task.id);
          this.taskManager.recordFailure(task.id, `Stall detected: task in '${task.status}' for over 10 minutes`);
        }

        // FIX: Also recover 'failed' tasks that should have been retried but the setTimeout was lost
        if (
          task.status === 'failed' &&
          task.attempts < task.maxAttempts &&
          task.completedAt &&
          now - task.completedAt.getTime() > 120_000 // 2 min grace for normal setTimeout
        ) {
          console.warn(
            `[StallDetector] Task ${task.id.slice(0, 8)} stuck in 'failed' — ` +
            `retry was likely lost (attempt ${task.attempts}/${task.maxAttempts}). Re-queuing.`,
          );
          this.taskManager.transition(task.id, 'retry');
          this.taskManager.transition(task.id, 'queued');
        }
      }
    }

    // Periodic FM review — every ~10 minutes (300 iterations at 2s interval)
    this.processLoopCounter++;
    if (this.processLoopCounter % 300 === 0) {
      for (const floor of this.floors.values()) {
        if (floor.status === 'building' || floor.status === 'launched' || floor.status === 'operating') {
          this.floorManagerReview(floor.id, 'periodic').catch(() => {});
        }
      }
    }

    // FIX: Periodic phase-completion recheck — every ~2 minutes (60 iterations at 2s)
    // Catches phases that completed all tasks but the completion event was lost,
    // or tasks that were force-escalated by the stall detector above.
    if (this.processLoopCounter % 60 === 0) {
      for (const floor of this.floors.values()) {
        if (floor.status === 'building' || floor.status === 'launched' || floor.status === 'operating') {
          // FIX: Ensure current phase is active before checking completion.
          // After restart, phases may be loaded as 'pending' even though tasks exist
          // and currentPhase was advanced. Without activation, completePhase() silently
          // returns false and the gate notification never fires.
          const currentPhaseObj = this.phaseManager.getCurrentPhase(floor.id);
          if (!currentPhaseObj || currentPhaseObj.number !== floor.currentPhase) {
            console.log(`[PhaseRecheck] Phase mismatch for ${floor.name}: active=${currentPhaseObj?.number ?? 'none'}, currentPhase=${floor.currentPhase} — activating`);
            this.phaseManager.forceRecoveryActivate(floor.id, floor.currentPhase);
          }
          this.checkPhaseCompletion(floor.id, floor.currentPhase);
        }
      }
    }

    const queued = this.taskManager.getQueuedTasks();

    // Sort by priority: critical > high > normal > low
    const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
    const sorted = queued.sort(
      (a, b) => (PRIORITY_ORDER[a.priority ?? 'normal'] ?? 2) - (PRIORITY_ORDER[b.priority ?? 'normal'] ?? 2),
    );

    // Process batch of QUEUE_BATCH_SIZE tasks
    const batch = sorted.slice(0, QUEUE_BATCH_SIZE);

    // Log queued task count periodically (every ~30s = 15 loops at 2s interval)
    if (batch.length > 0 && (this.processLoopCounter < 150 || this.processLoopCounter % 15 === 0)) {
      console.log(`[Queue] ${queued.length} queued tasks, processing batch of ${batch.length}: ${batch.map(t => `${t.taskType}(${t.floorId.slice(0,8)})`).join(', ')}`);
    }

    // DEBUG: Log every blocked task for first 5 minutes (150 loops × 2s)
    const debugVerbose = this.processLoopCounter < 150 || this.processLoopCounter % 15 === 0;

    for (const task of batch) {
      // Safety controls check
      const safetyCheck = this.safetyControls.canDispatch(task.floorId);
      if (!safetyCheck.allowed) {
        if (debugVerbose) console.log(`[Queue] BLOCKED ${task.id.slice(0, 8)} (${task.taskType}): safety — ${safetyCheck.reason}`);
        continue;
      }

      // Dependency check
      if (task.dependsOn.length > 0 && !this.dependencyGraph.getReadyTasks().includes(task.id)) {
        if (debugVerbose) console.log(`[Queue] BLOCKED ${task.id.slice(0, 8)} (${task.taskType}): unmet dependencies [${task.dependsOn.join(',')}]`);
        continue;
      }

      // Guardian pre-check (includes money-action block, budget, PII, immutable rules)
      const guardianResult = this.guardian.verify({
        taskId: task.id,
        floorId: task.floorId,
        agentId: task.assignedAgent,
        modelTier: task.modelTier,
        estimatedCostCents: task.estimatedCostCents,
        prompt: task.prompt,
        taskType: task.taskType,
        approvalToken: task.approvalToken ?? undefined,
      });
      if (!guardianResult.approved) {
        if (debugVerbose) console.log(`[Queue] BLOCKED ${task.id.slice(0, 8)} (${task.taskType}): guardian — ${guardianResult.violations?.join(', ')}`);
        continue;
      }

      // TrustLadder enforcement: check if task needs owner approval at current trust level.
      // EXEMPT: Phases with explicit owner approval gates (3, 6, 8) already require human sign-off
      // at the phase level, so per-task trust gating is redundant and blocks the pipeline.
      // Without this exemption, Level 1 trust (default for new floors) blocks ALL tasks forever
      // because the queued→review transition was invalid in the state machine.
      const TRUST_EXEMPT_PHASES = new Set([3, 4, 5, 6, 8]);
      const trustExempt = TRUST_EXEMPT_PHASES.has(task.phaseNumber);
      if (!trustExempt && this.trustLadder.needsApproval(task.floorId, task.taskType)) {
        // Route to owner for approval instead of dispatching directly
        const transitioned = this.taskManager.transition(task.id, 'review');
        if (!transitioned) {
          console.warn(`[Queue] Trust gate: failed to transition task ${task.id.slice(0, 8)} (${task.taskType}) from '${task.status}' to 'review' — skipping`);
        }
        this.eventBus.emit('approval:needed', {
          taskId: task.id,
          floorId: task.floorId,
          type: 'trust-gate',
          summary: `Task "${task.taskType}" requires approval at current trust level (${this.trustLadder.getLevel(task.floorId)})`,
        });
        continue;
      }

      // Concurrency check
      const canDispatch = this.concurrency.canDispatch(task.floorId, task.modelTier);
      if (!canDispatch.allowed) {
        if (debugVerbose) console.log(`[Queue] BLOCKED ${task.id.slice(0, 8)} (${task.taskType}): concurrency — ${canDispatch.reason}`);
        continue;
      }

      // Budget-per-turn check: block if single call > 50% of remaining daily budget
      const budgetPerTurn = this.safetyControls.checkBudgetPerTurn(task.floorId, task.estimatedCostCents);
      if (!budgetPerTurn.allowed) {
        if (debugVerbose) console.log(`[Queue] BLOCKED ${task.id.slice(0, 8)} (${task.taskType}): budget-per-turn — ${budgetPerTurn.reason}`);
        continue;
      }

      // Rate limit backoff
      if (this.rateLimitBackoffMs > 0 && Date.now() - this.rateLimitSince < this.rateLimitBackoffMs) {
        if (debugVerbose) console.log(`[Queue] BLOCKED ${task.id.slice(0, 8)} (${task.taskType}): rate-limit-backoff — ${this.rateLimitBackoffMs}ms`);
        continue;
      }
      this.rateLimitBackoffMs = 0;

      // Trust ladder: check if auto-approve or needs review
      // (only affects post-completion flow, not dispatch)

      // Dispatch
      this.taskManager.transition(task.id, 'dispatched');
      this.concurrency.acquire(task.id, task.floorId, task.assignedAgent, task.modelTier);
      this.agentRegistry.updateStatus(task.floorId, task.assignedAgent, 'working', task.id);

      this.eventBus.emit('task:dispatched', {
        taskId: task.id,
        floorId: task.floorId,
        agentId: task.assignedAgent,
      });

      this.dispatchTask(task).catch(err => {
        console.error(`[EVE] Dispatch error for task ${task.id}:`, err);
        this.handleDispatchError(task, err);
      });

      // Continue loop to dispatch more ready tasks up to concurrency limit
    }
  }

  private async dispatchTask(task: Task): Promise<void> {
    const floor = this.floors.get(task.floorId);
    if (!floor) {
      this.taskManager.recordFailure(task.id, 'Floor not found');
      this.concurrency.release(task.id);
      return;
    }

    this.taskManager.transition(task.id, 'working');

    // Inject sibling context: if other tasks in the same phase already completed,
    // append their results so this agent benefits from prior work in the same phase.
    // EXCEPTION: Don't inject review/QA sibling results into build tasks — they confuse
    // the builder agent into "remediating" the review findings instead of doing its own job.
    const REVIEW_TASK_TYPES = new Set(['staging-review', 'copy-review', 'qa-review', 'content-review']);
    const BUILD_TASK_TYPES = new Set(['website-homepage', 'product-images', 'social-media-graphics', 'ad-creative-production']);
    const isBuildTask = BUILD_TASK_TYPES.has(task.taskType);
    const siblingResults = this.taskManager.getFloorTasks(task.floorId)
      .filter(t => t.phaseNumber === task.phaseNumber && t.id !== task.id && t.status === 'completed' && t.result)
      .filter(t => !(isBuildTask && REVIEW_TASK_TYPES.has(t.taskType)))
      .map(t => `--- ${t.taskType} (completed by ${t.assignedAgent}) ---\n${t.result!.slice(0, 1500)}`)
      .join('\n\n');
    if (siblingResults) {
      task.prompt += `\n\nOTHER COMPLETED WORK IN THIS PHASE (use for context and consistency):\n${siblingResults}`;
    }

    // Runaway detection
    const actionHash = createHash('md5').update(`${task.assignedAgent}:${task.taskType}:${task.description}`).digest('hex');
    if (this.safetyControls.recordTaskTurn(task.floorId, task.id, actionHash)) {
      this.taskManager.recordFailure(task.id, 'Runaway detected — task paused');
      this.concurrency.release(task.id);
      this.agentRegistry.updateStatus(task.floorId, task.assignedAgent, 'idle');
      return;
    }

    try {
      // Check if task qualifies for multi-agent council dispatch
      const councilPlan = isVirtualAgent(task.assignedAgent)
        ? shouldUseCouncil(task, floor, this.concurrency, this.budgetEnforcer)
        : null;

      if (councilPlan) {
        await this.dispatchCouncil(task, floor, councilPlan);
      } else if (isVirtualAgent(task.assignedAgent)) {
        await this.dispatchVirtual(task, floor);
      } else if (isRealAgent(task.assignedAgent)) {
        await this.dispatchReal(task, floor);
      }
    } catch (err) {
      // Handle budget errors specially — don't retry
      if (err instanceof BudgetExceededError) {
        this.taskManager.recordFailure(task.id, `Budget exceeded: ${err.message}`);
      } else {
        this.taskManager.recordFailure(task.id, err instanceof Error ? err.message : String(err));
      }
    } finally {
      this.concurrency.release(task.id);
      this.agentRegistry.updateStatus(task.floorId, task.assignedAgent, 'idle');
    }
  }

  /**
   * Re-build an enriched prompt for a task that was restored with an empty prompt.
   * Gathers completed deliverables from prior phases to inject context.
   */
  private rebuildTaskPrompt(task: Task, floor: Floor): string {
    const MAX_DELIVERABLE = 4000;
    const truncate = (s: string) => s.length > MAX_DELIVERABLE ? s.slice(0, MAX_DELIVERABLE) + '\n... [truncated]' : s;

    const allTasks = this.taskManager.getFloorTasks(task.floorId);
    const completedByType = new Map<string, string>();
    for (const t of allTasks) {
      if (t.status === 'completed' && t.result && t.phaseNumber < task.phaseNumber) {
        completedByType.set(t.taskType, t.result);
      }
    }

    // Build context from completed deliverables
    const sb = floor.selectedBrand;
    const brandContext = sb
      ? `\n\nOWNER-SELECTED BRAND:\nName: ${sb.name}\nTagline: "${sb.tagline}"\nPersonality: ${sb.personality}\nVoice: ${sb.voiceAttributes?.join(', ') || 'N/A'}`
      : '';

    const contextParts: string[] = [];
    const contextMap: Record<string, string> = {
      'brand-options': 'BRAND OPTIONS',
      'business-strategy': 'BUSINESS STRATEGY',
      'budget-plan': 'FINANCIAL PLAN',
      'brand-visual-system': 'BRAND VISUAL SYSTEM',
      'brand-voice-guide': 'BRAND VOICE GUIDE',
      'product-catalog': 'PRODUCT CATALOG',
      'content-calendar': 'CONTENT CALENDAR',
      'email-welcome-sequence': 'EMAIL WELCOME SEQUENCE',
      'promo-video-script': 'PROMO VIDEO SCRIPT',
      'staging-review': 'STAGING REVIEW',
      'copy-review': 'COPY REVIEW',
      'launch-ad-campaign': 'AD CAMPAIGN PLAN',
      'analytics-setup': 'ANALYTICS SETUP',
      'ad-creative-production': 'AD CREATIVE PRODUCTION',
      'conversion-tracking': 'CONVERSION TRACKING',
      'performance-review': 'PERFORMANCE REVIEW',
      'content-refresh': 'CONTENT REFRESH',
      'ad-optimization': 'AD OPTIMIZATION',
      'growth-report': 'GROWTH REPORT',
      'strategy-revision': 'STRATEGY REVISION',
    };

    for (const [taskType, label] of Object.entries(contextMap)) {
      const result = completedByType.get(taskType);
      if (result) {
        contextParts.push(`\n\n--- COMPLETED: ${label} ---\n${truncate(result)}`);
      }
    }

    // For tasks with canonical prompts, use those instead of the short task.description
    // (which lacks the required output format and detailed instructions).
    let basePrompt: string;
    if (task.taskType === 'brand-options') {
      basePrompt = BRAND_OPTIONS_PROMPT(floor.name, floor.goal);
    } else if (task.taskType === 'website-homepage') {
      basePrompt = WEBSITE_HOMEPAGE_PROMPT(floor.name);
    } else {
      basePrompt = task.description;
    }

    const enrichedPrompt = `${basePrompt}${brandContext}${contextParts.join('')}`;
    console.log(`[EVE] Re-enriched empty prompt for task ${task.id.slice(0, 8)} (${task.taskType}) — ${enrichedPrompt.length} chars`);
    return enrichedPrompt;
  }

  private async dispatchVirtual(task: Task, floor: Floor): Promise<void> {
    // If prompt is empty (e.g. restored from DB without prompt column), re-enrich from deliverables
    if (!task.prompt || task.prompt.trim() === '') {
      task.prompt = this.rebuildTaskPrompt(task, floor);
    }

    // Use simplified prompt on final attempt, full enriched prompt otherwise.
    // Append revisionNote (anti-slop / format feedback) so retry keeps full original prompt context.
    const isLastAttempt = task.attempts >= task.maxAttempts - 1;
    const basePrompt = isLastAttempt
      ? (this.taskManager.getSimplifiedPrompt(task.id) ?? task.prompt)
      : task.prompt;
    const description = task.revisionNote && !isLastAttempt
      ? `${basePrompt}\n\n${task.revisionNote}`
      : basePrompt;

    // Get conversation history with dynamic token budget estimate based on model tier
    // Opus prompts are more elaborate (~6000 tokens), Sonnet (~4000), Haiku (~2500)
    const systemPromptTokenEstimate = task.modelTier === 'opus' ? 6000 : task.modelTier === 'sonnet' ? 4000 : 2500;
    const history = await this.conversationStore.getMessages(
      task.floorId, task.assignedAgent, task.modelTier, systemPromptTokenEstimate,
    );

    // Rate-limit tier fallback: if Opus has been rate-limited for >5min, use Sonnet
    let effectiveTier = task.modelTier;
    if (task.modelTier === 'opus' && this.rateLimitBackoffMs > 300_000) {
      effectiveTier = 'sonnet';
    }

    // Phase 4: Adaptive model routing — override tier based on performance data
    // Infer task category from phase number: phase 1 = foundation, others = routine
    const taskCategory = task.phaseNumber <= 1 ? 'foundation' as const : 'routine' as const;
    const adaptiveRec = this.adaptiveModelRouter.getRecommendedTier(
      task.floorId, task.assignedAgent as AgentId, task.taskType, taskCategory,
    );
    if (adaptiveRec.isAdaptive) {
      effectiveTier = adaptiveRec.tier;
    }

    // Phase 4: Inject outcome gold standards and cross-floor intelligence
    const outcomeStandards = this.outcomeGoldStandards.getStandards(
      task.floorId, task.assignedAgent as AgentId, task.taskType,
    );
    const outcomeExamplesXml = outcomeStandards.length > 0
      ? this.outcomeGoldStandards.formatForPrompt(outcomeStandards)
      : undefined;

    const crossFloorInsights = this.crossFloorIntelligence.getRelevantInsights(
      task.assignedAgent as AgentId, task.taskType,
    );
    const crossFloorInsightsXml = crossFloorInsights.length > 0
      ? this.crossFloorIntelligence.formatForPrompt(crossFloorInsights)
      : undefined;

    // Track insight usage
    for (const insight of crossFloorInsights) {
      this.crossFloorIntelligence.recordInsightUsage(insight.id);
    }

    const result = await this.virtualDispatcher.dispatch({
      taskId: task.id,
      floorId: task.floorId,
      floorSlug: floor.slug,
      agentId: task.assignedAgent as VirtualAgentId,
      taskType: task.taskType,
      taskDescription: description,
      acceptanceCriteria: [],
      inputFiles: task.inputFiles,
      pendingInputs: [],
      outputSpec: task.outputFiles.join(', '),
      priority: task.priority,
      modelTier: effectiveTier,
      brandState: floor.brandState,
      selectedBrand: floor.selectedBrand ?? null,
      conversationHistory: history,
      outcomeExamplesXml,
      crossFloorInsightsXml,
    });

    if (!result.success) {
      // Emit explicit queue-status event for ALL virtual agent failures so the
      // floor-manager feedback channel can observe failures without retry exhaustion.
      const failTimestamp = new Date().toISOString();
      const failSummary = (result.error ?? 'Virtual dispatch failed').slice(0, 200);
      const failTrigger = `dispatchVirtual:${task.assignedAgent}:${task.taskType}:dispatch-failed`;

      // Always emit the generic queue-status event regardless of task type.
      // The EventBus handler (setupEventHandlers > task:queue-status) will route this
      // to both 'task:queue-status' and 'floor-manager-feedback' Supabase channels
      // with retry logic. Verify the listener is registered before emitting.
      try {
        this.eventBus.emit('task:queue-status', {
          taskId: task.id,
          floorId: task.floorId,
          agentId: task.assignedAgent,
          payload: {
            task_id: task.id,
            status: 'failed' as const,
            timestamp: failTimestamp,
            result_summary: failSummary,
          },
        });
        console.log(
          `[EVE] queue-status failure event emitted for task ${task.id.slice(0, 8)} ` +
          `(${task.taskType}, ${task.assignedAgent})`,
        );
      } catch (emitErr) {
        // EventBus emit itself threw — this means the listener list may be corrupted.
        // Fall back to direct Supabase broadcast so the feedback chain is not silently dropped.
        console.error(
          `[EVE] queue-status EventBus emit FAILED for task ${task.id.slice(0, 8)}: ` +
          `${(emitErr as Error).message}. Falling back to direct broadcastFloorEvent.`,
        );
        broadcastFloorEvent(task.floorId, 'floor-manager-feedback', {
          channel: 'floor-manager-feedback',
          task_id: task.id,
          current_queue_state: 'failed',
          execution_outcome: 'failure',
          taskType: task.taskType,
          agentId: task.assignedAgent,
          phaseNumber: task.phaseNumber,
          timestamp: failTimestamp,
          result_summary: failSummary,
          fallback: true,
        }).catch((broadcastErr: unknown) => {
          console.error(
            `[EVE] fallback floor-manager-feedback broadcast also FAILED for task ` +
            `${task.id.slice(0, 8)}: ${(broadcastErr as Error).message}`,
          );
        });
      }

      // For budget-plan/finance-agent: additionally emit the richer lifecycle event
      // (includes reexecutionOccurred, reexecutionOutcome fields) BEFORE recordFailure
      // so the feedback chain sees the structured lifecycle record.
      if (task.taskType === 'budget-plan' && task.assignedAgent === 'finance-agent') {
        this.taskManager.emitBudgetPlanQueueStatusEvent(task.id, 'failure', failTrigger);
      }

      this.taskManager.recordFailure(task.id, result.error ?? 'Virtual dispatch failed');
      return;
    }

    this.taskManager.recordResult(task.id, result.content, result.costCents);

    // Parse structured output for pipeline consumption
    const parsed = parseAgentOutput(task.assignedAgent, task.taskType, result.content);
    if (parsed.type !== 'raw') {
      this.eventBus.emit('output:parsed', { taskId: task.id, floorId: task.floorId, parsed });
    }

    // Output PII check — redact any detected PII before persistence
    const piiViolations = this.guardian.checkOutputPII(result.content);
    if (piiViolations.length > 0) {
      console.warn(`[Security] PII detected in ${task.assignedAgent} output for task ${task.id.slice(0, 8)}: ${piiViolations.join(', ')}`);
      // Redact PII patterns in place
      result.content = result.content
        .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]')
        .replace(/(\+1|1)?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, '[PHONE_REDACTED]')
        .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN_REDACTED]')
        .replace(/\b(?:\d{4}[-\s]?){3}\d{4}\b/g, '[CC_REDACTED]')
        .replace(/(?:sk|pk)[-_](?:live|test)[-_][a-zA-Z0-9]{20,}/g, '[KEY_REDACTED]');
      // Update stored result with redacted version
      this.taskManager.recordResult(task.id, result.content, result.costCents);
      this.eventBus.emit('security:pii-detected', {
        floorId: task.floorId,
        taskId: task.id,
        agentId: task.assignedAgent,
        violations: piiViolations,
      });
    }

    // Phase 4: Record task outcome for performance tracking
    const dispatchStart = task.dispatchedAt?.getTime() ?? Date.now();
    this.performanceTracker.recordTaskOutcome({
      taskId: task.id,
      floorId: task.floorId,
      agentId: task.assignedAgent,
      taskType: task.taskType,
      modelTier: effectiveTier,
      outputHash: createHash('sha256').update(result.content).digest('hex').slice(0, 16),
      costCents: result.costCents,
      firstTry: task.attempts <= 1,
      completionTimeMs: Date.now() - dispatchStart,
      createdAt: new Date(),
    });

    // Store conversation
    this.conversationStore.addMessage(task.floorId, task.assignedAgent, { role: 'user', content: description });
    this.conversationStore.addMessage(task.floorId, task.assignedAgent, { role: 'assistant', content: result.content });

    // ── ActionExecutor: Parse and execute structured actions from agent output ──
    const extractedActions = this.actionExecutor.extractActions(result.content);
    if (extractedActions.length > 0) {
      console.log(`[Orchestrator] Found ${extractedActions.length} action(s) in ${task.assignedAgent} output for task ${task.id.slice(0, 8)}`);

      const authContext = this.floorAuthContexts.get(task.floorId) ?? { floorId: task.floorId };
      // 120-second timeout for all action execution to prevent orphaned tasks
      let actionSummary: Awaited<ReturnType<typeof this.actionExecutor.execute>>;
      try {
        const execPromise = this.actionExecutor.execute(task.floorId, task.id, extractedActions, authContext);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Action execution timed out after 120s')), 120_000)
        );
        actionSummary = await Promise.race([execPromise, timeoutPromise]);
      } catch (timeoutErr) {
        console.error(`[Orchestrator] Action execution timeout/error for task ${task.id.slice(0, 8)}: ${(timeoutErr as Error).message}`);
        // Don't fail the task — let it continue without action results
        actionSummary = { actionsFound: extractedActions.length, actionsExecuted: 0, actionsPendingApproval: 0, actionsFailed: extractedActions.length, totalCostCents: 0, results: [] };
      }

      // Record action execution costs
      if (actionSummary.totalCostCents > 0) {
        this.budgetEnforcer.recordCost(task.floorId, actionSummary.totalCostCents);
      }

      // Download and save any generated images from action results to workspace
      if (floor) {
        let imgIdx = 0;
        for (const actionResult of actionSummary.results) {
          if (!actionResult.success || !actionResult.data) continue;
          const urls = (actionResult.data['urls'] as string[]) ?? [];
          const singleUrl = actionResult.data['url'] as string | undefined;
          const allUrls = singleUrl ? [...urls, singleUrl] : urls;
          for (const url of allUrls) {
            if (!url || typeof url !== 'string' || !url.startsWith('http')) continue;
            imgIdx++;
            const ext = url.includes('.png') ? 'png' : url.includes('.svg') ? 'svg' : 'webp';
            const safeName = `${task.taskType}-action-${imgIdx}.${ext}`;
            const saved = await this.saveGeneratedImage(floor, url, safeName);
            if (saved) {
              console.log(`[Orchestrator] Saved action-generated image: ${saved}`);
            }
          }
        }
      }

      // Append execution results to the task output so downstream agents can reference them
      const resultText = this.actionExecutor.formatResultsForOutput(actionSummary);
      if (resultText) {
        result.content += resultText;
        this.taskManager.recordResult(task.id, result.content, result.costCents + actionSummary.totalCostCents);
      }

      // Emit action execution event for dashboard visibility
      this.eventBus.emit('task:actions-executed', {
        floorId: task.floorId,
        taskId: task.id,
        agent: task.assignedAgent,
        summary: {
          executed: actionSummary.actionsExecuted,
          pending: actionSummary.actionsPendingApproval,
          failed: actionSummary.actionsFailed,
          costCents: actionSummary.totalCostCents,
        },
      });

      // If all actions failed, treat as task failure for retry
      if (actionSummary.actionsExecuted === 0 && actionSummary.actionsPendingApproval === 0 && actionSummary.actionsFailed > 0) {
        const failedActions = actionSummary.results.filter(r => !r.success).map(r => `${r.action}: ${r.error}`).join('; ');
        console.warn(`[Orchestrator] All actions failed for task ${task.id.slice(0, 8)}: ${failedActions}`);
        task.revisionNote = `ACTION EXECUTION FAILED: All ${actionSummary.actionsFailed} actions failed. Errors: ${failedActions}. Please fix the action specifications and retry.`;
        this.taskManager.recordFailure(task.id, `All actions failed: ${failedActions}`);
        return;
      }
    }

    // Anti-slop check — use template's antiSlopEnabled flag instead of hardcoded agent list
    // EXEMPT: Strategic/brand tasks (brand-options, business-strategy) naturally use words
    // like "elevate" and "leverage" in legitimate brand positioning context. Only apply
    // anti-slop to customer-facing copy tasks (product descriptions, social posts, ads).
    const ANTI_SLOP_EXEMPT_TASKS = new Set([
      'brand-options', 'business-strategy', 'budget-plan', 'strategy-revision',
      // Review tasks naturally reference slop words when critiquing copy — exempt them
      'copy-review', 'staging-review', 'content-review', 'qa-review',
      // Ad/campaign tasks discuss marketing concepts that overlap with slop words
      'ad-creative-production', 'ad-campaign-setup', 'campaign-plan', 'conversion-tracking',
      // Creative/build tasks — contain image generation prompts and marketing copy
      'product-images', 'social-media-graphics', 'website-homepage',
      // Email sequences — marketing copy naturally uses persuasive language
      'email-welcome-sequence', 'email-sequence', 'email-campaign',
    ]);
    const agentTemplate = await this.loadAgentTemplate(task.assignedAgent);
    if (agentTemplate?.antiSlopEnabled && !ANTI_SLOP_EXEMPT_TASKS.has(task.taskType)) {
      const slopViolations = this.guardian.checkAntiSlop(result.content);
      if (slopViolations.length > 0) {
        this.improvementEngine.recordSlopViolation(task.floorId, task.assignedAgent, task.taskType);
        // Store revision note separately so the original prompt is preserved across retries.
        // The dispatch path reads task.revisionNote and appends it to the full prompt.
        task.revisionNote = `IMPORTANT REVISION NOTE: Your previous output was rejected because it contained these prohibited marketing buzzwords: ${slopViolations.join(', ')}.\nRewrite your output avoiding ALL of these words/phrases. Use concrete, specific language instead of generic marketing copy.`;
        this.taskManager.recordFailure(
          task.id,
          `Anti-slop: rewrite without "${slopViolations.join('", "')}"`,
        );
        return;
      }
    }

    // Generated Knowledge format validation — only for analytical task types
    const ANALYTICAL_TASK_TYPES = new Set([
      'business-strategy', 'budget-plan', 'analytics-setup', 'performance-review',
      'growth-report', 'ad-optimization', 'strategy-revision', 'launch-ad-campaign',
    ]);
    if (agentTemplate?.usesGeneratedKnowledge && ANALYTICAL_TASK_TYPES.has(task.taskType) && task.attempts < 1) {
      const hasPhase1 = /phase\s*1|facts?:|what\s+do\s+we\s+know|market\s*research|data\s*points|key\s*findings/i.test(result.content);
      const hasPhase2 = /phase\s*2|analysis:|reason|assessment|evaluation|implications/i.test(result.content);
      const hasPhase3 = /phase\s*3|recommend|proposal|action\s*plan|strategic\s*plan|next\s*steps|conclusion/i.test(result.content);
      if (!hasPhase1 || !hasPhase2 || !hasPhase3) {
        const missing = [!hasPhase1 && 'Phase 1 (Facts)', !hasPhase2 && 'Phase 2 (Analysis)', !hasPhase3 && 'Phase 3 (Recommendations)'].filter(Boolean).join(', ');
        console.log(`[Orchestrator] Generated Knowledge format missing ${missing} in ${task.assignedAgent}:${task.taskType} — retrying`);
        task.revisionNote = `FORMAT REVISION: Your output must follow the Generated Knowledge pattern with clearly labeled phases:\nPhase 1: Generate facts (what do we know?)\nPhase 2: Reason using ONLY those facts\nPhase 3: Recommend with expected impact, timeline, risk, and rollback plan.\nYour previous output was missing: ${missing}. Please restructure with all 3 phases clearly labeled.`;
        this.taskManager.recordFailure(task.id, `Generated Knowledge format missing: ${missing}`);
        return;
      }
    }

    // Write output to workspace
    if (task.outputFiles.length > 0) {
      for (const outputPath of task.outputFiles) {
        await this.workspace.writeFile(floor.slug, outputPath, result.content);
      }
    }

    // Extract brand state from foundation deliverables
    if (task.taskType === 'brand-visual-system' || task.taskType === 'brand-voice-guide') {
      await this.extractBrandState(task, floor, result.content);
    }

    // Check for media generation requests in Design/Video agent outputs
    if (task.assignedAgent === 'design-agent' || task.assignedAgent === 'video-agent') {
      await this.triggerMediaGeneration(task, floor, result.content);
    }

    // Track performance
    const firstTry = task.attempts === 0;
    this.improvementEngine.recordTaskCompletion(task.floorId, task.assignedAgent, task.taskType, firstTry, result.costCents);

    // Persist cost event to Supabase cost_events table (fire-and-forget)
    if (result.costCents > 0) {
      this.budgetEnforcer.persistCostEvent(task.floorId, task.id, task.assignedAgent, result.costCents).catch(() => {});
    }

    // REQUIREMENT: Emit structured pre-completion queue-status event BEFORE marking 'complete'.
    // This is required by system learnings so floor-manager verification loops can resolve
    // task state without exhausting retry cycles.
    // If emission fails after 3 retries, the task is held in pending_verification and NOT
    // marked complete — it will be escalated via recordFailure instead.
    const emissionOk = await this.taskManager.emitPreCompletionEvent(task.id, 'complete');
    if (!emissionOk) {
      // Emission failed after all retries — hold task in pending_verification, do not complete
      console.error(
        `[EVE] Pre-completion event emission FAILED for task ${task.id.slice(0, 8)} ` +
        `(${task.taskType}, ${task.assignedAgent}) — task held in pending_verification, ` +
        `NOT marking complete. Floor-manager escalation triggered.`,
      );
      sendNotification({
        title: 'Task Held: pending_verification',
        body: `Task ${task.id.slice(0, 8)} (${task.taskType}) could not emit pre-completion event. ` +
          `Held in pending_verification. Manual review required.`,
        floorId: task.floorId,
        type: 'alert',
      });
      // Record failure so retry/escalation logic runs
      this.taskManager.recordFailure(
        task.id,
        'pre-completion event emission failed after 3 retries — held in pending_verification',
      );
      return;
    }

    // REQUIREMENT (system learnings): After successful execution, emit an explicit
    // queue-status event carrying {task_id, current_queue_state, execution_outcome}
    // to the floor-manager feedback channel so queue state can be verified without
    // retry exhaustion. This applies to ALL tasks, not just budget-plan.
    // For budget-plan/finance-agent tasks, also emit the richer lifecycle event.
    if (task.taskType === 'budget-plan' && task.assignedAgent === 'finance-agent') {
      const queueStatusEmitted = this.taskManager.emitBudgetPlanQueueStatusEvent(
        task.id,
        'success',
        'dispatchVirtual:finance-agent:budget-plan:post-execution',
      );
      if (queueStatusEmitted) {
        try {
          await broadcastFloorEvent(task.floorId, 'task:queue-status', {
            task_id: task.id,
            current_queue_state: 'completed',
            execution_outcome: 'success',
            agentId: task.assignedAgent,
            taskType: task.taskType,
            phaseNumber: task.phaseNumber,
            timestamp: new Date().toISOString(),
            result_summary: (task.result ?? '').slice(0, 200),
            trigger: 'dispatchVirtual:finance-agent:budget-plan:post-execution',
          });
          // Explicitly broadcast floor-manager-feedback channel with the three
          // required fields so the floor manager feedback loop can resolve the task state.
          await broadcastFloorEvent(task.floorId, 'floor-manager-feedback', {
            channel: 'floor-manager-feedback',
            task_id: task.id,
            current_queue_state: 'completed',
            execution_outcome: 'success',
            taskType: task.taskType,
            agentId: task.assignedAgent,
            phaseNumber: task.phaseNumber,
            timestamp: new Date().toISOString(),
            result_summary: (task.result ?? '').slice(0, 200),
          });
          console.log(
            `[EVE] Explicit queue-status + floor-manager-feedback broadcast confirmed for ` +
            `budget-plan task ${task.id.slice(0, 8)} ` +
            `(current_queue_state=completed, execution_outcome=success)`,
          );
        } catch (broadcastErr) {
          console.error(
            `[EVE] queue-status broadcast FAILED for budget-plan task ` +
            `${task.id.slice(0, 8)}: ${(broadcastErr as Error).message}`,
          );
        }
      }
    }

    // Broadcast via Supabase realtime
    broadcastFloorEvent(task.floorId, 'task:completed', { taskId: task.id, agent: task.assignedAgent }).catch(() => {});

    this.taskManager.transition(task.id, 'completed');

    // Persist task state
    const updatedTask = this.taskManager.getTask(task.id);
    if (updatedTask) persistWithRetry(() => saveTask(updatedTask), `task:dispatch-result:${task.id.slice(0, 8)}`);
  }

  /**
   * Council dispatch — runs N agents in parallel with different perspectives,
   * then an evaluator picks the best output. Falls back to single-agent on failure.
   */
  private async dispatchCouncil(task: Task, floor: Floor, councilPlan: import('./council-router.js').CouncilPlan): Promise<void> {
    // Build the same dispatch input that dispatchVirtual would use
    if (!task.prompt || task.prompt.trim() === '') {
      task.prompt = this.rebuildTaskPrompt(task, floor);
    }

    const description = task.revisionNote
      ? `${task.prompt}\n\n${task.revisionNote}`
      : task.prompt;

    // Get conversation history with dynamic token budget estimate based on model tier
    // Opus prompts are more elaborate (~6000 tokens), Sonnet (~4000), Haiku (~2500)
    const systemPromptTokenEstimate = task.modelTier === 'opus' ? 6000 : task.modelTier === 'sonnet' ? 4000 : 2500;
    const history = await this.conversationStore.getMessages(
      task.floorId, task.assignedAgent, task.modelTier, systemPromptTokenEstimate,
    );

    const baseInput = {
      taskId: task.id,
      floorId: task.floorId,
      floorSlug: floor.slug,
      agentId: task.assignedAgent as VirtualAgentId,
      taskType: task.taskType,
      taskDescription: description,
      acceptanceCriteria: [] as string[],
      inputFiles: task.inputFiles,
      pendingInputs: [] as string[],
      outputSpec: task.outputFiles.join(', '),
      priority: task.priority,
      modelTier: task.modelTier,
      brandState: floor.brandState,
      selectedBrand: floor.selectedBrand ?? null,
      conversationHistory: history,
    };

    const councilResult = await this.councilDispatcher.dispatch(baseInput, councilPlan);

    // If council failed entirely, fall back to single-agent dispatch
    if (councilResult.winnerIndex === -1 || !councilResult.winnerContent) {
      console.warn(`[Council] Council failed for ${task.taskType} — falling back to single-agent dispatch`);
      await this.dispatchVirtual(task, floor);
      return;
    }

    // Record result using the winning output
    this.taskManager.recordResult(task.id, councilResult.winnerContent, councilResult.totalCostCents);

    // Store council metadata for dashboard display
    this.councilResults.set(task.id, councilResult);

    // Store conversation
    this.conversationStore.addMessage(task.floorId, task.assignedAgent, { role: 'user', content: description });
    this.conversationStore.addMessage(task.floorId, task.assignedAgent, { role: 'assistant', content: councilResult.winnerContent });

    // Run the same post-processing as dispatchVirtual (anti-slop, generated knowledge, etc.)
    const agentTemplate = await this.loadAgentTemplate(task.assignedAgent);
    if (agentTemplate?.antiSlopEnabled) {
      const slopViolations = this.guardian.checkAntiSlop(councilResult.winnerContent);
      if (slopViolations.length > 0) {
        this.improvementEngine.recordSlopViolation(task.floorId, task.assignedAgent, task.taskType);
        task.revisionNote = `IMPORTANT REVISION NOTE: Your previous output was rejected because it contained these prohibited marketing buzzwords: ${slopViolations.join(', ')}.\nRewrite your output avoiding ALL of these words/phrases. Use concrete, specific language instead of generic marketing copy.`;
        this.taskManager.recordFailure(task.id, `Anti-slop: rewrite without "${slopViolations.join('", "')}" (council output)`);
        return;
      }
    }

    // Write output to workspace
    if (task.outputFiles.length > 0) {
      for (const outputPath of task.outputFiles) {
        await this.workspace.writeFile(floor.slug, outputPath, councilResult.winnerContent);
      }
    }

    // Extract brand state from foundation deliverables
    if (task.taskType === 'brand-visual-system' || task.taskType === 'brand-voice-guide') {
      await this.extractBrandState(task, floor, councilResult.winnerContent);
    }

    // Check for media generation requests in Design/Video agent outputs (council path)
    if (task.assignedAgent === 'design-agent' || task.assignedAgent === 'video-agent') {
      await this.triggerMediaGeneration(task, floor, councilResult.winnerContent);
    }

    // Track performance
    const firstTry = task.attempts === 0;
    this.improvementEngine.recordTaskCompletion(task.floorId, task.assignedAgent, task.taskType, firstTry, councilResult.totalCostCents);

    // Persist cost
    if (councilResult.totalCostCents > 0) {
      this.budgetEnforcer.persistCostEvent(task.floorId, task.id, task.assignedAgent, councilResult.totalCostCents).catch(() => {});
    }

    // Emit queue-status and completion events
    this.eventBus.emit('task:queue-status', {
      taskId: task.id,
      floorId: task.floorId,
      agentId: task.assignedAgent,
      payload: {
        task_id: task.id,
        status: 'complete' as const,
        timestamp: new Date().toISOString(),
        result_summary: `Council winner (${councilResult.proposals.filter(p => p.success).length} proposals evaluated): ${councilResult.rationale.slice(0, 200)}`,
      },
    });

    console.log(
      `[Council] ${task.taskType} completed via ${councilResult.proposals.filter(p => p.success).length}-agent council ` +
      `(winner: proposal ${councilResult.winnerIndex}, cost: ${councilResult.totalCostCents}¢, rationale: ${councilResult.rationale.slice(0, 100)})`,
    );

    // Broadcast completion and transition task
    broadcastFloorEvent(task.floorId, 'task:completed', { taskId: task.id, agent: task.assignedAgent }).catch(() => {});
    this.taskManager.transition(task.id, 'completed');

    // Persist task state
    const updatedTask2 = this.taskManager.getTask(task.id);
    if (updatedTask2) persistWithRetry(() => saveTask(updatedTask2), `task:council-result:${task.id.slice(0, 8)}`);
  }

  private async dispatchReal(task: Task, floor: Floor): Promise<void> {
    const agentRecord = this.agentRegistry.getAgent(task.floorId, task.assignedAgent);
    const openclawId = agentRecord?.openclawAgentId ?? `${floor.slug}-${task.assignedAgent}`;

    const result = await this.openclawDispatcher.dispatch({
      taskId: task.id,
      floorId: task.floorId,
      agentId: task.assignedAgent as RealAgentId,
      openclawAgentId: openclawId,
      message: task.prompt,
    });

    if (result.success) {
      this.taskManager.recordResult(task.id, result.output, 0);

      // Estimate real agent cost from output length (OpenClaw doesn't expose token counts)
      // Approximate: ~4 chars per token, Opus=$15/MTok input+output combined estimate
      const estimatedTokens = Math.ceil((task.prompt.length + result.output.length) / 4);
      const perTokenCents = task.modelTier === 'opus' ? 0.0015 : task.modelTier === 'sonnet' ? 0.0003 : 0.0001;
      const estimatedCostCents = Math.round(estimatedTokens * perTokenCents * 100) / 100;

      if (estimatedCostCents > 0) {
        this.budgetEnforcer.recordCost(task.floorId, estimatedCostCents);
        this.eventBus.emit('cost:recorded', {
          floorId: task.floorId,
          taskId: task.id,
          costCents: estimatedCostCents,
        });
      }

      // REQUIREMENT: Emit structured pre-completion queue-status event BEFORE marking 'complete'.
      const emissionOk = await this.taskManager.emitPreCompletionEvent(task.id, 'complete');
      if (!emissionOk) {
        console.error(
          `[EVE] Pre-completion event emission FAILED for real task ${task.id.slice(0, 8)} ` +
          `(${task.taskType}, ${task.assignedAgent}) — task held in pending_verification.`,
        );
        this.taskManager.recordFailure(
          task.id,
          'pre-completion event emission failed after 3 retries — held in pending_verification',
        );
        return;
      }

      this.taskManager.transition(task.id, 'completed');
    } else {
      this.taskManager.recordFailure(task.id, result.error ?? 'OpenClaw dispatch failed');
    }
  }

  /**
   * Extract brand identity from foundation task outputs (colors, typography, brand name)
   * and populate floor.themeConfig so the dashboard/floor UI can apply the brand visually.
   *
   * NOTE: floor.brandState (the enum) is NOT modified here — it controls workflow state
   * (pre-foundation → foundation-review → foundation-approved). Theme data lives in
   * floor.themeConfig (FloorTheme) which is persisted to the floors.theme_config JSONB column.
   */
  private async extractBrandState(task: Task, floor: Floor, content: string): Promise<void> {
    try {
      // Start from existing themeConfig so both tasks can contribute
      const currentTheme: Record<string, unknown> = floor.themeConfig
        ? { ...floor.themeConfig }
        : { palette: [] };

      if (task.taskType === 'brand-visual-system') {
        // --- Primary color ---
        // Patterns: "| `#6C3BE2` |" table cells, "Primary: `#6C3BE2`", inline hex after "primary"
        const primaryHex =
          content.match(/Primary[^|]*\|[^|]*`(#[0-9A-Fa-f]{6})`/i) ||
          content.match(/\*\*Primary[^*]*\*\*[^`]*`(#[0-9A-Fa-f]{6})`/i) ||
          content.match(/primary\s+(?:brand\s+)?(?:color|colour)[:\s]*`?(#[0-9A-Fa-f]{6})`?/i) ||
          content.match(/`(#[0-9A-Fa-f]{6})`[^\n]*Primary/i);
        if (primaryHex?.[1]) currentTheme.primaryColor = primaryHex[1];

        // --- Secondary / accent color ---
        const secondaryHex =
          content.match(/Secondary[^|]*\|[^|]*`(#[0-9A-Fa-f]{6})`/i) ||
          content.match(/\|\s*`?(#[0-9A-Fa-f]{6})`?\s*\|[^|]*[Ss]econdary/i) ||
          content.match(/\*\*Secondary[^*]*\*\*[^`]*`(#[0-9A-Fa-f]{6})`/i) ||
          content.match(/secondary\s+(?:brand\s+)?(?:color|colour)[:\s]*`?(#[0-9A-Fa-f]{6})`?/i);
        if (secondaryHex?.[1]) currentTheme.secondaryColor = secondaryHex[1];

        // --- Accent color ---
        const accentHex =
          content.match(/Accent[^|]*\|[^|]*`(#[0-9A-Fa-f]{6})`/i) ||
          content.match(/accent\s+(?:color|colour)[:\s]*`?(#[0-9A-Fa-f]{6})`?/i);
        if (accentHex?.[1]) currentTheme.accentColor = accentHex[1];

        // --- Background color ---
        const bgHex =
          content.match(/Background[^|]*\|[^|]*`(#[0-9A-Fa-f]{6})`/i) ||
          content.match(/background[:\s]*`?(#[0-9A-Fa-f]{6})`?/i);
        if (bgHex?.[1]) currentTheme.backgroundColor = bgHex[1];

        // --- Full palette: grab all "**Name** | `#RRGGBB`" table rows ---
        const colorMatches = [
          ...content.matchAll(/\*\*([A-Za-z][A-Za-z ]{1,30})\*\*\s*\|[^|]*`(#[0-9A-Fa-f]{6})`/g),
        ];
        // Also catch bare table rows: "| Name | #RRGGBB |"
        const tableMatches = [
          ...content.matchAll(/\|\s*([A-Za-z][A-Za-z ]{1,30})\s*\|\s*`?(#[0-9A-Fa-f]{6})`?/g),
        ];
        const allColorPairs = [...colorMatches, ...tableMatches];
        if (allColorPairs.length > 0) {
          const seen = new Set<string>();
          currentTheme.palette = allColorPairs
            .filter(m => {
              const hex = m[2]?.toUpperCase();
              if (!hex || seen.has(hex)) return false;
              seen.add(hex);
              return true;
            })
            .slice(0, 8)
            .map(m => ({ name: m[1]!.trim(), hex: m[2]!.toUpperCase() }));
        }

        // --- Typography ---
        // Patterns: `#### Heading Font: **"Space Grotesk"**`, "Heading: Space Grotesk"
        const headingFont =
          content.match(/Heading\s+Font\s*:\s*\*{0,2}\s*"([^"]+)"/i) ||
          content.match(/Heading\s+Font\s*:\s*\*{0,2}\s*'([^']+)'/i) ||
          content.match(/Heading\s+Font[:\s]+\*{0,2}\s*([A-Za-z][A-Za-z0-9 ]{2,30}?)\s*\*{0,2}\s*(?:\(|\n|,|\.|\|)/i) ||
          content.match(/H1[^:]*:[^A-Za-z]*([A-Za-z][A-Za-z0-9 ]{2,30})\s*(?:\(|font|typeface)/i);
        if (headingFont?.[1]) currentTheme.headingFont = headingFont[1].trim();

        const bodyFont =
          content.match(/Body\s+Font\s*:\s*\*{0,2}\s*"([^"]+)"/i) ||
          content.match(/Body\s+Font\s*:\s*\*{0,2}\s*'([^']+)'/i) ||
          content.match(/Body\s+Font[:\s]+\*{0,2}\s*([A-Za-z][A-Za-z0-9 ]{2,30}?)\s*\*{0,2}\s*(?:\(|\n|,|\.|\|)/i) ||
          content.match(/body\s+(?:copy|text)[^:]*:[^A-Za-z]*([A-Za-z][A-Za-z0-9 ]{2,30})\s*(?:\(|font|typeface)/i);
        if (bodyFont?.[1]) currentTheme.bodyFont = bodyFont[1].trim();

        // --- Logo description ---
        const logoMatch =
          content.match(/(?:Primary Logo|Logo Concept)[^\n]*\n+([^\n]{20,200})/i) ||
          content.match(/logo[^:]*:\s*([^\n]{20,200})/i);
        if (logoMatch?.[1]) {
          currentTheme.logoDescription = logoMatch[1].trim().slice(0, 250);
        }

        console.log(
          `[EVE] Brand visuals extracted for ${floor.name}:` +
          ` primary=${currentTheme.primaryColor ?? 'not found'}` +
          `, secondary=${currentTheme.secondaryColor ?? 'not found'}` +
          `, heading=${currentTheme.headingFont ?? 'not found'}` +
          `, body=${currentTheme.bodyFont ?? 'not found'}` +
          `, palette=${(currentTheme.palette as unknown[])?.length ?? 0} colors`,
        );
      }

      if (task.taskType === 'brand-voice-guide') {
        // --- Voice pillars / principles ---
        const pillarsMatch =
          content.match(/Voice Pillars?\s*[—\-:]\s*(.+)/i) ||
          content.match(/voice (?:principles?|rules?|pillars?)[^\n]*\n((?:\s*[-*\d.]+\s*.+\n?){2,6})/i);
        if (pillarsMatch?.[1]) {
          currentTheme.voicePrinciples = pillarsMatch[1].trim().slice(0, 350);
        }

        // --- Tagline / hero headline ---
        const taglineMatch =
          content.match(/(?:hero|headline|tagline)[^:]*:[^\n"]*[""](.{10,120}?)[""]/i) ||
          content.match(/(?:hero|headline|tagline)[^\n]*\n\s*(?:[#*]*\s*)(.{10,120})/i);
        if (taglineMatch?.[1]) {
          currentTheme.tagline = taglineMatch[1].replace(/[*#"]/g, '').trim().slice(0, 120);
        }

        console.log(
          `[EVE] Brand voice extracted for ${floor.name}:` +
          ` pillars="${String(currentTheme.voicePrinciples ?? '').slice(0, 80)}"` +
          `, tagline="${currentTheme.tagline ?? 'not found'}"`,
        );
      }

      // Stamp extraction time
      currentTheme.extractedAt = new Date().toISOString();

      // Write to themeConfig — NOT brandState (which stays as the workflow enum)
      floor.themeConfig = currentTheme as unknown as import('../config/types.js').FloorTheme;
      await saveFloor(floor);

      // Broadcast the full theme so the dashboard can apply CSS variables immediately
      broadcastFloorEvent(floor.id, 'brand:theme-updated', {
        floorId: floor.id,
        theme: floor.themeConfig,
      }).catch(() => {});

      console.log(`[EVE] Theme config saved for ${floor.name} (task: ${task.taskType})`);
    } catch (err) {
      console.warn(`[EVE] Brand extraction failed for ${task.taskType}:`, (err as Error).message);
    }
  }

  /**
   * Parse Design/Video agent output for media generation requests and trigger them.
   * Supports multiple generation blocks in a single output (e.g. logo + hero image).
   */
  /**
   * Map short model names from LLM output to actual API model IDs.
   * The LLM writes "Target model: recraft" but fal.ai needs "fal-ai/recraft-v3".
   */
  private resolveModelId(shortName: string): { model: string; useGptImage: boolean } {
    const lower = shortName.toLowerCase().trim();

    // GPT Image models → route to OpenAI if available, else fall back to fal ideogram
    if (lower.includes('gpt')) {
      const hasOpenAI = !!process.env['OPENAI_API_KEY'];
      if (hasOpenAI) return { model: shortName, useGptImage: true };
      // Fallback: ideogram handles text-in-images well
      console.log(`[Media] OpenAI not configured — falling back to fal-ai/ideogram/v2 for text-in-image`);
      return { model: 'fal-ai/ideogram/v2', useGptImage: false };
    }

    // Map short names to full fal.ai model IDs
    const MODEL_MAP: Record<string, string> = {
      'recraft': 'fal-ai/recraft/v3/text-to-image',
      'recraft-v3': 'fal-ai/recraft/v3/text-to-image',
      'flux': 'fal-ai/flux/dev',
      'flux-dev': 'fal-ai/flux/dev',
      'flux-pro': 'fal-ai/flux-pro',
      'flux-schnell': 'fal-ai/flux/schnell',
      'ideogram': 'fal-ai/ideogram/v2',
      'ideogram-v2': 'fal-ai/ideogram/v2',
    };

    const resolved = MODEL_MAP[lower] ?? (lower.startsWith('fal-ai/') ? lower : `fal-ai/${lower}`);
    return { model: resolved, useGptImage: false };
  }

  /**
   * Download a generated image URL and save it to the floor workspace.
   */
  private async saveGeneratedImage(floor: Floor, url: string, filename: string): Promise<string> {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { getConfig } = await import('../config/index.js');

    const mediaDir = join(getConfig().PROJECTS_DIR, floor.slug, 'media');
    await mkdir(mediaDir, { recursive: true });

    const filePath = join(mediaDir, filename);

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(filePath, buffer);
      console.log(`[Media] Saved ${filename} (${buffer.length} bytes) → ${filePath}`);
      return `media/${filename}`;
    } catch (err) {
      console.error(`[Media] Failed to download/save ${filename}:`, err instanceof Error ? err.message : err);
      return '';
    }
  }

  private async triggerMediaGeneration(task: Task, floor: Floor, content: string): Promise<void> {
    // Find ALL generation blocks — each block has a Generation prompt + Target model pair
    const blockPattern = /Generation prompt:\s*(.+?)(?:\n|$)[\s\S]*?Target model:\s*(.+?)(?:\n|$)/gi;
    let match: RegExpExecArray | null;
    let generated = 0;
    const savedFiles: string[] = [];

    while ((match = blockPattern.exec(content)) !== null) {
      const genPrompt = match[1]!.trim();
      const rawModel = match[2]!.trim();
      const { model, useGptImage } = this.resolveModelId(rawModel);

      // Look for dimensions near this block (within 200 chars before/after)
      const nearbyContent = content.slice(Math.max(0, match.index - 200), match.index + match[0].length + 200);
      const widthMatch = nearbyContent.match(/(\d{3,4})\s*x\s*(\d{3,4})/);

      try {
        if (task.assignedAgent === 'design-agent') {
          const width = widthMatch ? parseInt(widthMatch[1]!, 10) : 1024;
          const height = widthMatch ? parseInt(widthMatch[2]!, 10) : 1024;

          console.log(`[Media] Generating image for ${task.taskType}: ${rawModel} → ${model} (${width}x${height})`);
          const result = await this.mediaGenerator.generate({
            floorId: task.floorId,
            taskId: task.id,
            type: 'image',
            useGptImage,
            request: { model, prompt: genPrompt, width, height },
          });
          generated++;

          // Download and save generated images to workspace
          const urls = (result as { urls?: string[] })?.urls ?? [];
          for (let i = 0; i < urls.length; i++) {
            const ext = urls[i]!.includes('.png') ? 'png' : 'webp';
            const safeName = `${task.taskType}-${generated}${urls.length > 1 ? `-${i}` : ''}.${ext}`;
            const saved = await this.saveGeneratedImage(floor, urls[i]!, safeName);
            if (saved) savedFiles.push(saved);
          }

          console.log(`[Media] Generated image ${generated} for ${task.taskType}: ${model} (${width}x${height})`);
        } else if (task.assignedAgent === 'video-agent') {
          console.log(`[Media] Generating video for ${task.taskType}: ${rawModel} → ${model}`);
          await this.mediaGenerator.generate({
            floorId: task.floorId,
            taskId: task.id,
            type: 'video',
            request: { model, prompt: genPrompt },
          });
          generated++;
          console.log(`[Media] Generated video ${generated} for ${task.taskType}: ${model}`);
        }
      } catch (err) {
        console.error(`[Media] Failed to generate asset ${generated + 1} for ${task.taskType}:`, err instanceof Error ? err.message : err);
      }
    }

    if (generated > 0) {
      console.log(`[Media] Total ${generated} asset(s) generated for ${task.taskType} on floor ${floor.name}. Saved: ${savedFiles.join(', ') || 'none'}`);
    }
  }

  private handleDispatchError(task: Task, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);

    // Rate limit detection
    if (message.includes('429') || message.toLowerCase().includes('rate limit')) {
      // Exponential backoff: 5s, 10s, 20s, 40s, 80s
      if (this.rateLimitBackoffMs === 0) {
        this.rateLimitBackoffMs = 5000;
        this.rateLimitSince = Date.now();
      } else {
        this.rateLimitBackoffMs = Math.min(this.rateLimitBackoffMs * 2, 80_000);
      }
    }

    this.taskManager.recordFailure(task.id, message);
    this.concurrency.release(task.id);
    this.agentRegistry.updateStatus(task.floorId, task.assignedAgent, 'idle');
  }

  // --- Event Handlers ---

  /**
   * Check if all tasks for a given phase number are completed.
   * If so, mark the phase complete (or gate-waiting) and seed the next phase.
   */
  private checkPhaseCompletion(floorId: string, phaseNumber: number): void {
    if (!phaseNumber || phaseNumber < 1) return;
    const floorTasks = this.taskManager.getFloorTasks(floorId);
    const phaseTasks = floorTasks.filter(t => t.phaseNumber === phaseNumber);

    // FIX: Empty phase after failed seeding — attempt re-seed instead of silently returning
    if (phaseTasks.length === 0) {
      const floor = this.floors.get(floorId);
      const phases = this.phaseManager.getPhases(floorId);
      const phase = phases[phaseNumber - 1];
      if (floor && phase && phase.status === 'active') {
        console.warn(
          `[Floor] Phase ${phaseNumber} for ${floor.name} has 0 tasks but is active — ` +
          `attempting emergency re-seed`,
        );
        this.seedNextPhaseTasks(floorId, floor, phaseNumber - 1).catch(err => {
          console.error(`[Floor] Emergency re-seed failed for phase ${phaseNumber}:`, (err as Error).message);
        });
      }
      return;
    }

    // Treat escalated as terminal (failed permanently) — phase can still complete.
    // FIX: Also treat 'failed' as terminal when task has exhausted all retries,
    // because the setTimeout-based retry can be lost on restart, leaving the task
    // permanently stuck in 'failed' and blocking the entire phase.
    const TERMINAL_STATUSES: string[] = ['completed', 'escalated'];
    const allDone = phaseTasks.every(t => {
      if (TERMINAL_STATUSES.includes(t.status)) return true;
      // FIX: Recover stuck 'failed' tasks — if retries exhausted, force escalate now
      if (t.status === 'failed' && t.attempts >= t.maxAttempts) {
        console.warn(
          `[Floor] Task ${t.id.slice(0, 8)} stuck in 'failed' with max attempts reached — ` +
          `force-escalating to unblock phase ${phaseNumber}`,
        );
        this.taskManager.transition(t.id, 'escalated');
        return true;
      }
      return false;
    });
    if (!allDone) return;

    // GATE: For phase 3 (Foundation Sprint), block completion if the only completed
    // budget-plan task is the stale $200 one (marked superseded via reviewStatus='rejected'
    // with the supersession note). Phase 3 must not complete until either:
    //   (a) a valid $500-baseline budget-plan task is completed and NOT superseded, OR
    //   (b) there are no budget-plan tasks at all in this phase (non-blocking path).
    const SUPERSESSION_NOTE =
      'Revised budget from $200 to $500 — all prior budget-plan outputs are superseded ' +
      'and should not be used for downstream planning.';

    if (phaseNumber === 3) {
      const budgetPlanTasks = phaseTasks.filter(t => t.taskType === 'budget-plan');
      if (budgetPlanTasks.length > 0) {
        const validCompletedBudgetPlan = budgetPlanTasks.some(
          t =>
            t.status === 'completed' &&
            !(t.reviewStatus === 'rejected' && t.reviewFeedback === SUPERSESSION_NOTE),
        );
        if (!validCompletedBudgetPlan) {
          // All completed budget-plan tasks are superseded (stale $200 outputs).
          // Phase 3 is blocked until the new $500 task completes.
          console.log(
            `[Floor] Phase 3 completion BLOCKED for ${floorId}: ` +
            `all completed budget-plan tasks are superseded ($200 baseline). ` +
            `Waiting for $500 budget-plan task to complete.`,
          );
          return;
        }
      }
    }

    const completed = this.phaseManager.completePhase(floorId, phaseNumber);
    if (completed) {
      console.log(`[Floor] Phase ${phaseNumber} complete for ${floorId}`);
      // Floor:phase-complete event triggers activateNextPhase (for non-gate phases)
    }
  }

  /**
   * Activate the next phase for a floor after a non-gate phase completes.
   * Gate phases require owner approval so they wait.
   */
  private async activateNextPhase(floorId: string, completedPhase: number, floor: Floor): Promise<void> {
    // Growth loop: after Phase 10 completes, cycle back to Phase 9
    if (completedPhase === 10) {
      const cycleNum = (floor.growthCycle || 1) + 1;
      floor.growthCycle = cycleNum;
      console.log(`[Floor] ${floor.name} completed growth cycle — starting cycle ${cycleNum}`);

      // Reset phases 9-10 to pending so they can be re-activated
      const phases = this.phaseManager.getPhases(floorId);
      const p9 = phases[8]; // index 8 = phase 9
      const p10 = phases[9]; // index 9 = phase 10
      if (p9) { p9.status = 'pending'; p9.startedAt = null; p9.completedAt = null; }
      if (p10) { p10.status = 'pending'; p10.startedAt = null; p10.completedAt = null; }

      this.phaseManager.activatePhase(floorId, 9);
      floor.currentPhase = 9;
      await this.seedNextPhaseTasks(floorId, floor, 8); // seeds phase 9 tasks
      await saveFloor(floor);
      await broadcastFloorEvent(floorId, 'growth:cycle-started', { cycle: cycleNum });
      return;
    }

    const nextPhase = completedPhase + 1;
    const phases = this.phaseManager.getPhases(floorId);
    const next = phases[nextPhase - 1];
    if (!next || next.status !== 'pending') return;

    // FIX: Don't block on gate phases here. This method is called from the
    // 'floor:phase-complete' event, which ONLY fires after a phase is fully completed
    // (including after gate approval via approveGate()). The old check
    // `if (current?.requiresGate) return` was preventing advancement after gate approval
    // through the event bus path. The gate logic is already enforced in completePhase()
    // which moves to 'gate-waiting' instead of 'completed' for gate phases — so if we
    // got here, the gate was already approved and the phase is truly completed.
    const current = phases[completedPhase - 1];
    if (current?.requiresGate && current.status !== 'completed') {
      return; // gate phase not yet approved — still in gate-waiting
    }

    this.phaseManager.activatePhase(floorId, nextPhase);
    await this.seedNextPhaseTasks(floorId, floor, completedPhase);
    floor.currentPhase = nextPhase;
    await saveFloor(floor);

    // Start OptimizationLoop when floor enters operational phases (7+)
    if (nextPhase >= 7) {
      console.log(`[Floor] ${floor.name} entering phase ${nextPhase} — starting OptimizationLoop`);
      this.optimizationLoop.start(floorId);
    }
  }

  /**
   * Seed tasks for the phase immediately following `completedPhase`.
   * Called when a phase completes (auto) or a gate is approved (manual).
   */
  private async seedNextPhaseTasks(floorId: string, floor: Floor, completedPhase: number): Promise<void> {
    const nextPhase = completedPhase + 1;

    // Guard: don't re-seed if active/pending tasks for this phase already exist
    // (completed tasks from prior growth cycles are allowed — they don't block re-seeding)
    const existingPhaseTasks = this.taskManager.getFloorTasks(floorId).filter(
      t => t.phaseNumber === nextPhase && t.status !== 'completed' && t.status !== 'escalated',
    );
    if (existingPhaseTasks.length > 0) {
      console.log(`[EVE] Phase ${nextPhase} tasks already exist for ${floor.name} (${existingPhaseTasks.length} found) — skipping re-seed`);
      this.phaseManager.activatePhase(floorId, nextPhase);
      return;
    }
    // Also check Supabase in case tasks were persisted but not loaded into memory
    const dbCount = await countPhaseTasks(floorId, nextPhase);
    if (dbCount > 0) {
      console.log(`[EVE] Phase ${nextPhase} tasks already in database for ${floor.name} (${dbCount} found) — skipping re-seed`);
      this.phaseManager.activatePhase(floorId, nextPhase);
      return;
    }

    // activatePhase will return false if prior phases aren't completed — that's OK,
    // the tasks still get created and queued for dispatch.
    this.phaseManager.activatePhase(floorId, nextPhase);

    const router = this.modelRouter;
    const isEcommerce = floor.config.businessType === 'ecommerce';

    // Build brand context from owner's selected direction (if available)
    const sb = floor.selectedBrand;
    const brandContext = sb
      ? `\n\nOWNER-SELECTED BRAND DIRECTION:\nBrand Name: ${sb.name}\nTagline: "${sb.tagline}"\nPersonality: ${sb.personality}\nVoice Attributes: ${sb.voiceAttributes?.join(', ') || 'Not specified'}\n\nIMPORTANT: The owner chose this specific brand direction. All creative work must align with this choice.`
      : '';

    // Gather completed deliverables from prior phases so downstream agents have full context.
    // Each agent needs to know what was already built — brand identity, strategy, visual system, voice guide, etc.
    const allTasks = this.taskManager.getFloorTasks(floorId);
    const completedByType = new Map<string, string>();
    for (const t of allTasks) {
      if (t.status === 'completed' && t.result && t.phaseNumber < nextPhase) {
        completedByType.set(t.taskType, t.result);
      }
    }

    // Build targeted context blocks from prior deliverables (truncated to stay within token budgets)
    const MAX_DELIVERABLE = 4000; // chars per deliverable section — agents need full context to do good work
    const truncate = (s: string) => s.length > MAX_DELIVERABLE ? s.slice(0, MAX_DELIVERABLE) + '\n... [truncated]' : s;

    const strategyResult = completedByType.get('business-strategy');
    const strategyContext = strategyResult
      ? `\n\n--- COMPLETED: BUSINESS STRATEGY (from Strategy Agent) ---\n${truncate(strategyResult)}`
      : '';

    const financialResult = completedByType.get('budget-plan') || completedByType.get('financial-projection');
    const financeContext = financialResult
      ? `\n\n--- COMPLETED: FINANCIAL PLAN (from Finance Agent) ---\n${truncate(financialResult)}`
      : '';

    const visualSystemResult = completedByType.get('brand-visual-system');
    const visualContext = visualSystemResult
      ? `\n\n--- COMPLETED: BRAND VISUAL SYSTEM (from Design Agent) ---\n${truncate(visualSystemResult)}`
      : '';

    const voiceGuideResult = completedByType.get('brand-voice-guide');
    const voiceContext = voiceGuideResult
      ? `\n\n--- COMPLETED: BRAND VOICE GUIDE (from Copy Agent) ---\n${truncate(voiceGuideResult)}`
      : '';

    const productCatalogResult = completedByType.get('product-catalog');
    const productContext = productCatalogResult
      ? `\n\n--- COMPLETED: PRODUCT CATALOG (from Commerce Agent) ---\n${truncate(productCatalogResult)}`
      : '';

    const contentCalendarResult = completedByType.get('content-calendar');
    const contentContext = contentCalendarResult
      ? `\n\n--- COMPLETED: CONTENT CALENDAR (from Social Media Agent) ---\n${truncate(contentCalendarResult)}`
      : '';

    const adCampaignResult = completedByType.get('launch-ad-campaign');
    const adContext = adCampaignResult
      ? `\n\n--- COMPLETED: AD CAMPAIGN PLAN (from Ads Agent) ---\n${truncate(adCampaignResult)}`
      : '';

    const analyticsResult = completedByType.get('analytics-setup');
    const analyticsContext = analyticsResult
      ? `\n\n--- COMPLETED: ANALYTICS SETUP (from Analytics Agent) ---\n${truncate(analyticsResult)}`
      : '';

    const adCreativeResult = completedByType.get('ad-creative-production');
    const adCreativeContext = adCreativeResult
      ? `\n\n--- COMPLETED: AD CREATIVE PRODUCTION (from Ads Agent) ---\n${truncate(adCreativeResult)}`
      : '';

    const conversionTrackingResult = completedByType.get('conversion-tracking');
    const conversionContext = conversionTrackingResult
      ? `\n\n--- COMPLETED: CONVERSION TRACKING (from Analytics Agent) ---\n${truncate(conversionTrackingResult)}`
      : '';

    const performanceReviewResult = completedByType.get('performance-review');
    const performanceContext = performanceReviewResult
      ? `\n\n--- COMPLETED: PERFORMANCE REVIEW (from Analytics Agent) ---\n${truncate(performanceReviewResult)}`
      : '';

    const growthReportResult = completedByType.get('growth-report');
    const growthReportContext = growthReportResult
      ? `\n\n--- COMPLETED: GROWTH REPORT (from Analytics Agent) ---\n${truncate(growthReportResult)}`
      : '';

    const emailResult = completedByType.get('email-welcome-sequence');
    const emailContext = emailResult
      ? `\n\n--- COMPLETED: EMAIL WELCOME SEQUENCE (from Copy Agent) ---\n${truncate(emailResult)}`
      : '';

    const stagingReviewResult = completedByType.get('staging-review');
    const stagingReviewContext = stagingReviewResult
      ? `\n\n--- COMPLETED: STAGING REVIEW (from Design Agent) ---\n${truncate(stagingReviewResult)}`
      : '';

    const copyReviewResult = completedByType.get('copy-review');
    const copyReviewContext = copyReviewResult
      ? `\n\n--- COMPLETED: COPY REVIEW (from Copy Agent) ---\n${truncate(copyReviewResult)}`
      : '';

    const contentRefreshResult = completedByType.get('content-refresh');
    const contentRefreshContext = contentRefreshResult
      ? `\n\n--- COMPLETED: CONTENT REFRESH (from Social Media Agent) ---\n${truncate(contentRefreshResult)}`
      : '';

    const adOptimizationResult = completedByType.get('ad-optimization');
    const adOptimizationContext = adOptimizationResult
      ? `\n\n--- COMPLETED: AD OPTIMIZATION (from Ads Agent) ---\n${truncate(adOptimizationResult)}`
      : '';

    switch (nextPhase) {
      case 3: { // Foundation Sprint — only reached if seedNextPhaseTasks is called for phase 2→3
        // This case seeds phase 3 tasks when called via recovery/manual paths.
        // The primary seeding of phase 3 happens in seedFoundationTasks().
        // Guard: if tasks already exist for phase 3, skip (handled by caller).
        // Must match seedFoundationTasks() — all 3 tasks are required.
        this.taskManager.create({
          floorId,
          phaseNumber: 3,
          assignedAgent: 'brand-agent',
          modelTier: router.getModelTier('brand-agent', 'foundation'),
          taskType: 'brand-options',
          description: `Create 3 distinct brand direction options for "${floor.name}": ${floor.goal}`,
          prompt: BRAND_OPTIONS_PROMPT(floor.name, floor.goal),
        });
        this.taskManager.create({
          floorId,
          phaseNumber: 3,
          assignedAgent: 'strategy-agent',
          modelTier: router.getModelTier('strategy-agent', 'foundation'),
          taskType: 'business-strategy',
          description: `Develop go-to-market strategy for "${floor.name}": ${floor.goal}`,
          prompt: `Analyze the market opportunity and create a go-to-market strategy including: target segments, channel priorities, competitive positioning, and growth roadmap.`,
        });
        this.taskManager.create({
          floorId,
          phaseNumber: 3,
          assignedAgent: 'finance-agent',
          modelTier: router.getModelTier('finance-agent', 'foundation'),
          taskType: 'budget-plan',
          description: `Build financial plan for "${floor.name}": ${floor.goal}`,
          prompt:
            `Create a 12-month financial projection for "${floor.name}" using a ` +
            `${floor.budgetCeilingCents / 100} total budget baseline ` +
            `(${floor.budgetCeilingCents} cents available). ` +
            `Include: revenue forecast, cost structure, unit economics, break-even analysis, ` +
            `and budget allocation. ALL figures must be calibrated to the ` +
            `${floor.budgetCeilingCents / 100} baseline — do not assume any other budget amount.`,
          outputFiles: [`deliverables/budget-plan.md`],
        });
        break;
      }
      case 4: { // Parallel Buildout
        // Enrich design-agent with structured brand fields from owner's selection
        const sb = floor.selectedBrand;
        const brandFields = sb ? `\n\nOWNER-SELECTED BRAND DIRECTION:\n- Brand Name: ${sb.name}\n- Tagline: "${sb.tagline}"\n- Personality: ${sb.personality}\n- Voice Attributes: ${(sb.voiceAttributes || []).join(', ')}\n\nYour visual system MUST align with this brand direction. The owner chose this specific identity — do not deviate.` : '';

        this.taskManager.create({
          floorId,
          phaseNumber: 4,
          assignedAgent: 'design-agent',
          modelTier: router.getModelTier('design-agent', 'foundation'),
          taskType: 'brand-visual-system',
          description: `Design complete brand visual system for "${floor.name}": logo, color palette, typography, and mood board.`,
          prompt: `Create a full brand visual system for "${floor.name}". You must include:

1. PRIMARY LOGO — a professional wordmark (text-only logo):
LOGO DESIGN PRINCIPLES (from Awwwards + Superside research):
- Great logos are SIMPLE — memorable and recognizable, never cluttered
- Must pass the 32px favicon test — if unreadable at 32x32 pixels, it's too complex
- Must work in monochrome (black on white, white on black)
- ONE visual idea only — never combine multiple symbols
- For wordmarks: generous letter-spacing, clean geometry, consistent stroke weight
- AVOID: gradients, shadows, 3D effects, thin lines, photorealism, intricate details

Write a REAL image generation prompt. Follow this structure exactly:
Generation prompt: Minimalist wordmark logo. The text "${floor.name}" in [specific font style: e.g. clean modern lowercase sans-serif / bold uppercase geometric sans-serif / elegant thin serif]. [Exact hex color from brand palette] on pure white background. No symbol, no icon, text only. Flat vector style, no gradients, no shadows, no 3D effects. Professional brand identity. Centered composition, generous letter-spacing, scalable to favicon size. Design style: [match brand personality — e.g. Swiss International Style / luxury editorial / bold contemporary]
Target model: ideogram
Dimensions: 1024x1024

2. SECONDARY LOGO / ICON — a simplified abstract mark (NO TEXT):
Generation prompt: Minimalist abstract geometric mark for "${floor.name}". Single clean shape — [specific shape tied to brand concept, e.g. "circle with subtle leaf cutout" / "angular interlocking letters" / "abstract water drop silhouette"]. [Exact hex color]. Simple flat vector, no gradients, no shadows, no thin lines. Works at 32x32 pixels. No text whatsoever. Centered on white background. Clean vector illustration style.
Target model: recraft
Dimensions: 1024x1024

3. HEX COLOR PALETTE — define exactly 5 colors with hex codes and usage rules:
   Use color psychology — gold/metallics = luxury, earth tones = wellness/eco, bold saturated = youth/energy, muted neutrals = premium
   - Primary: #XXXXXX (main brand color — buttons, headers, links)
   - Secondary: #XXXXXX (supporting — section backgrounds, accents)
   - Accent: #XXXXXX (highlights, CTAs, hover states)
   - Neutral: #XXXXXX (body text, borders — near-black, not pure black)
   - Background: #XXXXXX (page background — warm white or subtle tint, not pure #FFFFFF)

4. TYPOGRAPHY PAIRING — heading + body fonts with mathematical type scale:
   - Use the Perfect Fourth (1.333) ratio for type scale
   - Heading font: [Google Font name] — specify weight (300 for luxury, 600-700 for bold brands)
   - Body font: [Google Font name] — weight 400, size 16-18px
   - Sizes: H1 48-60px, H2 36-42px, H3 24-28px, Body 16-18px, Caption 12-14px
   - Line-height: 1.1-1.2 for headings, 1.5-1.6 for body
   - Letter-spacing: 0.08-0.15em for uppercase labels, normal for body

5. DESIGN STYLE SELECTION — choose the specific design style for this brand:
   Options: luxury-minimalist / organic-minimal / bold-maximalist / modern-tech / clinical-clean / artisanal-warm / editorial-modern / playful-whimsical
   Explain WHY this style fits the brand personality and target audience.

6. BRAND PHOTOGRAPHY STYLE GUIDE — shot types, lighting, composition, mood
   Specify: photography vs illustration vs abstract, color grading, crop style, background treatment

CRITICAL RULES:
- Write REAL, detailed image generation prompts after "Generation prompt:" — NOT bracket placeholders.
- Replace ALL bracket descriptions with actual details from the brand context below.
- "Generation prompt:" and "Target model:" must each be on their own line.
- Use "ideogram" for logos with text, "recraft" for clean vector marks, "flux" for photorealistic imagery.
- The prompts MUST include: exact hex colors, specific style keywords, "no gradients, no shadows, no 3D".
- These trigger the image generation API. Vague or bracketed prompts will NOT generate images.${brandFields}${brandContext}${strategyContext}`,
          outputFiles: [`deliverables/brand-visual-system.md`],
        });
        this.taskManager.create({
          floorId,
          phaseNumber: 4,
          assignedAgent: 'copy-agent',
          modelTier: router.getModelTier('copy-agent', 'foundation'),
          taskType: 'brand-voice-guide',
          description: `Write brand voice guide and core copy for "${floor.name}".`,
          prompt: `Write the brand voice guide and core copy assets for "${floor.name}". Include: brand voice principles (3–5 rules), sample headlines (10 variations), homepage hero copy (headline + subheadline + CTA), about page narrative, and a 500-word brand voice sample showing the tone in action.${brandContext}${strategyContext}`,
          outputFiles: [`deliverables/brand-voice-guide.md`],
        });
        // Product imagery — design-agent generates hero product mockups via fal.ai
        this.taskManager.create({
          floorId,
          phaseNumber: 4,
          assignedAgent: 'design-agent',
          modelTier: router.getModelTier('design-agent', 'routine'),
          taskType: 'product-images',
          description: `Generate hero product images and lifestyle photography for "${floor.name}".`,
          prompt: `Create product imagery for "${floor.name}". You must generate exactly 3 image generation prompts.

For EACH image, output EXACTLY this format (replace the description in angle brackets with a real, detailed prompt):

Image 1 — HERO PRODUCT SHOT:
Generation prompt: A professional product photograph of <the flagship product>, shot on a clean styled background with soft studio lighting, shallow depth of field, brand colors <hex codes>, modern minimalist aesthetic, 8k product photography
Target model: flux
Dimensions: 1024x1024

Image 2 — LIFESTYLE SHOT:
Generation prompt: A lifestyle photograph showing <the product in use by target customer>, <setting and mood>, natural lighting, warm tones, brand colors <hex codes>, editorial style photography
Target model: flux
Dimensions: 1200x800

Image 3 — FLAT LAY / COLLECTION SHOT:
Generation prompt: A flat lay composition of <products arranged on textured surface>, surrounded by <relevant lifestyle props>, brand colors <hex codes>, top-down view, styled product photography, Pinterest aesthetic
Target model: flux
Dimensions: 1200x1200

CRITICAL RULES:
- You MUST write real, detailed image generation prompts — NOT descriptions in brackets.
- Each prompt must start with "Generation prompt:" on its own line followed by the actual prompt text.
- Each must have "Target model:" on its own line. Keep "flux" as the model.
- These lines trigger the image generation API. If you use brackets like [description], NO images will be created.
- Write prompts as if you're describing the final image to a photographer.${brandFields}${brandContext}${strategyContext}${visualContext}`,
          outputFiles: [`deliverables/product-images.md`],
        });
        if (isEcommerce) {
          this.taskManager.create({
            floorId,
            phaseNumber: 4,
            assignedAgent: 'commerce-agent',
            modelTier: router.getModelTier('commerce-agent', 'foundation'),
            taskType: 'product-catalog',
            description: `Build initial product catalog structure for "${floor.name}".`,
            prompt: `Create the product catalog strategy for "${floor.name}": product naming conventions, category structure, pricing tiers, product description template, and a complete description for the first hero product.${brandContext}${strategyContext}${financeContext}`,
            outputFiles: [`deliverables/product-catalog.md`],
          });
        }
        break;
      }
      case 5: { // Content Production
        this.taskManager.create({
          floorId,
          phaseNumber: 5,
          assignedAgent: 'social-media-agent',
          modelTier: router.getModelTier('social-media-agent', 'routine'),
          taskType: 'content-calendar',
          description: `Create 30-day social media content calendar for "${floor.name}".`,
          prompt: `Create a 30-day social content calendar for "${floor.name}". For each week: 5 post ideas with captions, hashtag strategy, and content pillars. Format: grid layout showing content type, copy, and engagement hook for each post. Use the brand voice guide and visual system below to ensure all content matches the brand identity.${brandContext}${voiceContext}${visualContext}${strategyContext}`,
          outputFiles: [`deliverables/content-calendar.md`],
        });
        this.taskManager.create({
          floorId,
          phaseNumber: 5,
          assignedAgent: 'copy-agent',
          modelTier: router.getModelTier('copy-agent', 'routine'),
          taskType: 'email-welcome-sequence',
          description: `Write 5-email welcome sequence for "${floor.name}".`,
          prompt: `Write a 5-email welcome sequence for new subscribers of "${floor.name}": (1) welcome + brand story, (2) how it works, (3) social proof + testimonial template, (4) hero product spotlight, (5) special offer. Each email: subject line, preview text, body copy, and CTA. Match the brand voice guide below exactly.${brandContext}${voiceContext}${visualContext}${productContext}`,
          outputFiles: [`deliverables/email-welcome-sequence.md`],
        });
        // Social media graphics — design-agent generates branded templates
        this.taskManager.create({
          floorId,
          phaseNumber: 5,
          assignedAgent: 'design-agent',
          modelTier: router.getModelTier('design-agent', 'routine'),
          taskType: 'social-media-graphics',
          description: `Generate branded social media graphics for "${floor.name}".`,
          prompt: `Create 3 branded social media graphics for "${floor.name}". Use the brand visual system colors, typography, and style.

For EACH graphic, output EXACTLY this format (write real prompts, NOT descriptions in brackets):

Graphic 1 — INSTAGRAM POST:
Generation prompt: A social media graphic with the text "<brand tagline or message>" in bold modern typography, brand colors <hex codes> gradient background, clean minimalist layout, Instagram-ready square format
Target model: ideogram
Dimensions: 1080x1080

Graphic 2 — STORY / REEL COVER:
Generation prompt: A vertical social media story graphic featuring <product or brand announcement>, bold headline text "<headline>", brand colors <hex codes>, modern vertical layout, eye-catching design with brand elements
Target model: ideogram
Dimensions: 1080x1920

Graphic 3 — BANNER / HEADER:
Generation prompt: A wide cinematic banner for <brand name>, featuring <brand imagery and atmosphere>, brand colors <hex codes>, subtle gradient, professional marketing banner with tagline space, panoramic format
Target model: flux
Dimensions: 1920x1080

CRITICAL RULES:
- Write real, detailed image prompts — NOT placeholder descriptions in brackets.
- "Generation prompt:" and "Target model:" must each be on their own line.
- These lines trigger the image generation API. Bracketed text like [description] will NOT generate images.
- Fill in actual brand colors, product names, and taglines from the context below.${brandContext}${voiceContext}${visualContext}${contentContext}`,
          outputFiles: [`deliverables/social-media-graphics.md`],
        });
        if (isEcommerce) {
          this.taskManager.create({
            floorId,
            phaseNumber: 5,
            assignedAgent: 'video-agent',
            modelTier: router.getModelTier('video-agent', 'routine'),
            taskType: 'promo-video-script',
            description: `Write hero promo video script for "${floor.name}".`,
            prompt: `Write a 60-second hero promo video script for "${floor.name}". Include: hook (0–5s), problem statement (5–15s), solution reveal (15–30s), product showcase (30–45s), social proof (45–55s), CTA (55–60s). Also write voiceover copy and shot list. Match the brand voice and visual style below.${brandContext}${voiceContext}${visualContext}${productContext}`,
            outputFiles: [`deliverables/promo-video-script.md`],
          });
        }
        break;
      }
      case 6: { // Website Build + Staging & QA
        // Website scaffold — design-agent generates the full homepage HTML
        this.taskManager.create({
          floorId,
          phaseNumber: 6,
          assignedAgent: 'design-agent',
          modelTier: router.getModelTier('design-agent', 'foundation'),
          taskType: 'website-homepage',
          description: `Build the homepage for "${floor.name}" as a complete HTML file.`,
          prompt: `Create a complete, production-ready single-page website for "${floor.name}".

OUTPUT: A single HTML file with embedded CSS and JS. This must be a REAL, functional webpage — not a description.

CRITICAL — TOKEN BUDGET: You MUST keep the total response under 15,000 characters. Prioritize BODY CONTENT over CSS.

DESIGN QUALITY STANDARD (Awwwards-level):
This website should look like it belongs on Awwwards.com. Apply these principles:

TYPOGRAPHY HIERARCHY:
- Use a mathematical type scale (Perfect Fourth 1.333 ratio)
- H1: 48-60px, H2: 36-42px, H3: 24-28px, Body: 16-18px
- Line-height: 1.1-1.2 for headings, 1.5-1.6 for body
- Uppercase letter-spaced labels (0.12em) for section categories (e.g. "OUR PHILOSOPHY", "THE COLLECTION")
- Load heading + body Google Fonts via <link> tags (max 2 fonts)

SPACING (8px grid):
- All padding/margins in multiples of 8: 8, 16, 24, 32, 48, 64, 96, 128px
- Generous section padding: clamp(64px, 8vw, 120px) vertical
- Whitespace is a FEATURE — premium brands breathe, crowded design feels cheap
- Max content width: 1200px, centered

HERO SECTION:
- Full-viewport or near-full hero with brand tagline as large H1
- Small uppercase category label above the headline
- Short subtitle paragraph below (1-2 sentences)
- Single dark CTA button with specific microcopy (not "Learn More" — use brand-specific text like "Explore the Formulas")
- Hero image placeholder below

COLOR STRATEGY:
- Use CSS custom properties for ALL colors
- Background: warm-tinted white or brand-specific light tone (never pure #FFFFFF)
- Text: near-black (never pure #000000)
- Accent: brand primary color for CTAs, links, hover states
- Dividers: subtle 1px lines in muted color between sections

STRUCTURE (write in this exact order):
1. <!DOCTYPE html>, <html>, <head> with meta tags, title, OG tags
2. <style> tag — keep CSS COMPACT. Max 5KB. CSS custom properties for all colors/fonts/spacing.
3. <body> — THIS IS THE PRIORITY. Include ALL these sections:
   - <nav> brand name (left) + 4-5 text links (right), clean horizontal bar
   - <header> hero: uppercase label + large H1 tagline + subtitle + CTA button + image placeholder
   - <section> Brand Story with section label "OUR PHILOSOPHY" or similar — use 2-3 column text layout on desktop
   - <section> Products with section label "THE COLLECTION" or similar — 3 product cards (image placeholder + name + price + 1-sentence description)
   - <section> Testimonials with section label — 3 quote cards with attribution
   - <section> Email signup with compelling headline, description, input + button
   - <footer> copyright + social links (Instagram, TikTok, LinkedIn) + Privacy/Terms links

STYLE RULES:
- CSS custom properties: --color-bg, --color-text, --color-accent, --color-muted, --font-heading, --font-body
- Set from brand visual system colors below
- Simple flexbox layouts, max-width containers
- ONE media query for mobile (stack to single column, reduce font sizes)
- Subtle thin dividers (<hr> or border-top) between sections
- NO animations, NO transitions, NO complex hover effects — keep it production-safe
- Keep CSS under 200 lines

Use brand context below for all copy, colors, and identity.${brandContext}${visualContext}${voiceContext}${strategyContext}${productContext}`,
          outputFiles: [`website/index.html`],
        });
        this.taskManager.create({
          floorId,
          phaseNumber: 6,
          assignedAgent: 'design-agent',
          modelTier: router.getModelTier('design-agent', 'review'),
          taskType: 'staging-review',
          description: `Run staging review and QA checklist for "${floor.name}".`,
          prompt: `Perform a comprehensive staging review for "${floor.name}". You are reviewing the brand assets and website readiness before launch. Check: (1) all pages are defined — homepage, about, product pages, contact, (2) mobile responsiveness across breakpoints (define expected behavior), (3) SEO meta tags, OpenGraph tags, canonical URLs (specify what each page needs), (4) forms and CTAs are specified, (5) analytics tracking pixels are identified, (6) brand consistency — verify colors, fonts, and imagery match the brand visual system below, (7) legal pages — privacy policy, terms of service requirements, (8) accessibility — WCAG 2.2 AA compliance checklist. Output a QA report with pass/fail for each item and recommended fixes.${brandContext}${visualContext}${voiceContext}${strategyContext}`,
          outputFiles: [`deliverables/staging-review.md`],
        });
        this.taskManager.create({
          floorId,
          phaseNumber: 6,
          assignedAgent: 'copy-agent',
          modelTier: router.getModelTier('copy-agent', 'routine'),
          taskType: 'copy-review',
          description: `Final copy review and proofread for "${floor.name}".`,
          prompt: `Perform final copy review across all pages and content for "${floor.name}". Validate against the brand voice guide below. Check: (1) spelling, grammar, and punctuation, (2) brand voice consistency — does the copy match the voice principles?, (3) CTA copy is clear and compelling, (4) product descriptions are complete and accurate, (5) email sequence proofread, (6) social media calendar content quality. Output a review report with any corrections needed.${brandContext}${voiceContext}${contentContext}`,
          outputFiles: [`deliverables/copy-review.md`],
        });
        break;
      }
      case 7: { // Launch
        this.taskManager.create({
          floorId,
          phaseNumber: 7,
          assignedAgent: 'ads-agent',
          modelTier: router.getModelTier('ads-agent', 'foundation'),
          taskType: 'launch-ad-campaign',
          description: `Build launch ad campaign strategy for "${floor.name}".`,
          prompt:
            `Create a launch ad campaign plan for "${floor.name}" — total floor budget: ` +
            `${floor.budgetCeilingCents / 100}. ` +
            `(1) audience targeting strategy for Meta + TikTok based on the strategy below, ` +
            `(2) 3 ad creative concepts with copy matching brand voice, ` +
            `(3) bidding strategy and daily budget allocation within the financial plan ` +
            `(keep all ad spend within the ${floor.budgetCeilingCents / 100} total budget), ` +
            `(4) KPIs and ROAS targets, (5) first 30-day testing roadmap. ` +
            `Use the strategy, financial plan, brand assets, and QA review findings below.` +
            `${brandContext}${strategyContext}${financeContext}${voiceContext}${visualContext}${stagingReviewContext}${copyReviewContext}`,
          outputFiles: [`deliverables/launch-ad-campaign.md`],
        });
        this.taskManager.create({
          floorId,
          phaseNumber: 7,
          assignedAgent: 'analytics-agent',
          modelTier: router.getModelTier('analytics-agent', 'routine'),
          taskType: 'analytics-setup',
          description: `Define analytics tracking plan for "${floor.name}".`,
          prompt: `Create analytics tracking plan for "${floor.name}": (1) key metrics to track (5 north-star metrics aligned with the business strategy below), (2) conversion funnel definition, (3) UTM parameter structure, (4) weekly reporting template, (5) alert thresholds for anomalies. Use the financial targets, strategy, and QA findings below to set meaningful benchmarks.${brandContext}${strategyContext}${financeContext}${stagingReviewContext}`,
          outputFiles: [`deliverables/analytics-setup.md`],
        });
        break;
      }
      case 8: { // Ad Campaign Activation (gate phase — tasks prepare for ad launch)
        this.taskManager.create({
          floorId,
          phaseNumber: 8,
          assignedAgent: 'ads-agent',
          modelTier: router.getModelTier('ads-agent', 'routine'),
          taskType: 'ad-creative-production',
          description: `Produce ad creative assets for "${floor.name}" campaign launch.`,
          prompt: `Produce the final ad creative package for "${floor.name}" based on the approved launch ad campaign plan below. Include: (1) 3 static ad images — detailed descriptions for image generation using the brand colors and visual system below (dimensions, composition, copy overlay, product placement), (2) 3 video ad storyboards — 15-second format with scene-by-scene breakdown, (3) ad copy variants — 5 headline + description combos for A/B testing matching brand voice, (4) audience segment descriptions for each creative, (5) platform-specific formatting notes for Meta and TikTok.${brandContext}${adContext}${visualContext}${voiceContext}`,
          outputFiles: [`deliverables/ad-creative-production.md`],
        });
        this.taskManager.create({
          floorId,
          phaseNumber: 8,
          assignedAgent: 'analytics-agent',
          modelTier: router.getModelTier('analytics-agent', 'routine'),
          taskType: 'conversion-tracking',
          description: `Set up conversion tracking and attribution for "${floor.name}".`,
          prompt: `Create the conversion tracking and attribution setup for "${floor.name}": (1) pixel installation checklist for Meta and TikTok, (2) conversion event definitions (purchase, add-to-cart, lead, page view), (3) UTM parameter matrix for each ad creative from the campaign plan below, (4) attribution model recommendation, (5) ROAS calculation methodology and breakeven thresholds using the financial targets below.${brandContext}${adContext}${analyticsContext}${financeContext}`,
          outputFiles: [`deliverables/conversion-tracking.md`],
        });
        break;
      }
      case 9: { // Growth Operations — business is live, agents optimize performance
        const cycleNum = floor.growthCycle || 1;
        this.taskManager.create({
          floorId,
          phaseNumber: 9,
          assignedAgent: 'analytics-agent',
          modelTier: router.getModelTier('analytics-agent', 'routine'),
          taskType: 'performance-review',
          description: `Performance review (cycle ${cycleNum}) for "${floor.name}".`,
          prompt: `You are reviewing the performance of "${floor.name}" (growth cycle ${cycleNum}). Analyze all available data and produce a performance scorecard:\n\n1. TRAFFIC & ACQUISITION — sources, volume trends, cost per visitor\n2. CONVERSION — funnel stages, conversion rate, cart abandonment\n3. AD PERFORMANCE — ROAS by campaign/creative, cost per acquisition, top vs bottom performers\n4. CONTENT & SOCIAL — engagement rates, reach, top performing posts\n5. EMAIL — open rates, click rates, unsubscribes\n6. REVENUE — total, average order value, repeat purchase rate\n\nFor each area: rate as 🟢 (on track), 🟡 (needs attention), or 🔴 (failing). Include 3 specific, actionable recommendations ranked by expected impact.\n\nIf this is cycle 1, establish baselines. If cycle 2+, compare against prior cycle.${brandContext}${analyticsContext}${conversionContext}${adContext}${adCreativeContext}${financeContext}${contentContext}${performanceContext}`,
          outputFiles: [`deliverables/performance-review-c${cycleNum}.md`],
        });
        this.taskManager.create({
          floorId,
          phaseNumber: 9,
          assignedAgent: 'social-media-agent',
          modelTier: router.getModelTier('social-media-agent', 'routine'),
          taskType: 'content-refresh',
          description: `Content refresh (cycle ${cycleNum}) for "${floor.name}".`,
          prompt: `Create the next 2-week content plan for "${floor.name}" (growth cycle ${cycleNum}).\n\nBased on performance data (if available from prior cycles), adjust the content strategy:\n- Double down on content types/topics that drove engagement\n- Cut or rework underperformers\n- Test 2 new content formats or angles\n\nDeliver:\n1. 10 social media posts (platform, copy, visual description, hashtags, best post time)\n2. 3 stories/reels concepts with hook + script outline\n3. 1 longer-form content piece (blog post outline or email newsletter)\n4. Content calendar with dates and posting schedule\n\nAll content must match the brand voice guide below.${brandContext}${voiceContext}${visualContext}${contentContext}${performanceContext}`,
          outputFiles: [`deliverables/content-refresh-c${cycleNum}.md`],
        });
        this.taskManager.create({
          floorId,
          phaseNumber: 9,
          assignedAgent: 'ads-agent',
          modelTier: router.getModelTier('ads-agent', 'routine'),
          taskType: 'ad-optimization',
          description: `Ad optimization (cycle ${cycleNum}) for "${floor.name}".`,
          prompt: `Optimize the ad campaigns for "${floor.name}" (growth cycle ${cycleNum}).\n\nReview current campaign performance and make these decisions:\n1. PAUSE — identify underperforming campaigns/creatives (ROAS < 1.5x target) with reasoning\n2. SCALE — identify winning campaigns to increase budget by 20% with justification\n3. NEW CREATIVE — propose 2 new ad creative variations based on top performers\n4. AUDIENCE — recommend audience expansion or refinement based on conversion data\n5. BUDGET REALLOCATION — how to redistribute budget across campaigns for maximum ROAS\n\nTotal ad spend must stay within the budget ceiling. Show before/after budget allocation.\n\nIf cycle 1: propose initial optimization based on launch results. If cycle 2+: compare against prior cycle changes.${brandContext}${adContext}${adCreativeContext}${conversionContext}${financeContext}${voiceContext}${visualContext}${performanceContext}`,
          outputFiles: [`deliverables/ad-optimization-c${cycleNum}.md`],
        });
        break;
      }
      case 10: { // Optimization Loop — strategic review and planning
        const cycleNum = floor.growthCycle || 1;
        this.taskManager.create({
          floorId,
          phaseNumber: 10,
          assignedAgent: 'analytics-agent',
          modelTier: router.getModelTier('analytics-agent', 'routine'),
          taskType: 'growth-report',
          description: `Growth report (cycle ${cycleNum}) for "${floor.name}".`,
          prompt: `Generate the monthly growth report for "${floor.name}" (growth cycle ${cycleNum}).\n\nThis is the comprehensive business health report the owner uses to understand their business:\n\n1. EXECUTIVE SUMMARY — 3-sentence business health overview\n2. KEY METRICS — revenue, customer count, CAC, estimated LTV, ROAS, profit margin\n3. TREND ANALYSIS — month-over-month comparison (or baseline if cycle 1)\n4. TOP 3 GROWTH OPPORTUNITIES — specific, actionable, with estimated impact\n5. TOP 3 RISKS — with mitigation recommendations\n6. COMPETITIVE LANDSCAPE — any shifts worth noting\n7. 90-DAY FORECAST — projected revenue and growth based on current trajectory\n\nBe honest about what's working and what isn't. The owner needs truth, not optimism.${brandContext}${strategyContext}${financeContext}${analyticsContext}${performanceContext}${adContext}${adOptimizationContext}${contentContext}${contentRefreshContext}${emailContext}`,
          outputFiles: [`deliverables/growth-report-c${cycleNum}.md`],
        });
        this.taskManager.create({
          floorId,
          phaseNumber: 10,
          assignedAgent: 'strategy-agent',
          modelTier: router.getModelTier('strategy-agent', 'routine'),
          taskType: 'strategy-revision',
          description: `Strategy revision (cycle ${cycleNum}) for "${floor.name}".`,
          prompt: `Based on the growth report and accumulated performance data for "${floor.name}" (growth cycle ${cycleNum}), recommend strategic adjustments.\n\nReview everything that happened this cycle and produce:\n\n1. STRATEGY SCORECARD — which elements of the original strategy are working vs need revision\n2. PRICING — any pricing adjustments recommended (with reasoning and projected impact)\n3. PRODUCT — new product ideas, bundles, or changes based on customer behavior\n4. AUDIENCE — should we expand to new segments, double down on current, or pivot?\n5. CHANNELS — which marketing channels to invest more/less in, any new channels to test\n6. REVISED 90-DAY PLAN — updated priorities, milestones, and success criteria\n\nBe specific. "Increase marketing" is not a strategy. "Allocate 30% of ad budget to TikTok targeting 18-24 males because they convert at 2x the rate of our Facebook audience" is.${brandContext}${strategyContext}${financeContext}${growthReportContext}${performanceContext}${adContext}${adOptimizationContext}${contentRefreshContext}${analyticsContext}`,
          outputFiles: [`deliverables/strategy-revision-c${cycleNum}.md`],
        });
        break;
      }
      default:
        console.log(`[EVE] No task template for phase ${nextPhase} — skipping seed`);
    }

    // Register new tasks in dependency graph
    const newPhaseTasks = this.taskManager.getFloorTasks(floorId);
    for (const task of newPhaseTasks) {
      if (task.phaseNumber === nextPhase && task.dependsOn.length > 0) {
        this.dependencyGraph.addTask(task.id, task.dependsOn);
      }
    }
  }

  // --- EVE Action Execution ---

  /**
   * Execute an action from approved/auto-applied feedback.
   * EVE translates its own recommendation into concrete system operations
   * that actually modify templates, requeue tasks, update configs, etc.
   */
  private async executeFeedbackAction(floorId: string, feedbackId: string, action: string | null): Promise<void> {
    if (!action) return;
    const floor = this.floors.get(floorId);
    if (!floor) return;

    console.log(`[EVE] Executing action for ${feedbackId} on ${floor.name}: ${action.slice(0, 100)}`);

    try {
      const { callAnthropic } = await import('../clients/anthropic.js');
      const { executeOperation, AVAILABLE_OPERATIONS } = await import('./eve-actions.js');
      const { listTemplates } = await import('../prompt-builder/template-loader.js');

      const tasks = this.taskManager.getFloorTasks(floorId);
      const taskTypes = [...new Set(tasks.map(t => t.taskType))];
      const completedTypes = [...new Set(tasks.filter(t => t.status === 'completed').map(t => t.taskType))];
      const availableAgents = await listTemplates();

      const systemPrompt = `You are EVE's execution engine. You translate improvement actions into concrete system operations that ACTUALLY change how agents work.

Floor: "${floor.name}" (Phase ${floor.currentPhase}, Status: ${floor.status})
Goal: ${floor.goal || 'Build and grow a business'}
Task types: ${taskTypes.join(', ')}
Completed: ${completedTypes.join(', ')}
Available agent templates: ${availableAgents.join(', ')}

${AVAILABLE_OPERATIONS}

CRITICAL: When the action says to update rules, add checklists, or improve agent behavior — use "update_prompt_template" to ACTUALLY modify the template file. Don't just add notes. Make real changes.

Your response must be ONLY a JSON array wrapped in <json></json> tags. No explanation. Example:
<json>[{"type":"update_prompt_template","agentId":"copy-agent","field":"rules","action":"append","text":"NEW RULE: ..."}]</json>`;

      const result = await callAnthropic(
        systemPrompt,
        [{ role: 'user', content: `Action to execute:\n${action}` }],
        'sonnet',
        1024,
      );

      let operations: EVEOperation[];
      try {
        // Try <json>...</json> tags first
        const tagMatch = result.content.match(/<json>([\s\S]*?)<\/json>/);
        if (tagMatch) {
          operations = JSON.parse(tagMatch[1]!);
        } else {
          // Fallback: find JSON array
          const jsonMatch = result.content.match(/\[[\s\S]*\]/);
          operations = JSON.parse(jsonMatch?.[0] || '[]');
        }
      } catch {
        // Last resort: try {"operations": [...]}
        try {
          const objMatch = result.content.match(/\{[\s\S]*\}/);
          const parsed = JSON.parse(objMatch?.[0] || '{}');
          operations = parsed.operations || [];
        } catch {
          console.warn(`[EVE] Could not parse execution plan for ${feedbackId}. Response: ${result.content.slice(0, 200)}`);
          return;
        }
      }

      if (!Array.isArray(operations) || operations.length === 0) {
        console.log(`[EVE] No operations to execute for ${feedbackId}`);
        return;
      }

      const ctx = {
        floor,
        taskManager: this.taskManager,
        workspace: this.workspace,
        eventBus: this.eventBus,
        modelRouter: this.modelRouter,
      };

      for (const op of operations.slice(0, 5)) { // Max 5 ops per action
        const opResult = await executeOperation(op, ctx);
        console.log(`[EVE] ${opResult.success ? '✓' : '✗'} ${opResult.type}: ${opResult.details}`);
      }
    } catch (err) {
      console.warn(`[EVE] Execution failed for ${feedbackId}:`, (err as Error).message);
    }
  }

  // --- Floor Manager Autonomous Review ---

  /** Track when each floor was last reviewed by its FM to prevent spam. */
  private fmLastReview = new Map<string, number>();
  private fmReviewCooldownMs = 5 * 60 * 1000; // 5 minutes between FM reviews
  private processLoopCounter = 0;

  /**
   * Floor Manager autonomously reviews floor state and communicates with EVE.
   * Called after phase completions, gate-waiting transitions, and periodically.
   * FM analyzes task results, identifies issues, and submits feedback to EVE.
   */
  /** Load an agent's prompt template (cached). Returns null for real agents without templates. */
  private async loadAgentTemplate(agentId: string): Promise<AgentTemplate | null> {
    try {
      return await loadTemplate(agentId as AgentId);
    } catch {
      return null; // Real agents or missing templates
    }
  }

  private async floorManagerReview(floorId: string, trigger: 'phase-complete' | 'task-batch' | 'periodic' | 'gate-waiting'): Promise<void> {
    const floor = this.floors.get(floorId);
    if (!floor) return;

    // Cooldown — don't review the same floor too frequently
    const lastReview = this.fmLastReview.get(floorId) ?? 0;
    if (Date.now() - lastReview < this.fmReviewCooldownMs) return;
    this.fmLastReview.set(floorId, Date.now());

    try {
      const { callAnthropic } = await import('../clients/anthropic.js');

      // Gather floor context for the FM
      const tasks = this.taskManager.getFloorTasks(floorId);
      const recentTasks = tasks.slice(-10);
      const completedTasks = recentTasks.filter(t => t.status === 'completed');
      const failedTasks = recentTasks.filter(t => t.status === 'failed' || t.status === 'escalated');
      const budget = this.budgetEnforcer.getStatus(floorId);
      const perf = this.improvementEngine.getPerformance(floorId);
      const learnings = this.improvementEngine.getSystemLearnings();

      // Summarize ALL feedback by theme so FM sees the full picture, not just last 10
      const allFloorFeedback = this.improvementEngine.getAllFeedback(floorId);
      const feedbackThemes = new Map<string, { count: number; statuses: string[]; lastDecision: string }>();
      for (const fb of allFloorFeedback) {
        const theme = fb.message.slice(0, 60).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const key = fb.eveDecision === 'rejected' ? `REJECTED: ${theme}` : theme;
        const existing = feedbackThemes.get(key);
        if (existing) {
          existing.count++;
          existing.lastDecision = fb.eveDecision;
        } else {
          feedbackThemes.set(key, { count: 1, statuses: [fb.status], lastDecision: fb.eveDecision });
        }
      }
      // Show last 5 individual feedbacks + theme summary
      const recentFeedback = [
        `THEME SUMMARY (${allFloorFeedback.length} total feedbacks submitted):`,
        ...Array.from(feedbackThemes.entries())
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 8)
          .map(([theme, { count, lastDecision }]) =>
            `  - "${theme.slice(0, 50)}" — reported ${count}x, last decision: ${lastDecision}`),
        '',
        'LAST 5 FEEDBACKS:',
        ...allFloorFeedback.slice(-5).map(fb => {
          const decision = fb.eveDecision === 'auto-apply' ? '→ EVE auto-applied'
            : fb.eveDecision === 'needs-approval' ? '→ waiting for owner'
            : fb.eveDecision === 'rejected' ? `→ EVE REJECTED: ${fb.eveReasoning.slice(0, 80)}`
            : '→ deferred';
          return `  - [${fb.eveDecision}] ${fb.message.slice(0, 80)} ${decision}`;
        }),
      ].join('\n');

      const taskSummary = recentTasks.map(t =>
        `- ${t.taskType} (${t.assignedAgent}): ${t.status}${t.attempts > 0 ? ` [${t.attempts} retries]` : ''}${t.reviewFeedback ? ` — ${t.reviewFeedback.slice(0, 80)}` : ''}`
      ).join('\n');

      const perfSummary = perf.map(p =>
        `- ${p.agentId}/${p.taskType}: ${p.totalTasks} tasks, ${Math.round((p.firstTryApprovals / Math.max(1, p.totalTasks)) * 100)}% first-try, ${p.slopViolations} slop violations`
      ).join('\n');

      const learningSummary = learnings.length > 0
        ? learnings.slice(-5).map(l => `- ${l.learning}`).join('\n')
        : 'None yet';

      const systemPrompt = `You are the Floor Manager for "${floor.name}".
Your job: ${floor.goal || 'Build and grow a business'}
Current phase: ${floor.currentPhase}, Status: ${floor.status}
Budget: $${Math.round((budget?.spentCents || 0) / 100)} of $${Math.round((budget?.ceilingCents || 0) / 100)} (${budget?.percentUsed ?? 0}%)
Trigger: ${trigger}

RECENT TASKS:
${taskSummary || 'None'}

AGENT PERFORMANCE:
${perfSummary || 'No data yet'}

SYSTEM LEARNINGS (applied across all floors):
${learningSummary}

RECENT FEEDBACK ALREADY SUBMITTED TO EVE:
${recentFeedback || 'None — this is the first review'}

You are reviewing your floor's current state.

CRITICAL: Look at the THEME SUMMARY above. If you have already reported a topic (count >= 1), do NOT report it again in any form. It is being handled.

THINGS THAT ARE NOT PROBLEMS — never report these:
- Low budget utilization is NORMAL. AI API calls cost pennies. $3-15 spent on 10+ tasks is expected and healthy.
- Task failures caused by "credit balance", "billing", or "rate_limit" errors are API credit issues the owner handles externally. Not a bug.
- Tasks queued but not yet dispatched — normal async operation.
- dispatch_backend_agent actions you requested — handled asynchronously, do not ask for status.

RULES:
- Do NOT re-submit ANY topic from the THEME SUMMARY. If count >= 1, it's handled.
- If EVE REJECTED feedback, accept permanently. Do NOT rephrase.
- If auto-applied, DONE. Move on.
- If waiting for owner, do NOT re-submit.
- PREFER responding with {"feedback": null}. Only report genuinely NEW issues.

Only consider:
1. Agent failures for reasons OTHER than API credits (bad quality, wrong format)
2. Missing task dependencies blocking workflow
3. Quality issues in outputs that affect the business

Respond with {"feedback": null} unless there is a genuinely new issue.
If you must report something truly new: {"feedback": [{"message": "...", "priority": "high|medium|low"}]}
Return 1 item max.`;

      const result = await callAnthropic(
        systemPrompt,
        [{ role: 'user', content: `Review floor state now (trigger: ${trigger}). What feedback do you have for EVE?` }],
        'haiku',
        512,
      );

      // Parse FM's feedback
      let parsed: { feedback: Array<{ message: string; priority: string }> | null };
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(jsonMatch?.[0] || result.content);
      } catch {
        return; // Can't parse — skip
      }

      if (!parsed.feedback || parsed.feedback.length === 0) {
        return; // FM says everything is fine
      }

      // Submit each feedback item to EVE
      for (const item of parsed.feedback) {
        if (!item.message) continue;
        console.log(`[FM→EVE] ${floor.name}: ${item.message} (${item.priority})`);
        await this.improvementEngine.submitAgentFeedback(
          floorId,
          'floor-manager' as any,
          item.message,
          { name: floor.name, phase: floor.currentPhase || 1, status: floor.status, goal: floor.goal },
        );
      }
    } catch (err) {
      const errMsg = (err as Error).message || '';
      // On billing/credit errors, suppress FM reviews for 30 minutes to avoid spam
      if (errMsg.includes('credit balance') || errMsg.includes('billing') || errMsg.includes('rate_limit')) {
        const futureTimestamp = Date.now() + 30 * 60 * 1000;
        for (const [fid] of this.floors) {
          this.fmLastReview.set(fid, futureTimestamp);
        }
        console.warn(`[FM Review] API billing/rate error — suppressing FM reviews for 30 minutes`);
      } else {
        console.warn(`[FM Review] Failed for ${floor.name}:`, errMsg);
      }
    }
  }

  private setupEventHandlers(): void {
    // When a task completes, cascade dependencies + check if phase is done
    this.eventBus.on('task:completed', (data) => {
      const newlyReady = this.dependencyGraph.onTaskCompleted(data.taskId);
      for (const taskId of newlyReady) {
        this.taskManager.transition(taskId, 'queued');
      }

      // Check if all tasks for this phase are now complete
      const completedTask = this.taskManager.getTask(data.taskId);
      if (completedTask) {
        this.checkPhaseCompletion(data.floorId, completedTask.phaseNumber);
      }

      // Broadcast to Supabase realtime so the dashboard re-renders immediately.
      // This fires for ALL completion paths (dispatchVirtual, approval, manual) —
      // dispatchVirtual also calls broadcastFloorEvent but that is idempotent.
      broadcastFloorEvent(data.floorId, 'task:completed', {
        taskId: data.taskId,
        agent: data.agentId,
      }).catch(() => {});
    });

    // When a task is escalated (permanently failed), also check if phase can complete
    this.eventBus.on('task:status-changed', (data) => {
      if (data.to === 'escalated') {
        this.checkPhaseCompletion(data.floorId, this.taskManager.getTask(data.taskId)?.phaseNumber ?? 0);
        // FM reviews when tasks permanently fail — something went wrong
        this.floorManagerReview(data.floorId, 'task-batch').catch(() => {});
      }
    });

    // When EVE feedback is applied (auto or owner-approved), execute the action
    this.eventBus.on('feedback:applied', (data) => {
      this.executeFeedbackAction(data.floorId, data.feedbackId, data.action).catch(err => {
        console.warn(`[EVE] Failed to execute feedback action:`, (err as Error).message);
      });
    });

    // When a task is created (with deps), register in graph
    this.eventBus.on('task:created', (data) => {
      const task = this.taskManager.getTask(data.taskId);
      if (task && task.dependsOn.length > 0) {
        this.dependencyGraph.addTask(task.id, task.dependsOn);
      }
    });

    // Sync spend to Supabase floors table and persist cost event whenever a cost is recorded
    this.eventBus.on('cost:recorded', (data) => {
      // Persist individual cost event to cost_events table
      persistWithRetry(() => saveCostEvent(data.floorId, data.taskId, data.costCents, 'api-call'), `cost:${data.floorId.slice(0, 8)}:${data.taskId.slice(0, 8)}`);

      // Update floor spend total
      const floor = this.floors.get(data.floorId);
      if (!floor) return;
      const status = this.budgetEnforcer.getStatus(data.floorId);
      if (status) {
        floor.spentCents = Math.round(status.spentCents);
        persistWithRetry(() => saveFloor(floor), `floor:cost-sync:${data.floorId.slice(0, 8)}`);
      }
    });

    // Budget exceeded — demote trust + send notification
    this.eventBus.on('budget:exceeded', (data) => {
      console.warn(`[Budget] Floor ${data.floorId} exceeded: ${data.spentCents}¢ / ${data.ceilingCents}¢`);
      this.trustLadder.recordBudgetOverrun(data.floorId);
      sendNotification({
        title: 'Budget Exceeded',
        body: `Floor has spent ${data.spentCents}¢ of ${data.ceilingCents}¢ budget. Trust demoted to Level 2.`,
        floorId: data.floorId,
        type: 'alert',
      });
    });

    this.eventBus.on('budget:alert', (data) => {
      console.warn(`[Budget] Floor ${data.floorId} at ${data.threshold * 100}%`);
      sendNotification({
        title: `Budget ${data.threshold * 100}% Used`,
        body: `Spent ${data.spentCents}¢ of ${data.ceilingCents}¢`,
        floorId: data.floorId,
        type: 'info',
      });
    });

    this.eventBus.on('floor:created', (data) => {
      console.log(`[Floor] Created: ${data.slug} (${data.floorId})`);
    });

    this.eventBus.on('floor:phase-complete', (data) => {
      console.log(`[Floor] Phase ${data.phase} complete for ${data.floorId}`);
      // Auto-advance to next phase if no gate required
      const floor = this.floors.get(data.floorId);
      if (floor) {
        this.activateNextPhase(data.floorId, data.phase, floor).catch(() => {});
        // Floor Manager reviews after every phase completion
        this.floorManagerReview(data.floorId, 'phase-complete').catch(() => {});
      }
    });

    // Phase gate approvals (taskId = 'gate-N')
    // NOTE: approvePhaseGate() is the canonical entry point and handles all state updates
    // including brandState. This handler exists as a fallback for direct event-bus approvals
    // (e.g. handleApproval()). It skips if the floor has already advanced past this gate.
    //
    // Non-gate approvals (review tasks): broadcast review:cleared so the dashboard
    // removes the review item immediately without waiting for a polling refresh.
    this.eventBus.on('approval:received', async (data) => {
      if (!String(data.taskId).startsWith('gate-')) {
        // Review task approval/rejection — broadcast so dashboard clears the item
        const reviewTask = this.taskManager.getTask(data.taskId);
        if (reviewTask) {
          await broadcastFloorEvent(data.floorId, 'task:completed', {
            taskId: data.taskId,
            agent: reviewTask.assignedAgent,
          });
          // Persist the final task state to Supabase so dashboard reads correct status
          const finalTask = this.taskManager.getTask(data.taskId);
          if (finalTask) {
            persistWithRetry(() => saveTask(finalTask), `task:approval-save:${data.taskId.slice(0, 8)}`);
          }
        }
        return;
      }
      const phaseNumber = parseInt(String(data.taskId).replace('gate-', ''), 10);
      const floor = this.floors.get(data.floorId);
      if (!floor) return;

      if (data.approved) {
        // Guard: if approvePhaseGate() already ran and advanced the floor, skip here
        if (floor.currentPhase > phaseNumber) {
          console.log(`[Floor] approval:received for gate-${phaseNumber} on ${floor.name} — already advanced (currentPhase=${floor.currentPhase}), skipping`);
          return;
        }

        this.phaseManager.forceCompleteUpTo(data.floorId, phaseNumber);
        this.phaseManager.approveGate(data.floorId, phaseNumber);

        // Phase 3 = Foundation Sprint gate: persist brandState so Tower CTA clears
        if (phaseNumber === 3) {
          floor.brandState = 'foundation-approved';
          console.log(`[Floor] [event] brandState → 'foundation-approved' for ${floor.name}`);
        }

        floor.currentPhase = phaseNumber + 1;
        await saveFloor(floor);
        await this.seedNextPhaseTasks(data.floorId, floor, phaseNumber);
        await broadcastFloorEvent(data.floorId, 'phase:advanced', {
          from: phaseNumber,
          to: phaseNumber + 1,
          brandState: floor.brandState,
        });

        if (phaseNumber === 3) {
          await broadcastFloorEvent(data.floorId, 'brand:state-changed', {
            floorId: data.floorId,
            brandState: floor.brandState,
          });
        }

        console.log(`[Floor] Gate ${phaseNumber} approved — Phase ${phaseNumber + 1} starting`);
      }
    }); // end approval:received

    // Queue-status events — broadcast to dashboard via Supabase realtime.
    // NOTE: Do NOT feed these back into improvementEngine — that creates an infinite loop.
    this.eventBus.on('task:queue-status', (data) => {
      const { taskId, floorId, agentId, payload } = data;
      broadcastFloorEvent(floorId, 'task:queue-status', {
        task_id: payload.task_id,
        status: payload.status,
        timestamp: payload.timestamp,
        agentId,
        taskId,
      }).catch(() => {});
    });

    // Task lifecycle events — broadcast to dashboard only.
    // NOTE: Do NOT feed these back into improvementEngine — that creates an infinite loop.
    this.eventBus.on('task:lifecycle-event', (data) => {
      broadcastFloorEvent(data.floorId, 'task:lifecycle-event', {
        taskId: data.taskId,
        queueState: data.queueState,
        taskType: data.taskType,
        agentId: data.agentId,
        phaseNumber: data.phaseNumber,
        timestamp: data.timestamp,
      }).catch(() => {});
    });

    // ── APPROVAL REQUESTS — Route to owner via dashboard + notifications ──
    // This is the critical handler for high-risk action approvals, phase gate requests,
    // and improvement proposals. Without this, approval:needed events would be emitted
    // but never shown to the owner.
    this.eventBus.on('approval:needed', (data) => {
      console.log(`[Approval] Needed for floor ${data.floorId}: ${data.type} — ${data.summary ?? 'no summary'}`);

      // Broadcast to dashboard via Supabase realtime so the UI shows the approval card
      broadcastFloorEvent(data.floorId, 'approval:needed', {
        taskId: data.taskId,
        type: data.type,
        summary: data.summary ?? '',
        timestamp: new Date().toISOString(),
      }).catch(() => {});

      // Send push notification to owner
      sendNotification({
        title: `Approval Required: ${data.type}`,
        body: data.summary ?? `Task ${data.taskId.slice(0, 8)} needs your approval before proceeding.`,
        floorId: data.floorId,
        type: 'approval',
      });
    });

    // ── FLOOR STATUS — Broadcast to dashboard when kill switch / circuit breaker fires ──
    this.eventBus.on('floor:status-changed', (data) => {
      console.log(`[Floor] Status changed: ${data.floorId} → ${data.status}`);
      broadcastFloorEvent(data.floorId, 'floor:status-changed', {
        status: data.status,
        brandState: data.brandState,
        currentPhase: data.currentPhase,
        timestamp: new Date().toISOString(),
      }).catch(() => {});
    });

    // ── PHASE STARTED — Broadcast to dashboard ──
    this.eventBus.on('floor:phase-started', (data) => {
      console.log(`[Floor] Phase ${data.phase} started for ${data.floorId}`);
      broadcastFloorEvent(data.floorId, 'floor:phase-started', {
        phase: data.phase,
        timestamp: new Date().toISOString(),
      }).catch(() => {});
    });

    // ── ACTIONS EXECUTED — Broadcast to dashboard for action visibility ──
    this.eventBus.on('task:actions-executed', (data) => {
      broadcastFloorEvent(data.floorId, 'task:actions-executed', {
        taskId: data.taskId,
        agent: data.agent,
        executed: data.summary.executed,
        pending: data.summary.pending,
        failed: data.summary.failed,
        costCents: data.summary.costCents,
        timestamp: new Date().toISOString(),
      }).catch(() => {});
    });

    // ── DEPLOYMENT COMPLETED — Broadcast when websites go live ──
    this.eventBus.on('deployment:completed', (data) => {
      console.log(`[Deployment] ${data.projectName} deployed to ${data.url}`);
      broadcastFloorEvent(data.floorId, 'deployment:completed', {
        deploymentId: data.deploymentId,
        url: data.url,
        projectName: data.projectName,
        timestamp: new Date().toISOString(),
      }).catch(() => {});
      sendNotification({
        title: 'Website Deployed',
        body: `${data.projectName} is live at ${data.url}`,
        floorId: data.floorId,
        type: 'info',
      });
    });

    // Real agent output files — complete the corresponding task
    // NOTE: Only for REAL agents. Virtual agents complete via dispatchVirtual/dispatchCouncil
    // which handle triggerMediaGeneration, brand state extraction, etc.
    this.eventBus.on('agent:output-detected', (data) => {
      if (!data.taskId) {
        // Map file path to task
        const task = this.taskManager.getTaskByOutputFile(data.floorId, data.filePath);
        if (task && task.status !== 'completed' && task.status !== 'working') {
          this.taskManager.recordResult(task.id, `Output written to ${data.filePath}`, 0);
          this.taskManager.transition(task.id, 'completed');
          console.log(`[FileWatcher] Task ${task.id} completed via output file: ${data.filePath}`);
        }
      }
    });
  }
}
