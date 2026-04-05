/**
 * EventBus — Internal pub/sub event system for the Orchestrator.
 * All inter-component communication flows through here.
 */

import { EventEmitter } from 'node:events';
import type { AgentId, TaskStatus } from '../config/types.js';
import type { ParsedOutput } from './output-parser.js';

export interface TaskLifecycleEvent {
  taskId: string;
  floorId: string;
  queueState: 'pending' | 'scheduled' | 'failed' | 'completed';
  reexecutionOccurred: boolean;
  reexecutionOutcome: 'success' | 'failure' | 'pending' | null;
  taskType?: string;
  agentId?: AgentId;
  phaseNumber?: number;
  trigger?: string;
  timestamp: string;
}

export interface EVEEvents {
  'task:created': { taskId: string; floorId: string; agentId: AgentId };
  'task:queued': { taskId: string; floorId: string };
  'task:dispatched': { taskId: string; floorId: string; agentId: AgentId };
  'task:completed': { taskId: string; floorId: string; agentId: AgentId; result: string };
  'task:failed': { taskId: string; floorId: string; agentId: AgentId; error: string; attempt: number };
  'task:status-changed': { taskId: string; floorId: string; from: TaskStatus; to: TaskStatus };
  'task:lifecycle-event': TaskLifecycleEvent;
  /**
   * Structured pre-completion event emitted BEFORE any task is marked 'complete'.
   * Payload matches the system-learnings specification:
   *   { task_id, status, timestamp, result_summary }
   * Floor-manager verification loops consume this event to resolve task state
   * without exhausting retry cycles.
   */
  'task:queue-status': {
    taskId: string;
    floorId: string;
    agentId: AgentId;
    payload: {
      task_id: string;
      status: 'complete' | 'failed' | 'partial';
      timestamp: string;
      result_summary: string;
    };
  };
  'task:review-needed': { taskId: string; floorId: string; reviewerAgent: AgentId };
  'agent:output-detected': { taskId: string; floorId: string; filePath: string };
  'agent:status-changed': { floorId: string; agentId: AgentId; status: string };
  'agent:heartbeat': { floorId: string; agentId: AgentId };
  'floor:created': { floorId: string; slug: string };
  'floor:phase-complete': { floorId: string; phase: number };
  'floor:status-changed': { floorId: string; status: string; brandState?: string; currentPhase?: number };
  'floor:phase-started': { floorId: string; phase: number };
  'approval:needed': { floorId: string; taskId: string; type: string; summary?: string; systemWide?: boolean };
  'approval:received': { floorId: string; taskId: string; approved: boolean; feedback?: string };
  'feedback:applied': { floorId: string; feedbackId: string; action: string | null; systemWide?: boolean };
  'dashboard:patched': { floorId: string; patchId: string; applied: number; failed: number };
  'budget:alert': { floorId: string; threshold: number; spentCents: number; ceilingCents: number };
  'budget:exceeded': { floorId: string; spentCents: number; ceilingCents: number };
  'cost:recorded': { floorId: string; taskId: string; costCents: number };
  'media:generated': { floorId: string; taskId: string; type: 'image' | 'video' | 'audio'; url: string };
  'task:actions-executed': { floorId: string; taskId: string; agent: string; summary: { executed: number; pending: number; failed: number; costCents: number } };
  'order:created': { floorId: string; orderId: string; customerEmail: string; customerName: string; amountCents: number; lineItems: Array<{ description?: string; quantity?: number; amount_total?: number }>; shippingAddress: { city?: string; country?: string; line1?: string; line2?: string; postal_code?: string; state?: string } | null; paymentIntentId: string };
  'deployment:completed': { floorId: string; deploymentId: string; url: string; projectName: string };
  'token:refreshed': { provider: string; floorId: string };
  'token:refresh-failed': { provider: string; floorId: string; error: string };
  'security:pii-detected': { floorId: string; taskId: string; agentId: AgentId; violations: string[] };
  'webhook:meta': { field: string; value: unknown };
  'webhook:tiktok': { event: string; data: unknown };
  'webhook:printful': { type: string; data: unknown };
  'output:parsed': { taskId: string; floorId: string; parsed: ParsedOutput };
  'ads:daily-report': { floorId: string; summary: string; actionsExecuted: string[] };
  'ads:paused': { floorId: string; campaignId: string; reason: string };
  'ads:scaled': { floorId: string; campaignId: string; budgetMultiplier: number };
  'ads:fatigue-detected': { floorId: string; adSetId: string; reason: string; action?: string };
  'ads:winner-recorded': { floorId: string; type: string; roas: number };
  'engagement:comment-received': { commentId: string; floorId: string; author: string; text: string };
  'engagement:response-sent': { commentId: string; floorId: string; author: string; response: string };
  'engagement:escalated': { commentId: string; floorId: string; reason: string };
  'social:metrics-collected': { floorId: string; count: number; period: string };
  'social:top-performer': { floorId: string; postId: string; engagementRate: number };
  'social:boost-suggested': { floorId: string; postId: string; reason: string; suggestedBudgetCents: number };
  'social:weekly-report': { floorId: string; summary: string; topPostCount: number };
  'cart:tracked': { floorId: string; email: string; firstName: string; trigger: string; metadata?: Record<string, string> };
  'cart:abandoned': { floorId: string; email: string; firstName: string; trigger: string; metadata?: Record<string, string> };
  'cart:converted': { floorId: string; email: string; firstName: string; trigger: string; metadata?: Record<string, string> };
  'subscriber:segmented': { floorId: string; email: string; firstName: string; trigger: string; metadata?: Record<string, string> };
  'subscriber:vip-promoted': { floorId: string; email: string; firstName: string; trigger: string; metadata?: Record<string, string> };
  'subscriber:at-risk': { floorId: string; email: string; firstName: string; trigger: string; metadata?: Record<string, string> };
  'creative:routed': { floorId: string; taskId: string; model: string; provider: 'fal' | 'openai'; reason: string };
  'creative:generated': { floorId: string; taskId: string; count: number; costCents: number };
  'creative:reviewed': { floorId: string; taskId: string; approvedCount: number; rejectedCount: number };
  'video:produced': { floorId: string; taskId: string; path: 'pathA' | 'pathB'; costCents: number; stepCount: number };
  'ugc:batch-generated': { floorId: string; taskId: string; count: number; costCents: number; styleBreakdown: Array<{ style: string; count: number }> };
}

