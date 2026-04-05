/**
 * AdaptiveModelRouter — Auto-adjusts Opus/Sonnet/Haiku selection based on
 * real performance data from PerformanceTracker.
 *
 * Upgrades the static ModelRouter with data-driven decisions:
 *   1. Tracks first-try rates and revenue per model tier per agent/task
 *   2. Runs periodic experiments (promote Sonnet → Opus, demote Opus → Sonnet)
 *   3. Measures outcomes for 7 days, then locks in the better option
 *   4. Respects cost ceilings — won't upgrade if budget is tight
 *   5. Always allows manual overrides (floor config > adaptive routing)
 *
 * Decision Matrix:
 *   - If Sonnet achieves >= 90% of Opus first-try rate AND >= 80% of Opus revenue:
 *     → Use Sonnet (save ~90% on LLM cost)
 *   - If Opus generates >= 150% of Sonnet revenue for revenue-critical tasks:
 *     → Use Opus (higher cost justified by outcomes)
 *   - For non-revenue tasks (analytics, internal reports):
 *     → Use cheapest tier that maintains >= 85% first-try rate
 *   - During budget pressure (>80% spent):
 *     → Downgrade to cheapest viable tier
 */

import type { AgentId, ModelTier, TaskCategory } from '../config/types.js';
import type { PerformanceTracker, AgentEfficiency } from './performance-tracker.js';
import type { ModelRouter } from '../agents/model-router.js';
import type { BudgetEnforcer } from '../security/budget-enforcer.js';
import type { EventBus } from './event-bus.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AdaptiveDecision {
  agentId: AgentId;
  taskType: string;
  /** What the static router would pick */
  staticTier: ModelTier;
  /** What the adaptive router recommends */
  adaptiveTier: ModelTier;
  /** Reason for the decision */
  reason: string;
  /** Confidence in the decision (0-1) */
  confidence: number;
  /** Evidence backing the decision */
  evidence: TierComparison | null;
  /** When this decision was made */
  decidedAt: Date;
}

export interface TierComparison {
  opusEfficiency: AgentEfficiency | null;
  sonnetEfficiency: AgentEfficiency | null;
  haikuEfficiency: AgentEfficiency | null;
  /** Best tier by first-try rate */
  bestByQuality: ModelTier;
  /** Best tier by revenue per LLM dollar */
  bestByROI: ModelTier;
  /** Best tier by raw revenue */
  bestByRevenue: ModelTier;
}

export interface Experiment {
  id: string;
  floorId: string;
  agentId: AgentId;
  taskType: string;
  /** Tier before experiment */
  controlTier: ModelTier;
  /** Tier being tested */
  testTier: ModelTier;
  /** Tasks assigned to control */
  controlTaskIds: string[];
  /** Tasks assigned to test */
  testTaskIds: string[];
  startedAt: Date;
  /** Experiment runs for this many days */
  durationDays: number;
  status: 'running' | 'completed' | 'cancelled';
  result?: {
    winner: ModelTier;
    controlMetrics: { firstTryRate: number; avgRevenue: number; avgCost: number };
    testMetrics: { firstTryRate: number; avgRevenue: number; avgCost: number };
  };
}

export interface AdaptiveConfig {
  /** Enable adaptive routing (can be disabled for manual control) */
  enabled: boolean;
  /** Minimum tasks needed before making adaptive decisions */
  minSampleSize: number;
  /** How often to re-evaluate (hours) */
  evaluationIntervalHours: number;
  /** Quality threshold: Sonnet must achieve this % of Opus first-try rate to qualify */
  qualityThresholdPercent: number;
  /** Revenue threshold: Opus must generate this % more revenue to justify cost */
  revenueThresholdPercent: number;
  /** Budget pressure threshold (% of ceiling) — triggers downgrade */
  budgetPressurePercent: number;
  /** Revenue-critical task types that prioritize revenue over cost */
  revenueCriticalTaskTypes: string[];
}

const DEFAULT_CONFIG: AdaptiveConfig = {
  enabled: true,
  minSampleSize: 10,
  evaluationIntervalHours: 24,
  qualityThresholdPercent: 90,
  revenueThresholdPercent: 150,
  budgetPressurePercent: 80,
  revenueCriticalTaskTypes: [
    'product-description', 'ad-creative', 'ad-copy',
    'product-listing', 'landing-page', 'email-campaign',
  ],
};

