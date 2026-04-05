/**
 * PerformanceTracker — Aggregates real business metrics from all sources.
 *
 * Unlike the ImprovementEngine (which tracks text quality: first-try approvals,
 * slop violations), the PerformanceTracker tracks real-world outcomes:
 *   - Revenue per floor (Stripe)
 *   - Ad ROAS and CPA (Meta Insights)
 *   - Conversion rates (orders / visitors)
 *   - Email engagement (open rates, click rates)
 *   - Content engagement (reach, likes, shares)
 *   - Cost efficiency (revenue per dollar of LLM spend)
 *
 * Data is stored with time-series granularity (daily snapshots).
 * This feeds the outcome-based gold standard system and adaptive model routing.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentId } from '../config/types.js';
import type { EventBus } from './event-bus.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DailyMetrics {
  date: string; // YYYY-MM-DD
  floorId: string;

  // Revenue
  revenueCents: number;
  orderCount: number;
  avgOrderValueCents: number;
  refundCents: number;

  // Ads
  adSpendCents: number;
  adImpressions: number;
  adClicks: number;
  adConversions: number;
  roas: number;
  cpa: number;

  // Content
  postsPublished: number;
  totalReach: number;
  totalEngagement: number;

  // Email
  emailsSent: number;
  emailOpens: number;
  emailClicks: number;
  newSubscribers: number;

  // LLM costs
  llmSpendCents: number;
  tasksCompleted: number;
  firstTryRate: number;

  // Derived
  netRevenueCents: number;
  revenuePerLlmDollar: number; // Revenue generated per $1 of LLM spend
}

export interface TaskOutcome {
  taskId: string;
  floorId: string;
  agentId: AgentId;
  taskType: string;
  modelTier: string;
  /** The content/output of the task */
  outputHash: string;
  /** LLM cost for this task in cents */
  costCents: number;
  /** Was this approved on first try? */
  firstTry: boolean;
  /** Time to completion (ms) */
  completionTimeMs: number;
  /** Real-world outcome metrics (filled in later as results come in) */
  outcome?: {
    /** Revenue directly attributable to this output (cents) */
    revenueCents: number;
    /** Conversion rate if applicable (e.g., product listing → purchases) */
    conversionRate: number;
    /** Engagement metrics (for content/social tasks) */
    engagement: number;
    /** ROAS for ad-related tasks */
    roas: number;
    /** Timestamp when outcome was measured */
    measuredAt: Date;
  };
  createdAt: Date;
}

export interface AgentEfficiency {
  agentId: AgentId;
  floorId: string;
  taskType: string;
  /** Average cost per task (cents) */
  avgCostCents: number;
  /** First-try approval rate (0-1) */
  firstTryRate: number;
  /** Average revenue generated per task (cents) — 0 if not revenue-generating */
  avgRevenueCents: number;
  /** Revenue per dollar of LLM spend */
  revenuePerLlmDollar: number;
  /** Average completion time (ms) */
  avgCompletionTimeMs: number;
  /** Model tier used */
  modelTier: string;
  /** Number of tasks in sample */
  sampleSize: number;
}

// ─── PerformanceTracker ─────────────────────────────────────────────────────

export class PerformanceTracker {
  /** Daily metrics keyed by floorId → date */
  private dailyMetrics = new Map<string, DailyMetrics[]>();
  /** Individual task outcomes */
  private taskOutcomes = new Map<string, TaskOutcome>(); // taskId → outcome
  private dataDir = join(process.cwd(), 'data', 'performance');

  constructor(private eventBus: EventBus) {
    this.setupListeners();
  }

  // ── Event Listeners ──

  private setupListeners(): void {
    // Track task completions with cost data
    this.eventBus.on('task:completed', (data) => {
      // Basic outcome tracking — detailed outcome filled in by recordTaskOutcome
      console.log(`[PerformanceTracker] Task ${data.taskId} completed for floor ${data.floorId}`);
    });

    // Track revenue from orders
    this.eventBus.on('order:created', (data) => {
      this.recordRevenue(data.floorId, data.amountCents);
    });

    // Track LLM costs
    this.eventBus.on('cost:recorded', (data) => {
      if (data.costCents > 0) {
        this.recordLlmCost(data.floorId, data.costCents);
      }
    });
  }

  // ── Recording ──

  /**
   * Record a task outcome with full attribution data.
   */
  recordTaskOutcome(outcome: TaskOutcome): void {
    this.taskOutcomes.set(outcome.taskId, outcome);
  }

  /**
   * Attach real-world outcome metrics to a previously recorded task.
   * Called when results become measurable (e.g., 7 days after an ad launched).
   */
  attachOutcome(taskId: string, outcome: TaskOutcome['outcome']): void {
    const existing = this.taskOutcomes.get(taskId);
    if (existing) {
      existing.outcome = outcome;
      console.log(`[PerformanceTracker] Attached outcome to task ${taskId}: revenue=${outcome?.revenueCents}¢`);
    }
  }

