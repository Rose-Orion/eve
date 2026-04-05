/**
 * ConcurrencyManager — enforces rate limiting and parallel dispatch constraints.
 * Max 4 agents, max 2 Opus, min 2s between dispatches.
 */

import type { AgentId, ConcurrencyLimits, ModelTier } from '../config/types.js';
import { DEFAULT_CONCURRENCY } from '../config/types.js';

export interface ActiveSlot {
  taskId: string;
  floorId: string;
  agentId: AgentId;
  modelTier: ModelTier;
  startedAt: Date;
}

export class ConcurrencyManager {
  private active = new Map<string, ActiveSlot>();
  private lastDispatchAt = 0;
  private limits: ConcurrencyLimits;

  constructor(limits?: Partial<ConcurrencyLimits>) {
    this.limits = { ...DEFAULT_CONCURRENCY, ...limits };
  }

  /**
   * Check if a new dispatch is allowed given current state.
   * Returns { allowed, reason } — reason explains why if blocked.
   */
  canDispatch(
    floorId: string,
    modelTier: ModelTier,
  ): { allowed: boolean; reason?: string } {
    // Global agent limit
    if (this.active.size >= this.limits.maxConcurrentAgents) {
      return { allowed: false, reason: `Global limit reached (${this.limits.maxConcurrentAgents} agents)` };
    }

    // Model tier limit
    const tierCount = this.getCountByTier(modelTier);
    const tierLimit = this.getTierLimit(modelTier);
    if (tierCount >= tierLimit) {
      return { allowed: false, reason: `${modelTier} limit reached (${tierLimit})` };
    }

    // Floor limit
    const floorCount = this.getCountByFloor(floorId);
    if (floorCount >= this.limits.maxAgentsPerFloor) {
      return { allowed: false, reason: `Floor limit reached (${this.limits.maxAgentsPerFloor})` };
    }

    // Rate limit cooldown
    const now = Date.now();
    const elapsed = now - this.lastDispatchAt;
    if (elapsed < this.limits.minDelayBetweenDispatchMs) {
      const waitMs = this.limits.minDelayBetweenDispatchMs - elapsed;
      return { allowed: false, reason: `Rate limit: wait ${waitMs}ms` };
    }

    return { allowed: true };
  }

  /** Reserve a dispatch slot. Call when actually dispatching. */
  acquire(taskId: string, floorId: string, agentId: AgentId, modelTier: ModelTier): void {
    this.active.set(taskId, {
      taskId,
      floorId,
      agentId,
      modelTier,
      startedAt: new Date(),
    });
    this.lastDispatchAt = Date.now();
  }

  /** Release a dispatch slot when task completes or fails. */
  release(taskId: string): void {
    this.active.delete(taskId);
  }

  /** Get time to wait before next dispatch is allowed (ms). Returns 0 if immediate. */
  getWaitTime(): number {
    const elapsed = Date.now() - this.lastDispatchAt;
    const remaining = this.limits.minDelayBetweenDispatchMs - elapsed;
    return Math.max(0, remaining);
  }

  // --- Queries ---

  getActiveCount(): number {
    return this.active.size;
  }

  getCountByTier(tier: ModelTier): number {
    let count = 0;
    for (const slot of this.active.values()) {
      if (slot.modelTier === tier) count++;
    }
    return count;
  }

  getCountByFloor(floorId: string): number {
    let count = 0;
    for (const slot of this.active.values()) {
      if (slot.floorId === floorId) count++;
    }
    return count;
  }

  getActiveSlots(): ActiveSlot[] {
    return [...this.active.values()];
  }

  /**
   * Release slots held longer than maxAgeMs (default 10 minutes).
   * Returns taskIds of reaped slots so caller can fail the tasks.
   */
  reapStale(maxAgeMs = 10 * 60 * 1000): string[] {
    const now = Date.now();
    const reaped: string[] = [];
    for (const [taskId, slot] of this.active) {
      if (now - slot.startedAt.getTime() > maxAgeMs) {
        console.warn(`[Concurrency] Releasing stale slot: task ${taskId.slice(0, 8)} (${slot.agentId}) held for ${Math.round((now - slot.startedAt.getTime()) / 60000)}m`);
        this.active.delete(taskId);
        reaped.push(taskId);
      }
    }
    return reaped;
  }

  private getTierLimit(tier: ModelTier): number {
    switch (tier) {
      case 'opus': return this.limits.maxConcurrentOpus;
      case 'sonnet': return this.limits.maxConcurrentSonnet;
      case 'haiku': return this.limits.maxConcurrentHaiku;
    }
  }
}