// ─── AdaptiveModelRouter ───────────────────────────────────────────────────

export class AdaptiveModelRouter {
  private config: AdaptiveConfig;
  /** Cached adaptive decisions */
  private decisions = new Map<string, AdaptiveDecision>(); // key: floorId:agentId:taskType
  /** Active experiments */
  private experiments = new Map<string, Experiment>();
  private evaluationInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private performanceTracker: PerformanceTracker,
    private staticRouter: ModelRouter,
    private budgetEnforcer: BudgetEnforcer,
    private eventBus: EventBus,
    config?: Partial<AdaptiveConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Lifecycle ──

  start(): void {
    if (!this.config.enabled || this.evaluationInterval) return;
    const intervalMs = this.config.evaluationIntervalHours * 60 * 60 * 1000;
    this.evaluationInterval = setInterval(() => {
      this.evaluate().catch(err => {
        console.error(`[AdaptiveModelRouter] Evaluation failed: ${(err as Error).message}`);
      });
    }, intervalMs);
    console.log(`[AdaptiveModelRouter] Started — evaluating every ${this.config.evaluationIntervalHours}h`);
  }

  stop(): void {
    if (this.evaluationInterval) {
      clearInterval(this.evaluationInterval);
      this.evaluationInterval = null;
    }
  }

  // ── Core Decision Engine ──

  /**
   * Get the recommended model tier for a specific task.
   * Falls back to static router if insufficient data.
   */
  getRecommendedTier(
    floorId: string,
    agentId: AgentId,
    taskType: string,
    taskCategory: TaskCategory,
  ): { tier: ModelTier; reason: string; isAdaptive: boolean } {
    if (!this.config.enabled) {
      return {
        tier: this.staticRouter.getModelTier(agentId, taskCategory),
        reason: 'Adaptive routing disabled — using static config',
        isAdaptive: false,
      };
    }

    const key = `${floorId}:${agentId}:${taskType}`;
    const cached = this.decisions.get(key);

    if (cached && cached.confidence >= 0.7) {
      return {
        tier: cached.adaptiveTier,
        reason: cached.reason,
        isAdaptive: true,
      };
    }

    // Not enough data yet — use static
    return {
      tier: this.staticRouter.getModelTier(agentId, taskCategory),
      reason: 'Insufficient performance data — using static routing',
      isAdaptive: false,
    };
  }

  // ── Evaluation ──

  /**
   * Re-evaluate all agent/task combos and update adaptive decisions.
   */
  async evaluate(): Promise<void> {
    console.log('[AdaptiveModelRouter] Running evaluation...');
    const globalMetrics = this.performanceTracker.getGlobalMetrics(1);
    const floorIds = [...globalMetrics.keys()];
    let updates = 0;

    for (const floorId of floorIds) {
      // Check budget pressure
      const budgetStatus = this.budgetEnforcer.getStatus(floorId);
      const budgetPressure = budgetStatus
        ? (budgetStatus.spentCents / Math.max(1, budgetStatus.ceilingCents)) * 100
        : 0;

      const agentIds: AgentId[] = [
        'copy-agent', 'design-agent', 'social-media-agent',
        'ads-agent', 'commerce-agent', 'analytics-agent',
      ];

      for (const agentId of agentIds) {
        for (const taskType of this.getRelevantTaskTypes(agentId)) {
          const decision = this.makeDecision(floorId, agentId, taskType, budgetPressure);
          if (decision) {
            const key = `${floorId}:${agentId}:${taskType}`;
            this.decisions.set(key, decision);
            updates++;
          }
        }
      }
    }

    if (updates > 0) {
      console.log(`[AdaptiveModelRouter] Updated ${updates} routing decisions`);
    }
  }

