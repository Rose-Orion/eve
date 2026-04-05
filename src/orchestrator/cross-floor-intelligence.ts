/**
 * CrossFloorIntelligence — CEO Mode aggregates learnings across all floors.
 *
 * Patterns discovered on Floor A can inform Floor B:
 *   - "Product descriptions with benefit-first structure convert 2.3x better"
 *   - "Instagram Reels at 7pm EST get 40% more engagement than 2pm"
 *   - "Sonnet produces ad copy as effective as Opus at 1/10th the cost"
 *
 * This system:
 *   1. Aggregates performance data across all floors
 *   2. Detects statistically significant patterns
 *   3. Generates cross-floor insights as structured knowledge
 *   4. Injects relevant insights into agent prompts via PromptBuilder
 *   5. Tracks which insights led to actual improvements (closed-loop)
 *
 * Privacy: Individual floor data stays private. Only anonymized patterns
 * are shared (e.g., "similar businesses see X" not "Floor A does X").
 */

import type { AgentId } from '../config/types.js';
import type { PerformanceTracker, AgentEfficiency, TaskOutcome } from './performance-tracker.js';
import type { EventBus } from './event-bus.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type InsightCategory =
  | 'content-strategy'
  | 'pricing'
  | 'ad-optimization'
  | 'model-efficiency'
  | 'timing'
  | 'engagement'
  | 'conversion'
  | 'cost-reduction';

export interface CrossFloorInsight {
  id: string;
  category: InsightCategory;
  /** Human-readable insight description */
  description: string;
  /** Which agent(s) this insight applies to */
  applicableAgents: AgentId[];
  /** Which task types this insight applies to */
  applicableTaskTypes: string[];
  /** Confidence level (0-1) based on sample size and consistency */
  confidence: number;
  /** Number of floors contributing data to this insight */
  floorCount: number;
  /** Sample size (total tasks analyzed) */
  sampleSize: number;
  /** Quantified impact (e.g., "2.3x higher conversion") */
  impact: string;
  /** The actual data behind the insight */
  evidence: InsightEvidence;
  /** When this insight was generated */
  generatedAt: Date;
  /** How many times this insight has been injected into prompts */
  timesUsed: number;
  /** Measured improvement after adoption (filled in later) */
  measuredImprovement?: number;
}

export interface InsightEvidence {
  /** Metric being compared */
  metric: string;
  /** Average value for the "good" group */
  goodGroupAvg: number;
  /** Average value for the "baseline" group */
  baselineAvg: number;
  /** Percentage improvement */
  improvementPercent: number;
  /** Floor IDs contributing (anonymized as Floor 1, Floor 2, etc. in output) */
  floorIds: string[];
}

// ─── CrossFloorIntelligence ────────────────────────────────────────────────