  /**
   * Record revenue for a floor (from Stripe webhooks).
   */
  recordRevenue(floorId: string, amountCents: number): void {
    const today = this.getToday();
    const metrics = this.getOrCreateDailyMetrics(floorId, today);
    metrics.revenueCents += amountCents;
    metrics.orderCount++;
    metrics.avgOrderValueCents = metrics.orderCount > 0
      ? Math.round(metrics.revenueCents / metrics.orderCount)
      : 0;
    metrics.netRevenueCents = metrics.revenueCents - metrics.refundCents;
    this.updateRevenuePerLlm(metrics);
  }

  /**
   * Record LLM spend for a floor.
   */
  recordLlmCost(floorId: string, costCents: number): void {
    const today = this.getToday();
    const metrics = this.getOrCreateDailyMetrics(floorId, today);
    metrics.llmSpendCents += costCents;
    this.updateRevenuePerLlm(metrics);
  }

  /**
   * Record ad performance snapshot.
   */
  recordAdMetrics(floorId: string, data: {
    spendCents: number;
    impressions: number;
    clicks: number;
    conversions: number;
  }): void {
    const today = this.getToday();
    const metrics = this.getOrCreateDailyMetrics(floorId, today);
    metrics.adSpendCents = data.spendCents;
    metrics.adImpressions = data.impressions;
    metrics.adClicks = data.clicks;
    metrics.adConversions = data.conversions;
    metrics.roas = data.spendCents > 0 ? metrics.revenueCents / data.spendCents : 0;
    metrics.cpa = data.conversions > 0 ? data.spendCents / data.conversions : 0;
  }

  /**
   * Record content performance snapshot.
   */
  recordContentMetrics(floorId: string, data: {
    postsPublished: number;
    totalReach: number;
    totalEngagement: number;
  }): void {
    const today = this.getToday();
    const metrics = this.getOrCreateDailyMetrics(floorId, today);
    metrics.postsPublished = data.postsPublished;
    metrics.totalReach = data.totalReach;
    metrics.totalEngagement = data.totalEngagement;
  }

  // ── Analysis ──

  /**
   * Calculate agent efficiency metrics for a specific agent/task combo.
   * Used by adaptive model routing and outcome-based gold standards.
   */
  getAgentEfficiency(floorId: string, agentId: AgentId, taskType: string): AgentEfficiency | null {
    const outcomes = [...this.taskOutcomes.values()].filter(
      o => o.floorId === floorId && o.agentId === agentId && o.taskType === taskType,
    );

    if (outcomes.length < 3) return null; // Need minimum sample size

    const totalCost = outcomes.reduce((s, o) => s + o.costCents, 0);
    const firstTries = outcomes.filter(o => o.firstTry).length;
    const totalRevenue = outcomes.reduce((s, o) => s + (o.outcome?.revenueCents ?? 0), 0);
    const totalTime = outcomes.reduce((s, o) => s + o.completionTimeMs, 0);
    const modelTier = outcomes[outcomes.length - 1]?.modelTier ?? 'sonnet';

    const avgCost = totalCost / outcomes.length;
    const revenuePerLlm = totalCost > 0 ? (totalRevenue / totalCost) : 0;

    return {
      agentId,
      floorId,
      taskType,
      avgCostCents: Math.round(avgCost),
      firstTryRate: firstTries / outcomes.length,
      avgRevenueCents: Math.round(totalRevenue / outcomes.length),
      revenuePerLlmDollar: revenuePerLlm,
      avgCompletionTimeMs: Math.round(totalTime / outcomes.length),
      modelTier,
      sampleSize: outcomes.length,
    };
  }

  /**
   * Get the top-performing task outputs (by revenue or conversion).
   * These are candidates for outcome-based gold standards.
   */
  getTopPerformers(floorId: string, agentId: AgentId, taskType: string, limit = 5): TaskOutcome[] {
    return [...this.taskOutcomes.values()]
      .filter(o =>
        o.floorId === floorId &&
        o.agentId === agentId &&
        o.taskType === taskType &&
        o.outcome != null &&
        o.outcome.revenueCents > 0,
      )
      .sort((a, b) => (b.outcome?.revenueCents ?? 0) - (a.outcome?.revenueCents ?? 0))
      .slice(0, limit);
  }

  /**
   * Compare model tier efficiency for a specific agent/task combo.
   * Returns efficiency data per tier for the adaptive model router.
   */
  compareModelTiers(floorId: string, agentId: AgentId, taskType: string): Map<string, AgentEfficiency> {
    const outcomes = [...this.taskOutcomes.values()].filter(
      o => o.floorId === floorId && o.agentId === agentId && o.taskType === taskType,
    );

    // Group by model tier
    const byTier = new Map<string, TaskOutcome[]>();
    for (const o of outcomes) {
      const tier = o.modelTier;
      const arr = byTier.get(tier) ?? [];
      arr.push(o);
      byTier.set(tier, arr);
    }

    const efficiencies = new Map<string, AgentEfficiency>();
    for (const [tier, tierOutcomes] of byTier) {
      if (tierOutcomes.length < 3) continue;

      const totalCost = tierOutcomes.reduce((s, o) => s + o.costCents, 0);
      const firstTries = tierOutcomes.filter(o => o.firstTry).length;
      const totalRevenue = tierOutcomes.reduce((s, o) => s + (o.outcome?.revenueCents ?? 0), 0);
      const totalTime = tierOutcomes.reduce((s, o) => s + o.completionTimeMs, 0);

      efficiencies.set(tier, {
        agentId,
        floorId,
        taskType,
        avgCostCents: Math.round(totalCost / tierOutcomes.length),
        firstTryRate: firstTries / tierOutcomes.length,
        avgRevenueCents: Math.round(totalRevenue / tierOutcomes.length),
        revenuePerLlmDollar: totalCost > 0 ? totalRevenue / totalCost : 0,
        avgCompletionTimeMs: Math.round(totalTime / tierOutcomes.length),
        modelTier: tier,
        sampleSize: tierOutcomes.length,
      });
    }

    return efficiencies;
  }