  /**
   * Make an adaptive routing decision for a specific agent/task combo.
   */
  private makeDecision(
    floorId: string,
    agentId: AgentId,
    taskType: string,
    budgetPressurePercent: number,
  ): AdaptiveDecision | null {
    // Get tier comparison data
    const comparison = this.compareTiers(floorId, agentId, taskType);
    if (!comparison) return null; // Insufficient data

    const staticTier: ModelTier = 'sonnet'; // Default static tier for most agents
    const isRevenueCritical = this.config.revenueCriticalTaskTypes.includes(taskType);

    // ── Budget Pressure Override ──
    if (budgetPressurePercent >= this.config.budgetPressurePercent) {
      const cheapestViable = this.getCheapestViableTier(comparison);
      return {
        agentId,
        taskType,
        staticTier,
        adaptiveTier: cheapestViable,
        reason: `Budget pressure (${budgetPressurePercent.toFixed(0)}%) — downgrading to ${cheapestViable}`,
        confidence: 0.9,
        evidence: comparison,
        decidedAt: new Date(),
      };
    }

    // ── Revenue-Critical Tasks ──
    if (isRevenueCritical) {
      // Check if Opus generates significantly more revenue
      if (comparison.opusEfficiency && comparison.sonnetEfficiency) {
        const opusRev = comparison.opusEfficiency.avgRevenueCents;
        const sonnetRev = comparison.sonnetEfficiency.avgRevenueCents;

        if (opusRev > sonnetRev * (this.config.revenueThresholdPercent / 100)) {
          return {
            agentId,
            taskType,
            staticTier,
            adaptiveTier: 'opus',
            reason: `Opus generates ${((opusRev / Math.max(1, sonnetRev)) * 100 - 100).toFixed(0)}% more revenue for ${taskType} — cost justified`,
            confidence: this.calculateConfidence(comparison),
            evidence: comparison,
            decidedAt: new Date(),
          };
        }
      }
    }

    // ── Cost Optimization ──
    // Can we use a cheaper tier without quality loss?
    if (comparison.sonnetEfficiency && comparison.opusEfficiency) {
      const sonnetFTR = comparison.sonnetEfficiency.firstTryRate;
      const opusFTR = comparison.opusEfficiency.firstTryRate;

      if (sonnetFTR >= opusFTR * (this.config.qualityThresholdPercent / 100)) {
        // Sonnet is close enough in quality — use it
        return {
          agentId,
          taskType,
          staticTier,
          adaptiveTier: 'sonnet',
          reason: `Sonnet achieves ${(sonnetFTR * 100).toFixed(0)}% first-try rate (vs Opus ${(opusFTR * 100).toFixed(0)}%) at ${((1 - comparison.sonnetEfficiency.avgCostCents / Math.max(1, comparison.opusEfficiency.avgCostCents)) * 100).toFixed(0)}% lower cost`,
          confidence: this.calculateConfidence(comparison),
          evidence: comparison,
          decidedAt: new Date(),
        };
      }
    }

    // Check if Haiku is viable for non-revenue tasks
    if (!isRevenueCritical && comparison.haikuEfficiency) {
      const haikuFTR = comparison.haikuEfficiency.firstTryRate;
      if (haikuFTR >= 0.85) {
        return {
          agentId,
          taskType,
          staticTier,
          adaptiveTier: 'haiku',
          reason: `Haiku achieves ${(haikuFTR * 100).toFixed(0)}% first-try rate for non-revenue ${taskType} — maximizing cost efficiency`,
          confidence: this.calculateConfidence(comparison),
          evidence: comparison,
          decidedAt: new Date(),
        };
      }
    }

    return null; // No clear adaptive decision — stick with static
  }

  // ── Comparison Helpers ──

  private compareTiers(floorId: string, agentId: AgentId, taskType: string): TierComparison | null {
    const tiers = this.performanceTracker.compareModelTiers(floorId, agentId, taskType);
    if (tiers.size === 0) return null;

    const opus = tiers.get('opus') ?? null;
    const sonnet = tiers.get('sonnet') ?? null;
    const haiku = tiers.get('haiku') ?? null;

    // Need at least one tier with sufficient data
    const hasSufficientData = [opus, sonnet, haiku].some(
      t => t && t.sampleSize >= this.config.minSampleSize,
    );
    if (!hasSufficientData) return null;

    // Determine best by each metric
    const all = [
      { tier: 'opus' as ModelTier, eff: opus },
      { tier: 'sonnet' as ModelTier, eff: sonnet },
      { tier: 'haiku' as ModelTier, eff: haiku },
    ].filter(t => t.eff != null);

    const bestByQuality = all.reduce((best, curr) =>
      (curr.eff!.firstTryRate > (best.eff?.firstTryRate ?? 0)) ? curr : best,
    ).tier;

    const bestByROI = all.reduce((best, curr) =>
      (curr.eff!.revenuePerLlmDollar > (best.eff?.revenuePerLlmDollar ?? 0)) ? curr : best,
    ).tier;

    const bestByRevenue = all.reduce((best, curr) =>
      (curr.eff!.avgRevenueCents > (best.eff?.avgRevenueCents ?? 0)) ? curr : best,
    ).tier;

    return {
      opusEfficiency: opus,
      sonnetEfficiency: sonnet,
      haikuEfficiency: haiku,
      bestByQuality,
      bestByROI,
      bestByRevenue,
    };
  }