export class CrossFloorIntelligence {
  private insights: CrossFloorInsight[] = [];
  private analysisInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private performanceTracker: PerformanceTracker,
    private eventBus: EventBus,
  ) {}

  // ── Lifecycle ──

  /**
   * Start periodic cross-floor analysis (runs weekly by default).
   */
  start(intervalHours = 168): void {
    if (this.analysisInterval) return;
    const intervalMs = intervalHours * 60 * 60 * 1000;
    this.analysisInterval = setInterval(() => {
      this.runAnalysis().catch(err => {
        console.error(`[CrossFloorIntelligence] Analysis failed: ${(err as Error).message}`);
      });
    }, intervalMs);
    console.log(`[CrossFloorIntelligence] Started — analyzing every ${intervalHours}h`);
  }

  stop(): void {
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = null;
    }
  }

  // ── Analysis Engine ──

  /**
   * Run comprehensive cross-floor analysis.
   * Detects patterns across all floors and generates actionable insights.
   */
  async runAnalysis(): Promise<CrossFloorInsight[]> {
    console.log('[CrossFloorIntelligence] Running cross-floor analysis...');
    const newInsights: CrossFloorInsight[] = [];

    // Get metrics from all floors
    const globalMetrics = this.performanceTracker.getGlobalMetrics(30);
    const floorIds = [...globalMetrics.keys()];

    if (floorIds.length < 2) {
      console.log('[CrossFloorIntelligence] Need at least 2 floors for cross-floor analysis');
      return [];
    }

    // 1. Model efficiency analysis — which model tier works best per task type?
    newInsights.push(...this.analyzeModelEfficiency(floorIds));

    // 2. Content timing analysis — when do posts perform best?
    newInsights.push(...this.analyzeContentTiming(floorIds));

    // 3. Cost-quality tradeoff analysis — where are we overspending on Opus?
    newInsights.push(...this.analyzeCostQuality(floorIds));

    // 4. Ad performance patterns — what ROAS/CPA patterns emerge?
    newInsights.push(...this.analyzeAdPatterns(floorIds));

    // 5. Revenue per LLM dollar — which agent tasks generate the most revenue?
    newInsights.push(...this.analyzeRevenueEfficiency(floorIds));

    // Store and emit
    this.insights = [...this.insights, ...newInsights];
    // Keep last 100 insights
    if (this.insights.length > 100) {
      this.insights = this.insights.slice(-100);
    }

    if (newInsights.length > 0) {
      console.log(`[CrossFloorIntelligence] Generated ${newInsights.length} new insights from ${floorIds.length} floors`);
    }

    return newInsights;
  }

  // ── Pattern Detectors ──

  /**
   * Analyze which model tiers produce the best outcomes per task type.
   */
  private analyzeModelEfficiency(floorIds: string[]): CrossFloorInsight[] {
    const insights: CrossFloorInsight[] = [];
    const agentIds: AgentId[] = [
      'copy-agent', 'design-agent', 'social-media-agent',
      'ads-agent', 'commerce-agent',
    ];
    const taskTypes = [
      'product-description', 'social-post', 'ad-creative',
      'email-campaign', 'product-listing',
    ];

    for (const agentId of agentIds) {
      for (const taskType of taskTypes) {
        // Collect tier comparisons across floors
        const allTierData = new Map<string, { firstTryRates: number[]; revenues: number[]; costs: number[]; floorIds: string[] }>();

        for (const floorId of floorIds) {
          const tiers = this.performanceTracker.compareModelTiers(floorId, agentId, taskType);
          for (const [tier, eff] of tiers) {
            const data = allTierData.get(tier) ?? { firstTryRates: [], revenues: [], costs: [], floorIds: [] };
            data.firstTryRates.push(eff.firstTryRate);
            data.revenues.push(eff.avgRevenueCents);
            data.costs.push(eff.avgCostCents);
            data.floorIds.push(floorId);
            allTierData.set(tier, data);
          }
        }

        // Compare tiers — is a cheaper tier performing just as well?
        const sonnetData = allTierData.get('sonnet');
        const opusData = allTierData.get('opus');

        if (sonnetData && opusData && sonnetData.floorIds.length >= 2 && opusData.floorIds.length >= 2) {
          const sonnetAvgFTR = avg(sonnetData.firstTryRates);
          const opusAvgFTR = avg(opusData.firstTryRates);
          const sonnetAvgCost = avg(sonnetData.costs);
          const opusAvgCost = avg(opusData.costs);
          const sonnetAvgRev = avg(sonnetData.revenues);
          const opusAvgRev = avg(opusData.revenues);

          // If Sonnet is within 10% of Opus quality but significantly cheaper
          if (sonnetAvgFTR >= opusAvgFTR * 0.9 && sonnetAvgCost < opusAvgCost * 0.5) {
            const costSaving = ((opusAvgCost - sonnetAvgCost) / opusAvgCost * 100).toFixed(0);
            insights.push({
              id: `model-eff-${agentId}-${taskType}-${Date.now()}`,
              category: 'model-efficiency',
              description: `Sonnet produces ${taskType} outputs for ${agentId} at comparable quality (${(sonnetAvgFTR * 100).toFixed(0)}% vs ${(opusAvgFTR * 100).toFixed(0)}% first-try rate) while costing ${costSaving}% less.`,
              applicableAgents: [agentId],
              applicableTaskTypes: [taskType],
              confidence: Math.min(1, (sonnetData.floorIds.length + opusData.floorIds.length) / 10),
              floorCount: new Set([...sonnetData.floorIds, ...opusData.floorIds]).size,
              sampleSize: sonnetData.firstTryRates.length + opusData.firstTryRates.length,
              impact: `${costSaving}% cost reduction with comparable quality`,
              evidence: {
                metric: 'cost_vs_quality',
                goodGroupAvg: sonnetAvgCost,
                baselineAvg: opusAvgCost,
                improvementPercent: Number(costSaving),
                floorIds: [...new Set([...sonnetData.floorIds, ...opusData.floorIds])],
              },
              generatedAt: new Date(),
              timesUsed: 0,
            });
          }

          // If Opus generates significantly more revenue despite higher cost
          if (opusAvgRev > sonnetAvgRev * 1.5 && opusData.floorIds.length >= 2) {
            const revGain = ((opusAvgRev - sonnetAvgRev) / Math.max(1, sonnetAvgRev) * 100).toFixed(0);
            insights.push({
              id: `model-rev-${agentId}-${taskType}-${Date.now()}`,
              category: 'model-efficiency',
              description: `Opus generates ${revGain}% more revenue for ${taskType} tasks — the higher cost is justified by outcomes.`,
              applicableAgents: [agentId],
              applicableTaskTypes: [taskType],
              confidence: Math.min(1, opusData.floorIds.length / 5),
              floorCount: new Set([...sonnetData.floorIds, ...opusData.floorIds]).size,
              sampleSize: opusData.firstTryRates.length,
              impact: `${revGain}% higher revenue per task`,
              evidence: {
                metric: 'revenue_per_task',
                goodGroupAvg: opusAvgRev,
                baselineAvg: sonnetAvgRev,
                improvementPercent: Number(revGain),
                floorIds: opusData.floorIds,
              },
              generatedAt: new Date(),
              timesUsed: 0,
            });
          }
        }
      }
    }

    return insights;
  }

  /**
   * Analyze content posting patterns and timing.
   */
  private analyzeContentTiming(_floorIds: string[]): CrossFloorInsight[] {
    // Content timing analysis would pull from ContentScheduler published posts
    // with engagement data. For now, return empty — filled in when engagement
    // metrics flow back from Meta/TikTok APIs.
    return [];
  }

  /**
   * Analyze cost-quality tradeoffs — find tasks where we're overspending.
   */
  private analyzeCostQuality(floorIds: string[]): CrossFloorInsight[] {
    const insights: CrossFloorInsight[] = [];

    // Collect efficiency data across all floors
    const agentIds: AgentId[] = [
      'copy-agent', 'design-agent', 'social-media-agent',
      'ads-agent', 'commerce-agent',
    ];

    for (const agentId of agentIds) {
      const efficiencies: Array<AgentEfficiency & { floor: string }> = [];

      for (const floorId of floorIds) {
        // Check common task types
        for (const taskType of ['product-description', 'social-post', 'ad-creative', 'email-campaign']) {
          const eff = this.performanceTracker.getAgentEfficiency(floorId, agentId, taskType);
          if (eff) {
            efficiencies.push({ ...eff, floor: floorId });
          }
        }
      }

      if (efficiencies.length < 3) continue;

      // Find high-cost outliers with low revenue return
      const avgCost = avg(efficiencies.map(e => e.avgCostCents));
      const avgRevPerLlm = avg(efficiencies.map(e => e.revenuePerLlmDollar));
      const lowROI = efficiencies.filter(e => e.revenuePerLlmDollar < avgRevPerLlm * 0.5 && e.avgCostCents > avgCost * 1.5);

      if (lowROI.length >= 2) {
        insights.push({
          id: `cost-quality-${agentId}-${Date.now()}`,
          category: 'cost-reduction',
          description: `${agentId} tasks on ${lowROI.length} floors have high LLM costs with low revenue return. Consider downgrading model tier or improving prompts.`,
          applicableAgents: [agentId],
          applicableTaskTypes: [...new Set(lowROI.map(e => e.taskType))],
          confidence: Math.min(1, lowROI.length / 5),
          floorCount: new Set(lowROI.map(e => e.floor)).size,
          sampleSize: lowROI.reduce((s, e) => s + e.sampleSize, 0),
          impact: `Potential ${((1 - avgRevPerLlm * 0.5 / Math.max(1, avg(lowROI.map(e => e.avgCostCents)))) * 100).toFixed(0)}% cost reduction`,
          evidence: {
            metric: 'revenue_per_llm_dollar',
            goodGroupAvg: avgRevPerLlm,
            baselineAvg: avg(lowROI.map(e => e.revenuePerLlmDollar)),
            improvementPercent: 0,
            floorIds: lowROI.map(e => e.floor),
          },
          generatedAt: new Date(),
          timesUsed: 0,
        });
      }
    }

    return insights;
  }

  /**
   * Analyze ad performance patterns across floors.
   */
  private analyzeAdPatterns(floorIds: string[]): CrossFloorInsight[] {
    const insights: CrossFloorInsight[] = [];
    const globalMetrics = this.performanceTracker.getGlobalMetrics(30);

    // Collect ROAS and CPA data across floors
    const floorAdData: Array<{ floorId: string; avgRoas: number; avgCpa: number; days: number }> = [];

    for (const [floorId, metrics] of globalMetrics) {
      const withAds = metrics.filter(m => m.adSpendCents > 0);
      if (withAds.length < 7) continue; // Need at least a week of data

      const avgRoas = avg(withAds.map(m => m.roas));
      const avgCpa = avg(withAds.map(m => m.cpa));
      floorAdData.push({ floorId, avgRoas, avgCpa, days: withAds.length });
    }

    if (floorAdData.length >= 2) {
      // Find top performers and share what works
      const sortedByRoas = [...floorAdData].sort((a, b) => b.avgRoas - a.avgRoas);
      const topRoas = sortedByRoas[0];
      const bottomRoas = sortedByRoas[sortedByRoas.length - 1];

      if (topRoas && bottomRoas && topRoas.avgRoas > bottomRoas.avgRoas * 2) {
        insights.push({
          id: `ad-roas-spread-${Date.now()}`,
          category: 'ad-optimization',
          description: `Significant ROAS spread detected across floors (${topRoas.avgRoas.toFixed(1)}x vs ${bottomRoas.avgRoas.toFixed(1)}x). Top-performing floor's ad strategies should inform others.`,
          applicableAgents: ['ads-agent'],
          applicableTaskTypes: ['ad-creative', 'ad-copy'],
          confidence: Math.min(1, floorAdData.length / 5),
          floorCount: floorAdData.length,
          sampleSize: floorAdData.reduce((s, d) => s + d.days, 0),
          impact: `${((topRoas.avgRoas / Math.max(0.01, bottomRoas.avgRoas) - 1) * 100).toFixed(0)}% potential ROAS improvement`,
          evidence: {
            metric: 'roas',
            goodGroupAvg: topRoas.avgRoas,
            baselineAvg: bottomRoas.avgRoas,
            improvementPercent: (topRoas.avgRoas / Math.max(0.01, bottomRoas.avgRoas) - 1) * 100,
            floorIds: floorAdData.map(d => d.floorId),
          },
          generatedAt: new Date(),
          timesUsed: 0,
        });
      }
    }

    return insights;
  }

  /**
   * Analyze which agent tasks generate the most revenue per LLM dollar.
   */
  private analyzeRevenueEfficiency(floorIds: string[]): CrossFloorInsight[] {
    const insights: CrossFloorInsight[] = [];
    const globalMetrics = this.performanceTracker.getGlobalMetrics(30);

    // Collect revenue-per-LLM-dollar across floors
    const floorEfficiency: Array<{ floorId: string; revPerLlm: number }> = [];

    for (const [floorId, metrics] of globalMetrics) {
      const recent = metrics.slice(-7); // Last week
      if (recent.length < 3) continue;

      const totalRev = recent.reduce((s, m) => s + m.netRevenueCents, 0);
      const totalLlm = recent.reduce((s, m) => s + m.llmSpendCents, 0);
      if (totalLlm === 0) continue;

      floorEfficiency.push({ floorId, revPerLlm: totalRev / totalLlm });
    }

    if (floorEfficiency.length >= 2) {
      const avgEfficiency = avg(floorEfficiency.map(f => f.revPerLlm));
      const highPerformers = floorEfficiency.filter(f => f.revPerLlm > avgEfficiency * 1.5);

      if (highPerformers.length > 0 && avgEfficiency > 0) {
        insights.push({
          id: `rev-efficiency-${Date.now()}`,
          category: 'conversion',
          description: `${highPerformers.length} floor(s) generate ${(avg(highPerformers.map(f => f.revPerLlm))).toFixed(1)}x revenue per LLM dollar vs the ${avgEfficiency.toFixed(1)}x average. Analyzing their agent configurations for patterns.`,
          applicableAgents: ['copy-agent', 'commerce-agent', 'ads-agent'],
          applicableTaskTypes: ['product-description', 'ad-creative', 'product-listing'],
          confidence: Math.min(1, floorEfficiency.length / 5),
          floorCount: floorEfficiency.length,
          sampleSize: floorEfficiency.length * 7, // ~7 days per floor
          impact: `${((avg(highPerformers.map(f => f.revPerLlm)) / avgEfficiency - 1) * 100).toFixed(0)}% higher revenue efficiency`,
          evidence: {
            metric: 'revenue_per_llm_dollar',
            goodGroupAvg: avg(highPerformers.map(f => f.revPerLlm)),
            baselineAvg: avgEfficiency,
            improvementPercent: (avg(highPerformers.map(f => f.revPerLlm)) / avgEfficiency - 1) * 100,
            floorIds: highPerformers.map(f => f.floorId),
          },
          generatedAt: new Date(),
          timesUsed: 0,
        });
      }
    }

    return insights;
  }

  // ── Prompt Integration ──

  /**
   * Get relevant insights for a specific agent and task type.
   * PromptBuilder calls this to inject cross-floor intelligence.
   */
  getRelevantInsights(agentId: AgentId, taskType: string, limit = 3): CrossFloorInsight[] {
    return this.insights
      .filter(insight =>
        insight.confidence >= 0.5 &&
        (insight.applicableAgents.includes(agentId) || insight.applicableAgents.length === 0) &&
        (insight.applicableTaskTypes.includes(taskType) || insight.applicableTaskTypes.length === 0),
      )
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  /**
   * Format insights as XML for prompt injection.
   */
  formatForPrompt(insights: CrossFloorInsight[]): string {
    if (insights.length === 0) return '';

    const inner = insights.map((insight, i) => {
      return [
        `<insight index="${i + 1}" category="${insight.category}" confidence="${(insight.confidence * 100).toFixed(0)}%">`,
        `  <finding>${insight.description}</finding>`,
        `  <impact>${insight.impact}</impact>`,
        `</insight>`,
      ].join('\n');
    }).join('\n\n');

    return `<cross_floor_intelligence note="Patterns observed across multiple businesses. Use these to inform your approach.">\n${inner}\n</cross_floor_intelligence>`;
  }

  /**
   * Record that an insight was used in a prompt (for tracking adoption).
   */
  recordInsightUsage(insightId: string): void {
    const insight = this.insights.find(i => i.id === insightId);
    if (insight) insight.timesUsed++;
  }

  // ── Queries ──

  getAllInsights(): CrossFloorInsight[] {
    return [...this.insights];
  }

  getInsightsByCategory(category: InsightCategory): CrossFloorInsight[] {
    return this.insights.filter(i => i.category === category);
  }
}

// ── Utility ──

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}
