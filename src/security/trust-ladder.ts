/**
 * Trust Ladder — 4 levels controlling auto-approval vs human review.
 *
 * Level 1: Training Wheels — everything needs owner approval
 * Level 2: Supervised — routine tasks auto-approved, strategic needs review
 * Level 3: Autonomous — most tasks auto-approved, only budget/launch gates need review
 * Level 4: Full Autonomy — only immutable-rule gates need review
 *
 * Transition rules: Floors advance based on approval rate and time.
 */

import type { EventBus } from '../orchestrator/event-bus.js';
import { saveTrustState, loadTrustState, persistWithRetry, type TrustStateRecord } from '../integrations/supabase.js';

export type TrustLevel = 1 | 2 | 3 | 4;

interface TrustState {
  floorId: string;
  level: TrustLevel;
  totalApprovals: number;
  totalRejections: number;
  consecutiveApprovals: number;
  lastLevelChange: Date;
}

// What needs human approval at each level
const APPROVAL_REQUIREMENTS: Record<TrustLevel, {
  autoApprove: string[];
  needsReview: string[];
}> = {
  1: {
    autoApprove: [],
    needsReview: ['all'], // Everything needs review
  },
  2: {
    autoApprove: ['routine-copy', 'routine-analytics', 'social-post', 'product-description'],
    needsReview: ['foundation', 'strategy', 'budget', 'launch', 'ads-campaign', 'brand-change'],
  },
  3: {
    autoApprove: ['routine-copy', 'routine-analytics', 'social-post', 'product-description',
                  'strategy', 'design', 'email-sequence', 'website-update'],
    needsReview: ['foundation-gate', 'launch-gate', 'ads-gate', 'budget-increase', 'brand-change'],
  },
  4: {
    autoApprove: ['routine-copy', 'routine-analytics', 'social-post', 'product-description',
                  'strategy', 'design', 'email-sequence', 'website-update',
                  'ads-campaign', 'budget-reallocation'],
    needsReview: ['foundation-gate', 'launch-gate', 'ads-gate', 'brand-change'], // Only immutable gates
  },
};

// Requirements to advance to next level
const ADVANCE_REQUIREMENTS: Record<TrustLevel, { approvalRate: number; minApprovals: number; minDays: number }> = {
  1: { approvalRate: 0.90, minApprovals: 10, minDays: 3 },
  2: { approvalRate: 0.90, minApprovals: 25, minDays: 7 },
  3: { approvalRate: 0.95, minApprovals: 50, minDays: 14 },
  4: { approvalRate: 1.0, minApprovals: Infinity, minDays: Infinity }, // Can't advance past 4
};

export class TrustLadder {
  private states = new Map<string, TrustState>();

  constructor(private eventBus: EventBus) {}

  /** Initialize trust for a new floor (always starts at level 1). */
  initFloor(floorId: string): void {
    this.states.set(floorId, {
      floorId,
      level: 1,
      totalApprovals: 0,
      totalRejections: 0,
      consecutiveApprovals: 0,
      lastLevelChange: new Date(),
    });
  }

  /** Check if a task type needs human approval at the current trust level. */
  needsApproval(floorId: string, taskType: string): boolean {
    const state = this.states.get(floorId);
    if (!state) return true; // Default to requiring approval

    const reqs = APPROVAL_REQUIREMENTS[state.level];
    if (reqs.needsReview.includes('all')) return true;
    if (reqs.autoApprove.includes(taskType)) return false;
    return reqs.needsReview.includes(taskType);
  }

  /** Record an approval. Does NOT auto-promote — only owners promote via promoteFloor(). */
  recordApproval(floorId: string): void {
    const state = this.states.get(floorId);
    if (!state) return;

    state.totalApprovals++;
    state.consecutiveApprovals++;
    this.persistState(floorId);
    // Spec: EVE NEVER self-promotes. Only the owner promotes via API.
  }

  /** Record a rejection — resets consecutive approvals. */
  recordRejection(floorId: string): void {
    const state = this.states.get(floorId);
    if (!state) return;

    state.totalRejections++;
    state.consecutiveApprovals = 0;

    // Demote if rejection rate exceeds threshold
    const total = state.totalApprovals + state.totalRejections;
    const rejectionRate = state.totalRejections / total;
    if (rejectionRate > 0.3 && state.level > 1) {
      state.level = (state.level - 1) as TrustLevel;
      state.lastLevelChange = new Date();
    }
    this.persistState(floorId);
  }

