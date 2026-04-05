/**
 * DispatchEngine — Extracted dispatch logic from Orchestrator.
 * Handles task dispatching to virtual and real agents, dispatch routing, and error handling.
 */

import type { Task, Floor } from '../config/types.js';

export interface DispatchEngineState {
  running: boolean;
  rateLimitBackoffMs: number;
  rateLimitSince: number;
}

export interface DispatchResult {
  success: boolean;
  taskId: string;
  dispatchType: 'virtual' | 'real' | 'council';
  error?: string;
  timestamp: Date;
}

export class DispatchEngine {
  constructor(private state: DispatchEngineState) {}

  /** Check if the engine is running. */
  isRunning(): boolean {
    return this.state.running;
  }

  /** Set running state. */
  setRunning(running: boolean): void {
    this.state.running = running;
  }

  /** Get current rate limit backoff in milliseconds. */
  getRateLimitBackoff(): number {
    return this.state.rateLimitBackoffMs;
  }

  /** Set rate limit backoff. */
  setRateLimitBackoff(ms: number): void {
    this.state.rateLimitBackoffMs = ms;
  }

  /** Get time when rate limiting started. */
  getRateLimitSince(): number {
    return this.state.rateLimitSince;
  }

  /** Set rate limit start time. */
  setRateLimitSince(ts: number): void {
    this.state.rateLimitSince = ts;
  }

  /** Check if currently rate-limited. */
  isRateLimited(): boolean {
    if (this.state.rateLimitBackoffMs === 0) return false;
    const elapsed = Date.now() - this.state.rateLimitSince;
    return elapsed < this.state.rateLimitBackoffMs;
  }

  /** Record a dispatch result. */
  recordDispatch(result: DispatchResult): void {
    console.log(
      `[Dispatch] ${result.dispatchType.toUpperCase()} task ${result.taskId.slice(0, 8)} - ${result.success ? 'SUCCESS' : `FAILED: ${result.error}`}`
    );
  }

  /** Extract dispatch type from task. Returns 'virtual', 'real', or 'council'. */
  determineDispatchType(task: Task, floor: Floor): 'virtual' | 'real' | 'council' {
    // Virtual agents: copy, brand, strategy, finance, design, video, commerce, social, ads, analytics
    const virtualAgents = [
      'copy-agent', 'brand-agent', 'strategy-agent', 'finance-agent',
      'design-agent', 'video-agent', 'commerce-agent', 'social-agent',
      'ads-agent', 'analytics-agent',
    ];

    if (virtualAgents.includes(task.assignedAgent)) {
      return 'virtual';
    }

    // Council dispatcher is used for specific task types
    if (task.taskType?.includes('council') || task.taskType?.includes('decision')) {
      return 'council';
    }

    // Everything else goes to real agents via OpenClaw
    return 'real';
  }
}