  // ── Daily Metrics ──

  getDailyMetrics(floorId: string, days = 30): DailyMetrics[] {
    const history = this.dailyMetrics.get(floorId) ?? [];
    return history.slice(-days);
  }

  getLatestMetrics(floorId: string): DailyMetrics | undefined {
    const history = this.dailyMetrics.get(floorId);
    return history?.[history.length - 1];
  }

  /**
   * Get aggregate metrics across all floors (for CEO Mode cross-floor analysis).
   */
  getGlobalMetrics(days = 30): Map<string, DailyMetrics[]> {
    const result = new Map<string, DailyMetrics[]>();
    for (const [floorId, metrics] of this.dailyMetrics) {
      result.set(floorId, metrics.slice(-days));
    }
    return result;
  }

  // ── Persistence ──

  async persist(): Promise<void> {
    try {
      await mkdir(this.dataDir, { recursive: true });

      // Save daily metrics
      const metricsData: Record<string, DailyMetrics[]> = {};
      for (const [floorId, metrics] of this.dailyMetrics) {
        metricsData[floorId] = metrics;
      }
      await writeFile(
        join(this.dataDir, 'daily-metrics.json'),
        JSON.stringify(metricsData, null, 2),
      );

      // Save task outcomes (last 1000)
      const outcomes = [...this.taskOutcomes.values()]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 1000);
      await writeFile(
        join(this.dataDir, 'task-outcomes.json'),
        JSON.stringify(outcomes, null, 2),
      );

      console.log(`[PerformanceTracker] Persisted ${this.dailyMetrics.size} floors, ${this.taskOutcomes.size} outcomes`);
    } catch (err) {
      console.error(`[PerformanceTracker] Persist failed: ${(err as Error).message}`);
    }
  }

  async loadPersistedState(): Promise<void> {
    try {
      const metricsRaw = await readFile(join(this.dataDir, 'daily-metrics.json'), 'utf-8');
      const metricsData = JSON.parse(metricsRaw) as Record<string, DailyMetrics[]>;
      for (const [floorId, metrics] of Object.entries(metricsData)) {
        this.dailyMetrics.set(floorId, metrics);
      }

      const outcomesRaw = await readFile(join(this.dataDir, 'task-outcomes.json'), 'utf-8');
      const outcomes = JSON.parse(outcomesRaw) as TaskOutcome[];
      for (const o of outcomes) {
        o.createdAt = new Date(o.createdAt);
        if (o.outcome?.measuredAt) o.outcome.measuredAt = new Date(o.outcome.measuredAt);
        this.taskOutcomes.set(o.taskId, o);
      }

      console.log(`[PerformanceTracker] Loaded ${this.dailyMetrics.size} floors, ${this.taskOutcomes.size} outcomes`);
    } catch {
      // No persisted state — normal for first run
    }
  }

  // ── Helpers ──

  private getToday(): string {
    return new Date().toISOString().split('T')[0] ?? '';
  }

  private getOrCreateDailyMetrics(floorId: string, date: string): DailyMetrics {
    const history = this.dailyMetrics.get(floorId) ?? [];
    let today = history.find(m => m.date === date);

    if (!today) {
      today = {
        date,
        floorId,
        revenueCents: 0,
        orderCount: 0,
        avgOrderValueCents: 0,
        refundCents: 0,
        adSpendCents: 0,
        adImpressions: 0,
        adClicks: 0,
        adConversions: 0,
        roas: 0,
        cpa: 0,
        postsPublished: 0,
        totalReach: 0,
        totalEngagement: 0,
        emailsSent: 0,
        emailOpens: 0,
        emailClicks: 0,
        newSubscribers: 0,
        llmSpendCents: 0,
        tasksCompleted: 0,
        firstTryRate: 0,
        netRevenueCents: 0,
        revenuePerLlmDollar: 0,
      };
      history.push(today);
      // Keep last 90 days
      if (history.length > 90) history.splice(0, history.length - 90);
      this.dailyMetrics.set(floorId, history);
    }

    return today;
  }

  private updateRevenuePerLlm(metrics: DailyMetrics): void {
    metrics.revenuePerLlmDollar = metrics.llmSpendCents > 0
      ? metrics.netRevenueCents / metrics.llmSpendCents
      : 0;
  }
}