  /** Demote to Level 1 on financial loss (ROI < 0). */
  recordFinancialLoss(floorId: string): void {
    const state = this.states.get(floorId);
    if (!state || state.level === 1) return;
    state.level = 1;
    state.lastLevelChange = new Date();
    state.consecutiveApprovals = 0;
    this.persistState(floorId);
  }

  /** Demote to Level 2 on budget overrun. */
  recordBudgetOverrun(floorId: string): void {
    const state = this.states.get(floorId);
    if (!state || state.level <= 2) return;
    state.level = 2;
    state.lastLevelChange = new Date();
    state.consecutiveApprovals = 0;
    this.persistState(floorId);
  }

  /** Demote one level if an improvement proposal causes regression. */
  recordImprovementRegression(floorId: string): void {
    const state = this.states.get(floorId);
    if (!state || state.level === 1) return;
    state.level = (state.level - 1) as TrustLevel;
    state.lastLevelChange = new Date();
    this.persistState(floorId);
  }

  /**
   * Check if a floor is eligible for promotion (read-only).
   * Returns the reasons why it can or cannot advance.
   */
  checkCanPromote(floorId: string): { eligible: boolean; reason: string } {
    const state = this.states.get(floorId);
    if (!state) return { eligible: false, reason: 'Floor not found' };
    if (state.level >= 4) return { eligible: false, reason: 'Already at maximum level' };

    const reqs = ADVANCE_REQUIREMENTS[state.level];
    const total = state.totalApprovals + state.totalRejections;
    const approvalRate = total > 0 ? state.totalApprovals / total : 0;
    const daysSinceChange = (Date.now() - state.lastLevelChange.getTime()) / (1000 * 60 * 60 * 24);

    const issues: string[] = [];
    if (approvalRate < reqs.approvalRate) issues.push(`approval rate ${Math.round(approvalRate * 100)}% < ${reqs.approvalRate * 100}% required`);
    if (state.totalApprovals < reqs.minApprovals) issues.push(`${state.totalApprovals} approvals < ${reqs.minApprovals} required`);
    if (daysSinceChange < reqs.minDays) issues.push(`${Math.round(daysSinceChange)} days < ${reqs.minDays} days required`);

    if (issues.length === 0) return { eligible: true, reason: 'All requirements met' };
    return { eligible: false, reason: issues.join('; ') };
  }

  /**
   * Promote a floor to the next trust level — owner action only.
   * Returns false if requirements are not met or already at max.
   */
  promoteFloor(floorId: string): boolean {
    const state = this.states.get(floorId);
    if (!state || state.level >= 4) return false;

    const { eligible } = this.checkCanPromote(floorId);
    if (!eligible) return false;

    state.level = (state.level + 1) as TrustLevel;
    state.lastLevelChange = new Date();
    this.persistState(floorId);
    return true;
  }

  /** Manual demotion by owner — can go to any lower level. */
  demoteTo(floorId: string, level: TrustLevel): boolean {
    const state = this.states.get(floorId);
    if (!state) return false;
    if (level >= state.level) return false; // Can only demote, not promote here
    state.level = level;
    state.lastLevelChange = new Date();
    state.consecutiveApprovals = 0;
    this.persistState(floorId);
    return true;
  }

  getLevel(floorId: string): TrustLevel {
    return this.states.get(floorId)?.level ?? 1;
  }

  getState(floorId: string): TrustState | undefined {
    return this.states.get(floorId);
  }

  removeFloor(floorId: string): void {
    this.states.delete(floorId);
  }

  /** Restore trust state from persistence (call during boot). */
  async restoreFloor(floorId: string): Promise<void> {
    const saved = await loadTrustState(floorId);
    if (!saved) return;
    this.states.set(floorId, {
      floorId,
      level: (saved.level as TrustLevel) || 1,
      totalApprovals: saved.totalApprovals || 0,
      totalRejections: saved.totalRejections || 0,
      consecutiveApprovals: saved.consecutiveApprovals || 0,
      lastLevelChange: new Date(saved.lastLevelChange || Date.now()),
    });
    if (saved.level > 1) {
      console.log(`  [TrustLadder] Restored ${floorId.slice(0, 8)} at Level ${saved.level}`);
    }
  }

  /** Persist current state for a floor. */
  private persistState(floorId: string): void {
    const state = this.states.get(floorId);
    if (!state) return;
    const record: TrustStateRecord = {
      floorId,
      level: state.level,
      totalApprovals: state.totalApprovals,
      totalRejections: state.totalRejections,
      consecutiveApprovals: state.consecutiveApprovals,
      lastLevelChange: state.lastLevelChange.toISOString(),
    };
    persistWithRetry(() => saveTrustState(record), `trust:${floorId.slice(0, 8)}`);
  }
}
