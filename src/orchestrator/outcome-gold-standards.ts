/**
 * OutcomeGoldStandards — Upgrades gold standards from "owner approved text"
 * to "this output generated $X revenue."
 *
 * Instead of treating all approved outputs equally, this system:
 *   1. Queries PerformanceTracker for top-performing task outputs
 *   2. Ranks them by real-world outcomes (revenue, conversions, engagement)
 *   3. Saves the highest-performing outputs as gold standards with outcome metadata
 *   4. Injects outcome context into prompts so agents learn what actually works
 *
 * This creates a virtuous cycle:
 *   Agent output → Real-world results → Top performers identified →
 *   Loaded as examples → Better outputs → Better results
 *
 * Runs periodically (weekly by default) to refresh gold standards.
 */

import { mkdir, readdir, writeFile, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentId } from '../config/types.js';
import type { PerformanceTracker, TaskOutcome } from './performance-tracker.js';
import type { EventBus } from './event-bus.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OutcomeGoldStandard {
  /** Task ID that produced this output */
  taskId: string;
  floorId: string;
  agentId: AgentId;
  taskType: string;
  /** The actual output content */
  content: string;
  /** Hash of content for dedup */
  contentHash: string;
  /** Revenue directly attributable to this output (cents) */
  revenueCents: number;
  /** Conversion rate achieved */
  conversionRate: number;
  /** Engagement score */
  engagement: number;
  /** ROAS for ad-related outputs */
  roas: number;
  /** Composite score (0-100) combining all outcome metrics */
  outcomeScore: number;
  /** Model tier that produced this output */
  modelTier: string;
  /** LLM cost to produce this output (cents) */
  costCents: number;
  /** When the output was created */
  createdAt: Date;
  /** When the outcome was measured */
  measuredAt: Date;
}

export interface OutcomeGoldStandardConfig {
  /** How often to refresh gold standards (hours) */
  refreshIntervalHours: number;
  /** Minimum outcome score to qualify as gold standard */
  minOutcomeScore: number;
  /** Max gold standards per agent/taskType combo */
  maxPerAgentTask: number;
  /** Minimum age of output before considering (days) — ensures outcomes are measured */
  minAgeDays: number;
  /** Whether to auto-replace approval-based gold standards with outcome-based ones */
  autoReplace: boolean;
}

const DEFAULT_CONFIG: OutcomeGoldStandardConfig = {
  refreshIntervalHours: 168, // Weekly
  minOutcomeScore: 60,
  maxPerAgentTask: 3,
  minAgeDays: 7,
  autoReplace: true,
};

const PROJECTS_DIR = join(process.env['HOME'] ?? '/Users/automation', 'orion-projects');

// ─── OutcomeGoldStandards ──────────────────────────────────────────────────

export class OutcomeGoldStandards {
  private config: OutcomeGoldStandardConfig;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  /** Cached outcome gold standards per floor */
  private standards = new Map<string, OutcomeGoldStandard[]>();

