/**
 * Safety Controls — Kill Switch, Circuit Breaker, and Runaway Detection.
 *
 * Kill Switch: Instantly pauses everything for a floor (one tap).
 * Circuit Breaker: Auto-pauses if spend exceeds 150% of daily budget.
 * Runaway Detection: Pauses if 50 turns on one task, or 3 repeated identical actions.
 */

import type { EventBus } from '../orchestrator/event-bus.js';

interface FloorSafetyState {
  floorId: string;
  killed: boolean;
  circuitBroken: boolean;
  dailyBudgetCents: number;
  dailySpentCents: number;
  dayStartedAt: Date;
  taskTurnCounts: Map<string, number>;
  recentActions: string[]; // Last N action hashes for repeat detection
}

const CIRCUIT_BREAKER_MULTIPLIER = 1.5;
const MAX_TURNS_PER_TASK = 50;
const MAX_REPEATED_ACTIONS = 3;
const RECENT_ACTIONS_WINDOW = 10;

export class SafetyControls {
  private states = new Map<string, FloorSafetyState>();

  constructor(private eventBus: EventBus) {
    this.eventBus.on('cost:recorded', (data) => {
      this.recordDailySpend(data.floorId, data.costCents);
    });
  }

  /** Initialize safety state for a floor. */
  initFloor(floorId: string, dailyBudgetCents: number): void {
    this.states.set(floorId, {
      floorId,
      killed: false,
      circuitBroken: false,
      dailyBudgetCents,
      dailySpentCents: 0,
      dayStartedAt: new Date(),
      taskTurnCounts: new Map(),
      recentActions: [],
    });
  }

  // --- Kill Switch ---

  /** Instantly pause all work for a floor. */
  killFloor(floorId: string): void {
    const state = this.states.get(floorId);
    if (state) {
      state.killed = true;
      this.eventBus.emit('floor:status-changed', { floorId, status: 'paused' });
    }
  }

  /** Resume a killed floor. */
  resumeFloor(floorId: string): void {
    const state = this.states.get(floorId);
    if (state) {
      state.killed = false;
      state.circuitBroken = false;
    }
  }

  removeFloor(floorId: string): void {
    this.states.delete(floorId);
  }

  // --- Circuit Breaker ---

  private recordDailySpend(floorId: string, costCents: number): void {
    const state = this.states.get(floorId);
    if (!state) return;

    // Reset daily counter if new day
    const now = new Date();
    if (now.toDateString() !== state.dayStartedAt.toDateString()) {
      state.dailySpentCents = 0;
      state.dayStartedAt = now;
    }

    state.dailySpentCents += costCents;

    // Circuit breaker: 150% of daily budget
    if (state.dailySpentCents > state.dailyBudgetCents * CIRCUIT_BREAKER_MULTIPLIER) {
      state.circuitBroken = true;
      this.eventBus.emit('floor:status-changed', { floorId, status: 'paused' });
      console.warn(`[Circuit Breaker] Floor ${floorId}: daily spend ${state.dailySpentCents}¢ > ${state.dailyBudgetCents * CIRCUIT_BREAKER_MULTIPLIER}¢ limit`);
    }
  }

  // --- Runaway Detection ---

  /** Record a task turn and check for runaway. Returns true if runaway detected. */
  recordTaskTurn(floorId: string, taskId: string, actionHash: string): boolean {
    const state = this.states.get(floorId);
    if (!state) return false;

    // Turn count check
    const turns = (state.taskTurnCounts.get(taskId) ?? 0) + 1;
    state.taskTurnCounts.set(taskId, turns);
    if (turns >= MAX_TURNS_PER_TASK) {
      state.killed = true;
      console.warn(`[Runaway] Floor ${floorId}, task ${taskId}: ${turns} turns — pausing`);
      return true;
    }

    // Repeated action check
    state.recentActions.push(actionHash);
    if (state.recentActions.length > RECENT_ACTIONS_WINDOW) {
      state.recentActions.shift();
    }

    const lastN = state.recentActions.slice(-MAX_REPEATED_ACTIONS);
    if (lastN.length === MAX_REPEATED_ACTIONS && lastN.every(a => a === lastN[0])) {
      state.killed = true;
      console.warn(`[Runaway] Floor ${floorId}: ${MAX_REPEATED_ACTIONS} identical actions — pausing`);
      return true;
    }

    return false;
  }

  /** Reset turn count for a specific task (called when owner retries a task). */
  resetTaskTurnCount(floorId: string, taskId: string): void {
    const state = this.states.get(floorId);
    if (state) {
      state.taskTurnCounts.delete(taskId);
    }
  }

  // --- Budget Per Turn Check ---

  /**
   * Check if a single API call would consume > 50% of remaining daily budget.
   * If so, block the call — prevents single expensive operation from exhausting budget.
   */
  checkBudgetPerTurn(floorId: string, estimatedCostCents: number): { allowed: boolean; reason?: string } {
    const state = this.states.get(floorId);
    if (!state) return { allowed: true };

    const remaining = state.dailyBudgetCents - state.dailySpentCents;
    if (remaining <= 0) {
      return { allowed: false, reason: 'Daily budget exhausted' };
    }

    if (estimatedCostCents > remaining * 0.5) {
      return {
        allowed: false,
        reason: `Single call cost (${estimatedCostCents}¢) > 50% of remaining daily budget (${remaining}¢)`,
      };
    }

    return { allowed: true };
  }

  // --- Per-Agent Spawn Limit ---

  private agentSpawnCounts = new Map<string, number>();

  /** Check if an agent can spawn more sub-agents (max 3 per agent). */
  canSpawnSubAgent(floorId: string, agentId: string): boolean {
    const key = `${floorId}:${agentId}`;
    return (this.agentSpawnCounts.get(key) ?? 0) < 3;
  }

  /** Increment spawn count when sub-agent created. */
  recordSpawn(floorId: string, agentId: string): void {
    const key = `${floorId}:${agentId}`;
    this.agentSpawnCounts.set(key, (this.agentSpawnCounts.get(key) ?? 0) + 1);
  }

  /** Decrement spawn count when sub-agent completes. */
  recordSpawnComplete(floorId: string, agentId: string): void {
    const key = `${floorId}:${agentId}`;
    const count = this.agentSpawnCounts.get(key) ?? 0;
    this.agentSpawnCounts.set(key, Math.max(0, count - 1));
  }

  // --- Query ---

  /** Check if a floor is safe to dispatch work. */
  canDispatch(floorId: string): { allowed: boolean; reason?: string } {
    const state = this.states.get(floorId);
    if (!state) return { allowed: true };

    if (state.killed) {
      return { allowed: false, reason: 'Floor is killed (manual pause)' };
    }
    if (state.circuitBroken) {
      return { allowed: false, reason: 'Circuit breaker tripped (daily spend exceeded 150%)' };
    }
    return { allowed: true };
  }

  isKilled(floorId: string): boolean {
    return this.states.get(floorId)?.killed ?? false;
  }

  isCircuitBroken(floorId: string): boolean {
    return this.states.get(floorId)?.circuitBroken ?? false;
  }
}
