/**
 * Pre-call budget validation for API clients.
 * Throws BudgetExceededError if a floor can't afford the estimated cost.
 */

export class BudgetExceededError extends Error {
  constructor(public floorId: string, public estimatedCents: number, reason: string) {
    super(`Budget exceeded for floor ${floorId}: ${reason}`);
    this.name = 'BudgetExceededError';
  }
}

// Singleton reference — set by Orchestrator at boot
let budgetEnforcer: { canAfford(floorId: string, cents: number): { allowed: boolean; reason?: string } } | null = null;

export function setBudgetEnforcer(enforcer: typeof budgetEnforcer): void {
  budgetEnforcer = enforcer;
}

/**
 * Check if a floor can afford an API call. Throws BudgetExceededError if not.
 * If no enforcer is configured (e.g. during tests), silently allows.
 */
export function checkBudget(floorId: string, estimatedCents: number): void {
  if (!budgetEnforcer || !floorId) return;
  const result = budgetEnforcer.canAfford(floorId, estimatedCents);
  if (!result.allowed) {
    throw new BudgetExceededError(floorId, estimatedCents, result.reason ?? 'Budget exceeded');
  }
}
