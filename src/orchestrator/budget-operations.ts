/**
 * BudgetOperations — Extracted budget management methods from Orchestrator.
 * Handles budget queries, investigations, and financial planning.
 */

import type { BudgetEnforcer } from '../security/budget-enforcer.js';
import type { Floor } from '../config/types.js';

export interface BudgetStatus {
  spentCents: number;
  ceilingCents: number;
  remaining: number;
  percentUsed: number;
  healthStatus: 'healthy' | 'warning' | 'critical';
}

export class BudgetOperations {
  constructor(private budgetEnforcer: BudgetEnforcer) {}

  /** Get the budget status for a floor. */
  getStatus(floorId: string): BudgetStatus | null {
    const status = this.budgetEnforcer.getStatus(floorId);
    if (!status) return null;

    return {
      spentCents: status.spentCents,
      ceilingCents: status.ceilingCents,
      remaining: this.budgetEnforcer.getRemaining(floorId),
      percentUsed: status.percentUsed,
      healthStatus: this.determineHealthStatus(status.percentUsed),
    };
  }

  /** Get remaining budget in cents. */
  getRemaining(floorId: string): number {
    return this.budgetEnforcer.getRemaining(floorId);
  }

  /** Check if a floor can afford a cost. */
  canAfford(floorId: string, estimatedCostCents: number): boolean {
    const result = this.budgetEnforcer.canAfford(floorId, estimatedCostCents);
    return result.allowed;
  }

  /** Record a cost and update budget. */
  recordCost(floorId: string, costCents: number): void {
    this.budgetEnforcer.recordCost(floorId, costCents);
  }

  /** Update the budget ceiling for a floor. */
  updateCeiling(floorId: string, newCeilingCents: number): void {
    this.budgetEnforcer.updateCeiling(floorId, newCeilingCents);
  }

  /** Investigate budget status for a floor. */
  investigate(floor: Floor): {
    spent: number;
    ceiling: number;
    remaining: number;
    percentUsed: number;
    taskCount: number;
    avgCostPerTask: number;
    recommendation: string;
  } {
    const status = this.budgetEnforcer.getStatus(floor.id);
    if (!status) {
      return {
        spent: 0,
        ceiling: floor.budgetCeilingCents,
        remaining: floor.budgetCeilingCents,
        percentUsed: 0,
        taskCount: 0,
        avgCostPerTask: 0,
        recommendation: 'Budget tracking not initialized',
      };
    }

    const remaining = this.budgetEnforcer.getRemaining(floor.id);
    const recommendation = this.getRecommendation(status.percentUsed, remaining);

    return {
      spent: status.spentCents,
      ceiling: status.ceilingCents,
      remaining,
      percentUsed: status.percentUsed,
      taskCount: 0, // Would need task manager context to calculate
      avgCostPerTask: 0, // Would need cost history to calculate
      recommendation,
    };
  }

  /** Get health status based on budget utilization. */
  private determineHealthStatus(percentUsed: number): 'healthy' | 'warning' | 'critical' {
    if (percentUsed >= 100) return 'critical';
    if (percentUsed >= 75) return 'warning';
    return 'healthy';
  }

  /** Get budget management recommendation. */
  private getRecommendation(percentUsed: number, remaining: number): string {
    if (percentUsed >= 100) {
      return 'Budget exceeded. Floor operations are paused. Increase budget or archive this floor.';
    }
    if (percentUsed >= 90) {
      return 'Critical: Only 10% budget remaining. Plan for completion or request increase.';
    }
    if (percentUsed >= 75) {
      return 'Warning: 25% budget remaining. Monitor spend closely.';
    }
    if (percentUsed >= 50) {
      return 'Halfway through budget. Pace spending to complete planned tasks.';
    }
    return 'Budget healthy. Continue normal operations.';
  }
}