  constructor(
    private performanceTracker: PerformanceTracker,
    private eventBus: EventBus,
    config?: Partial<OutcomeGoldStandardConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Lifecycle ──

  start(): void {
    if (this.refreshInterval) return;
    const intervalMs = this.config.refreshIntervalHours * 60 * 60 * 1000;
    this.refreshInterval = setInterval(() => {
      this.refreshAll().catch(err => {
        console.error(`[OutcomeGoldStandards] Refresh failed: ${(err as Error).message}`);
      });
    }, intervalMs);
    console.log(`[OutcomeGoldStandards] Started — refreshing every ${this.config.refreshIntervalHours}h`);
  }

  stop(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  // ── Refresh Cycle ──

  /**
   * Refresh outcome-based gold standards for all tracked floors.
   */
  async refreshAll(): Promise<void> {
    const globalMetrics = this.performanceTracker.getGlobalMetrics(1);
    const floorIds = [...globalMetrics.keys()];

    for (const floorId of floorIds) {
      await this.refreshFloor(floorId);
    }
  }

  /**
   * Refresh outcome-based gold standards for a specific floor.
   * Scans all agent/taskType combos with measured outcomes.
   */
  async refreshFloor(floorId: string): Promise<void> {
    console.log(`[OutcomeGoldStandards] Refreshing for floor ${floorId}`);

    // Get all task outcomes with measured results
    const agentTaskCombos = this.getAgentTaskCombos(floorId);
    let promoted = 0;

    for (const { agentId, taskType } of agentTaskCombos) {
      const topPerformers = this.performanceTracker.getTopPerformers(
        floorId, agentId, taskType, this.config.maxPerAgentTask * 2,
      );

      if (topPerformers.length === 0) continue;

      // Score and filter
      const scored = topPerformers
        .map(outcome => this.scoreOutcome(outcome))
        .filter(s => s.outcomeScore >= this.config.minOutcomeScore)
        .sort((a, b) => b.outcomeScore - a.outcomeScore)
        .slice(0, this.config.maxPerAgentTask);

      if (scored.length === 0) continue;

      // Save to disk as gold standards with outcome metadata
      const floorSlug = floorId; // In production, map floorId → slug
      await this.saveOutcomeGoldStandards(floorSlug, agentId, taskType, scored);
      promoted += scored.length;
    }

    if (promoted > 0) {
      console.log(`[OutcomeGoldStandards] Promoted ${promoted} outcome-based gold standards for ${floorId}`);
    }
  }

  // ── Scoring ──

  /**
   * Calculate a composite outcome score (0-100) for a task outcome.
   * Weights revenue most heavily, then conversions, then engagement.
   */
  private scoreOutcome(outcome: TaskOutcome): OutcomeGoldStandard {
    const o = outcome.outcome!;
    let score = 0;

    // Revenue component (0-40 points)
    if (o.revenueCents > 0) {
      // Logarithmic scale: $1 = 10pts, $10 = 20pts, $100 = 30pts, $1000+ = 40pts
      score += Math.min(40, 10 * Math.log10(o.revenueCents / 100 + 1) + 10);
    }

    // Conversion rate component (0-25 points)
    if (o.conversionRate > 0) {
      // 1% = 5pts, 5% = 15pts, 10%+ = 25pts
      score += Math.min(25, o.conversionRate * 250);
    }

    // Engagement component (0-20 points)
    if (o.engagement > 0) {
      score += Math.min(20, Math.log10(o.engagement + 1) * 8);
    }

    // ROAS bonus (0-15 points) — only for ad-related tasks
    if (o.roas > 0) {
      // ROAS 1x = 5pts, 3x = 10pts, 5x+ = 15pts
      score += Math.min(15, o.roas * 3);
    }

    // Cost efficiency bonus — cheaper outputs that perform well get a boost
    if (outcome.costCents > 0 && o.revenueCents > 0) {
      const roiRatio = o.revenueCents / outcome.costCents;
      if (roiRatio > 100) score += 5; // 100:1 revenue to LLM cost
    }

    return {
      taskId: outcome.taskId,
      floorId: outcome.floorId,
      agentId: outcome.agentId,
      taskType: outcome.taskType,
      content: outcome.outputHash, // In production, load full content from workspace
      contentHash: outcome.outputHash,
      revenueCents: o.revenueCents,
      conversionRate: o.conversionRate,
      engagement: o.engagement,
      roas: o.roas,
      outcomeScore: Math.min(100, Math.round(score)),
      modelTier: outcome.modelTier,
      costCents: outcome.costCents,
      createdAt: outcome.createdAt,
      measuredAt: o.measuredAt,
    };
  }

  // ── Persistence ──

  /**
   * Save outcome-based gold standards to disk.
   * These coexist with (or replace) approval-based gold standards.
   */
  private async saveOutcomeGoldStandards(
    floorSlug: string,
    agentId: AgentId,
    taskType: string,
    standards: OutcomeGoldStandard[],
  ): Promise<void> {
    const dir = join(
      PROJECTS_DIR, floorSlug, '.orion', 'gold-standards', agentId, taskType,
    );
    await mkdir(dir, { recursive: true });

    // If autoReplace, remove old approval-based standards (no outcome metadata in header)
    if (this.config.autoReplace) {
      await this.removeApprovalBasedStandards(dir);
    }

    // Write outcome-based standards
    for (const std of standards) {
      const filename = `outcome-${std.taskId}-${Date.now()}.md`;
      const header = [
        `<!-- Outcome Gold Standard`,
        `  Agent: ${agentId}`,
        `  Task: ${taskType}`,
        `  Floor: ${floorSlug}`,
        `  Revenue: $${(std.revenueCents / 100).toFixed(2)}`,
        `  Conversion: ${(std.conversionRate * 100).toFixed(1)}%`,
        `  Engagement: ${std.engagement}`,
        `  ROAS: ${std.roas.toFixed(2)}`,
        `  Score: ${std.outcomeScore}/100`,
        `  Model: ${std.modelTier}`,
        `  Cost: $${(std.costCents / 100).toFixed(4)}`,
        `  Created: ${std.createdAt.toISOString()}`,
        `  Measured: ${std.measuredAt.toISOString()}`,
        `-->`,
      ].join('\n');

      await writeFile(join(dir, filename), `${header}\n\n${std.content}`, 'utf-8');
    }

    // Cache
    const key = `${floorSlug}:${agentId}:${taskType}`;
    this.standards.set(key, standards);
  }

  /**
   * Remove old approval-based gold standards when outcome-based ones are available.
   * Approval-based standards don't have "Outcome Gold Standard" in their header.
   */
  private async removeApprovalBasedStandards(dir: string): Promise<void> {
    try {
      const files = await readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        if (file.startsWith('outcome-')) continue; // Keep outcome-based
        // Remove approval-based standard
        await unlink(join(dir, file));
      }
    } catch {
      // Directory may not exist yet
    }
  }

  // ── Query ──

  /**
   * Get outcome gold standards for a specific agent/taskType.
   * Used by PromptBuilder to inject into prompts.
   */
  getStandards(floorId: string, agentId: AgentId, taskType: string): OutcomeGoldStandard[] {
    const key = `${floorId}:${agentId}:${taskType}`;
    return this.standards.get(key) ?? [];
  }

  /**
   * Format outcome gold standards as XML for prompt injection.
   * Includes outcome metadata so the agent understands what works.
   */
  formatForPrompt(standards: OutcomeGoldStandard[]): string {
    if (standards.length === 0) return '';

    const inner = standards.map((std, i) => {
      const metrics = [
        `revenue="$${(std.revenueCents / 100).toFixed(2)}"`,
        std.conversionRate > 0 ? `conversion="${(std.conversionRate * 100).toFixed(1)}%"` : '',
        std.engagement > 0 ? `engagement="${std.engagement}"` : '',
        std.roas > 0 ? `roas="${std.roas.toFixed(2)}"` : '',
      ].filter(Boolean).join(' ');

      return `<example index="${i + 1}" type="outcome-proven" score="${std.outcomeScore}" ${metrics}>\n${std.content}\n</example>`;
    }).join('\n\n');

    return `<examples source="outcome-based" note="These examples generated measurable real-world results. Study what makes them effective.">\n${inner}\n</examples>`;
  }

  // ── Helpers ──

  /**
   * Get unique agent/taskType combinations that have measured outcomes.
   */
  private getAgentTaskCombos(floorId: string): Array<{ agentId: AgentId; taskType: string }> {
    // We scan known agent IDs and common task types
    // In production, this would query PerformanceTracker's task outcome index
    const combos: Array<{ agentId: AgentId; taskType: string }> = [];
    const agentIds: AgentId[] = [
      'copy-agent', 'design-agent', 'social-media-agent',
      'ads-agent', 'commerce-agent', 'analytics-agent',
    ];
    const taskTypes = [
      'product-description', 'social-post', 'ad-creative', 'email-campaign',
      'product-listing', 'blog-post', 'landing-page', 'video-script',
      'ad-copy', 'caption', 'newsletter',
    ];

    for (const agentId of agentIds) {
      for (const taskType of taskTypes) {
        const topPerformers = this.performanceTracker.getTopPerformers(floorId, agentId, taskType, 1);
        if (topPerformers.length > 0) {
          combos.push({ agentId, taskType });
        }
      }
    }

    return combos;
  }
}