type EventName = keyof EVEEvents;

export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  emit<E extends EventName>(event: E, data: EVEEvents[E]): void {
    this.emitter.emit(event, data);
  }

  on<E extends EventName>(event: E, handler: (data: EVEEvents[E]) => void): void {
    this.emitter.on(event, handler as (...args: unknown[]) => void);
  }

  once<E extends EventName>(event: E, handler: (data: EVEEvents[E]) => void): void {
    this.emitter.once(event, handler as (...args: unknown[]) => void);
  }

  off<E extends EventName>(event: E, handler: (data: EVEEvents[E]) => void): void {
    this.emitter.off(event, handler as (...args: unknown[]) => void);
  }

  /** Wait for an event with optional timeout. */
  waitFor<E extends EventName>(event: E, timeoutMs?: number): Promise<EVEEvents[E]> {
    return new Promise((resolve, reject) => {
      const handler = (data: EVEEvents[E]) => {
        if (timer) clearTimeout(timer);
        resolve(data);
      };

      let timer: ReturnType<typeof setTimeout> | undefined;
      if (timeoutMs) {
        timer = setTimeout(() => {
          this.off(event, handler);
          reject(new Error(`Timeout waiting for event: ${event}`));
        }, timeoutMs);
      }

      this.once(event, handler);
    });
  }
}