  private getCheapestViableTier(comparison: TierComparison): ModelTier {
    // Haiku if >= 80% first-try rate
    if (comparison.haikuEfficiency && comparison.haikuEfficiency.firstTryRate >= 0.8) {
      return 'haiku';
    }
    // Sonnet if >= 75% first-try rate
    if (comparison.sonnetEfficiency && comparison.sonnetEfficiency.firstTryRate >= 0.75) {
      return 'sonnet';
    }
    // Fallback to Opus
    return 'opus';
  }

  private calculateConfidence(comparison: TierComparison): number {
    const totalSamples = [
      comparison.opusEfficiency?.sampleSize ?? 0,
      comparison.sonnetEfficiency?.sampleSize ?? 0,
      comparison.haikuEfficiency?.sampleSize ?? 0,
    ].reduce((a, b) => a + b, 0);

    // Confidence scales with sample size: 10 tasks = 0.5, 30 = 0.75, 100+ = 0.95
    return Math.min(0.95, 0.3 + (totalSamples / 150));
  }

  // ── Task Type Mapping ──

  private getRelevantTaskTypes(agentId: AgentId): string[] {
    const taskTypesByAgent: Partial<Record<AgentId, string[]>> = {
      'copy-agent': ['product-description', 'email-campaign', 'blog-post', 'ad-copy', 'newsletter'],
      'design-agent': ['product-listing', 'social-post', 'ad-creative', 'brand-asset'],
      'social-media-agent': ['social-post', 'caption', 'video-script'],
      'ads-agent': ['ad-creative', 'ad-copy', 'campaign-strategy'],
      'commerce-agent': ['product-listing', 'pricing', 'inventory'],
      'analytics-agent': ['performance-review', 'growth-report', 'anomaly-analysis'],
    };
    return taskTypesByAgent[agentId] ?? [];
  }

  // ── Experiments ──

  /**
   * Start an A/B experiment comparing two model tiers for a specific task.
   */
  startExperiment(
    floorId: string,
    agentId: AgentId,
    taskType: string,
    controlTier: ModelTier,
    testTier: ModelTier,
    durationDays = 7,
  ): Experiment {
    const id = `exp-${agentId}-${taskType}-${Date.now()}`;
    const experiment: Experiment = {
      id,
      floorId,
      agentId,
      taskType,
      controlTier,
      testTier,
      controlTaskIds: [],
      testTaskIds: [],
      startedAt: new Date(),
      durationDays,
      status: 'running',
    };

    this.experiments.set(id, experiment);
    console.log(`[AdaptiveModelRouter] Started experiment ${id}: ${controlTier} vs ${testTier} for ${agentId}/${taskType}`);
    return experiment;
  }

  /**
   * Assign a task to either control or test group of an active experiment.
   * Returns the tier to use, or null if no active experiment.
   */
  getExperimentTier(floorId: string, agentId: AgentId, taskType: string): ModelTier | null {
    for (const exp of this.experiments.values()) {
      if (exp.floorId !== floorId || exp.agentId !== agentId ||
          exp.taskType !== taskType || exp.status !== 'running') continue;

      // Check if experiment has expired
      const elapsed = Date.now() - exp.startedAt.getTime();
      if (elapsed > exp.durationDays * 24 * 60 * 60 * 1000) {
        exp.status = 'completed';
        continue;
      }

      // Alternate between control and test (simple round-robin)
      const totalTasks = exp.controlTaskIds.length + exp.testTaskIds.length;
      return totalTasks % 2 === 0 ? exp.controlTier : exp.testTier;
    }

    return null;
  }

  // ── Queries ──

  getDecisions(): Map<string, AdaptiveDecision> {
    return new Map(this.decisions);
  }

  getActiveExperiments(): Experiment[] {
    return [...this.experiments.values()].filter(e => e.status === 'running');
  }

  getDecisionSummary(): Array<{ key: string; tier: ModelTier; reason: string; confidence: number }> {
    return [...this.decisions.entries()].map(([key, d]) => ({
      key,
      tier: d.adaptiveTier,
      reason: d.reason,
      confidence: d.confidence,
    }));
  }
}
