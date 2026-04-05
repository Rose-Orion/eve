/**
 * CouncilRouter — decides whether a task should use multi-agent council dispatch.
 *
 * Council mode runs N agents in parallel on the same task, then an evaluator
 * picks the best output. Only used for high-value creative/strategic tasks
 * where competing perspectives improve quality.
 */

import type { Task, Floor, ModelTier } from '../config/types.js';
import type { ConcurrencyManager } from './concurrency.js';
import type { BudgetEnforcer } from '../security/budget-enforcer.js';

export interface CouncilPlan {
  /** Number of parallel agents to dispatch */
  agentCount: number;
  /** Model tier for the parallel agents */
  agentTier: ModelTier;
  /** Model tier for the evaluator pass */
  evaluatorTier: ModelTier;
  /** Persona variations for each agent (injected into prompt) */
  personas: string[];
  /** Evaluation criteria for the evaluator */
  evaluationCriteria: string;
}

/**
 * Task types eligible for council dispatch and their configurations.
 * Only first-attempt tasks use council — retries always go single-agent.
 */
const COUNCIL_CONFIGS: Record<string, {
  agentCount: number;
  agentTier: ModelTier;
  evaluatorTier: ModelTier;
  personas: string[];
  evaluationCriteria: string;
  /** Minimum remaining budget (cents) to allow council */
  minBudgetCents: number;
}> = {
  'brand-options': {
    agentCount: 3,
    agentTier: 'sonnet',
    evaluatorTier: 'sonnet',
    personas: [
      'You are a bold, edgy brand strategist. You favor striking, unconventional names, daring color palettes, and brands that stand out through provocation and surprise. Push boundaries.',
      'You are a warm, approachable brand strategist. You favor friendly, inviting names, soft palettes, and brands that feel like a trusted friend. Prioritize accessibility and emotional connection.',
      'You are a minimal, premium brand strategist. You favor clean, sophisticated names, restrained palettes, and brands that convey quality through simplicity. Less is more.',
    ],
    evaluationCriteria: 'Evaluate based on: brand distinctiveness, target audience fit, name memorability, visual system coherence, voice consistency, and commercial viability.',
    minBudgetCents: 500, // ~$5 minimum remaining
  },
  'business-strategy': {
    agentCount: 2,
    agentTier: 'sonnet',
    evaluatorTier: 'sonnet',
    personas: [
      'You are an aggressive growth strategist. You prioritize market capture, speed-to-market, and competitive differentiation. You favor bold bets with high upside.',
      'You are a sustainable growth strategist. You prioritize unit economics, customer retention, and defensible moats. You favor measured, de-risked approaches.',
    ],
    evaluationCriteria: 'Evaluate based on: market analysis depth, financial realism, competitive positioning, risk assessment, and actionability within budget constraints.',
    minBudgetCents: 400,
  },
  'brand-visual-system': {
    agentCount: 2,
    agentTier: 'sonnet',
    evaluatorTier: 'sonnet',
    personas: [
      'You are a modern digital-first designer. You favor contemporary aesthetics — clean typography, generous whitespace, vibrant accent colors, and bold geometric elements.',
      'You are an expressive, character-driven designer. You favor personality-rich aesthetics — custom illustrations, playful typography, textured backgrounds, and memorable visual hooks.',
    ],
    evaluationCriteria: 'Evaluate based on: visual coherence, brand alignment, scalability across media, accessibility (contrast/readability), and differentiation from competitors.',
    minBudgetCents: 400,
  },
};

/**
 * Determine whether a task should use council dispatch.
 * Returns a CouncilPlan if yes, null if no.
 */
export function shouldUseCouncil(
  task: Task,
  floor: Floor,
  concurrency: ConcurrencyManager,
  budgetEnforcer: BudgetEnforcer,
): CouncilPlan | null {
  // Only first attempts use council — retries go single-agent
  if (task.attempts > 0) return null;

  // Check if this task type has a council config
  const config = COUNCIL_CONFIGS[task.taskType];
  if (!config) return null;

  // Check remaining budget
  const budgetStatus = budgetEnforcer.getStatus(task.floorId);
  if (!budgetStatus) return null;
  const remaining = budgetStatus.ceilingCents - budgetStatus.spentCents;
  if (remaining < config.minBudgetCents) {
    console.log(`[Council] Skipping council for ${task.taskType} — budget too low (${remaining}¢ < ${config.minBudgetCents}¢)`);
    return null;
  }

  // Check concurrency — council needs N agent slots
  // We need at least agentCount slots available (evaluator reuses a slot after agents finish)
  const slotsAvailable = canAcquireMultiple(concurrency, task.floorId, config.agentTier, config.agentCount);
  if (!slotsAvailable) {
    console.log(`[Council] Skipping council for ${task.taskType} — not enough concurrency slots for ${config.agentCount} agents`);
    return null;
  }

  return {
    agentCount: config.agentCount,
    agentTier: config.agentTier,
    evaluatorTier: config.evaluatorTier,
    personas: config.personas,
    evaluationCriteria: config.evaluationCriteria,
  };
}

/**
 * Check if N slots can be acquired for the given tier/floor.
 * Doesn't actually acquire — just checks feasibility.
 */
function canAcquireMultiple(
  concurrency: ConcurrencyManager,
  floorId: string,
  tier: ModelTier,
  count: number,
): boolean {
  // Simple check: current active + count must be within all limits
  const activeTotal = concurrency.getActiveCount();
  const activeTier = concurrency.getCountByTier(tier);
  const activeFloor = concurrency.getCountByFloor(floorId);

  // Check against limits (using default values — ConcurrencyManager doesn't expose limits directly)
  // These match DEFAULT_CONCURRENCY from config/types.ts
  const MAX_AGENTS = 4;
  const MAX_PER_FLOOR = 3;
  const tierLimits: Record<string, number> = { opus: 2, sonnet: 3, haiku: 5 };
  const maxTier = tierLimits[tier] ?? 3;

  return (
    activeTotal + count <= MAX_AGENTS &&
    activeTier + count <= maxTier &&
    activeFloor + count <= MAX_PER_FLOOR
  );
}

/** Get list of task types that support council mode (for dashboard display). */
export function getCouncilEligibleTaskTypes(): string[] {
  return Object.keys(COUNCIL_CONFIGS);
}
