/**
 * BudgetEnforcer — tracks costs per floor and blocks dispatch when budget exceeded.
 * Alerts at 50%, 75%, 90% thresholds.
 */

import type { EventBus } from '../orchestrator/event-bus.js';

interface FloorBudget {
  floorId: string;
  ceilingCents: number;
  spentCents: number;
  alertsSent: Set<number>; // thresholds already alerted
}

const ALERT_THRESHOLDS = [0.5, 0.75, 0.9];

export class BudgetEnforcer {
  private budgets = new Map<string, FloorBudget>();

  constructor(private eventBus: EventBus) {
    this.eventBus.on('cost:recorded', (data) => {
      this.recordCost(data.floorId, data.costCents);
    });
  }

  /** Initialize budget tracking for a floor. */
  initFloor(floorId: string, ceilingCents: number, recoveredSpentCents = 0): void {
    this.budgets.set(floorId, {
      floorId,
      ceilingCents,
      spentCents: recoveredSpentCents,
      alertsSent: new Set(),
    });
  }

  /** Check if a dispatch is within budget. */
  canAfford(floorId: string, estimatedCostCents: number): { allowed: boolean; reason?: string } {
    const budget = this.budgets.get(floorId);
    if (!budget) return { allowed: true }; // No budget tracking = no limit

    if (budget.spentCents + estimatedCostCents > budget.ceilingCents) {
      return {
        allowed: false,
        reason: `Budget exceeded: spent ${budget.spentCents}¢ + estimated ${estimatedCostCents}¢ > ceiling ${budget.ceilingCents}¢`,
      };
    }

    return { allowed: true };
  }

  /** Record a cost and check alert thresholds. */
  recordCost(floorId: string, costCents: number): void {
    const budget = this.budgets.get(floorId);
    if (!budget) return;

    budget.spentCents += costCents;

    // Check thresholds
    const ratio = budget.spentCents / budget.ceilingCents;
    for (const threshold of ALERT_THRESHOLDS) {
      if (ratio >= threshold && !budget.alertsSent.has(threshold)) {
        budget.alertsSent.add(threshold);
        this.eventBus.emit('budget:alert', {
          floorId,
          threshold,
          spentCents: budget.spentCents,
          ceilingCents: budget.ceilingCents,
        });
      }
    }

    // Check if budget exceeded
    if (budget.spentCents >= budget.ceilingCents) {
      this.eventBus.emit('budget:exceeded', {
        floorId,
        spentCents: budget.spentCents,
        ceilingCents: budget.ceilingCents,
      });
    }
  }

  /** Get budget status for a floor. */
  getStatus(floorId: string): { spentCents: number; ceilingCents: number; percentUsed: number } | null {
    const budget = this.budgets.get(floorId);
    if (!budget) return null;
    return {
      spentCents: budget.spentCents,
      ceilingCents: budget.ceilingCents,
      percentUsed: Math.round((budget.spentCents / budget.ceilingCents) * 100),
    };
  }

  removeFloor(floorId: string): void {
    this.budgets.delete(floorId);
  }

  /** Get remaining budget for a floor in cents. */
  getRemaining(floorId: string): number {
    const budget = this.budgets.get(floorId);
    return budget ? Math.max(0, budget.ceilingCents - budget.spentCents) : 0;
  }

  /**
   * Persist a cost event to Supabase cost_events table.
   * Fire-and-forget — failures don't block execution.
   */
  async persistCostEvent(floorId: string, taskId: string, agentId: string, costCents: number): Promise<void> {
    try {
      const { getSupabase } = await import('../integrations/supabase.js');
      const sb = getSupabase();
      if (!sb) return;
      await sb.from('cost_events').insert({
        floor_id: floorId,
        task_id: taskId,
        agent_id: agentId,
        amount_cents: Math.round(costCents),
        recorded_at: new Date().toISOString(),
      });
    } catch {
      // Non-critical — cost is tracked in-memory regardless
    }
  }

  /** Update the ceiling for a floor (e.g., owner increases budget). */
  updateCeiling(floorId: string, newCeilingCents: number): void {
    const budget = this.budgets.get(floorId);
    if (budget) {
      budget.ceilingCents = newCeilingCents;
      // Reset alerts if ceiling increased past current spent
      budget.alertsSent.clear();
    }
  }
}
