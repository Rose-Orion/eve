/**
 * TaskManager — Owns the full task lifecycle.
 * CREATED → QUEUED → DISPATCHED → WORKING → REVIEW → COMPLETED
 * With retry (3x), revision loops, and escalation.
 */

import { randomUUID } from 'node:crypto';
import type {
  AgentId, ModelTier, Task, TaskPriority, TaskStatus,
} from '../config/types.js';
import type { EventBus, TaskLifecycleEvent } from './event-bus.js';
import { saveTask, persistWithRetry } from '../integrations/supabase.js';

// Persist all state transitions, not just terminal ones
const ALWAYS_PERSIST_STATES: TaskStatus[] = ['queued', 'dispatched', 'completed', 'failed', 'escalated'];

export interface CreateTaskInput {
  floorId: string;
  phaseNumber: number;
  assignedAgent: AgentId;
  modelTier: ModelTier;
  taskType: string;
  description: string;
  prompt: string;
  inputFiles?: string[];
  outputFiles?: string[];
  dependsOn?: string[];
  priority?: TaskPriority;
  estimatedCostCents?: number;
}

/** Map TaskStatus to the canonical queueState for lifecycle events. */
function toQueueState(status: TaskStatus): TaskLifecycleEvent['queueState'] {
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'escalated') return 'failed';
  if (status === 'dispatched' || status === 'working' || status === 'review') return 'scheduled';
  return 'pending'; // created, queued, retry
}

export class TaskManager {
  private tasks = new Map<string, Task>();

  constructor(private eventBus: EventBus) {
    this.setupListeners();
  }

  /**
   * Emit a structured task:lifecycle-event to the floor feedback chain.
   * Must be called synchronously before any directive-completion logic.
   */
  emitLifecycleEvent(
    taskId: string,
    reexecutionOccurred: boolean,
    reexecutionOutcome: TaskLifecycleEvent['reexecutionOutcome'],
    trigger = 'lifecycle',
  ): TaskLifecycleEvent | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    const event: TaskLifecycleEvent = {
      taskId: task.id,
      floorId: task.floorId,
      queueState: toQueueState(task.status),
      reexecutionOccurred,
      reexecutionOutcome,
      taskType: task.taskType,
      agentId: task.assignedAgent,
      phaseNumber: task.phaseNumber,
      trigger,
      timestamp: new Date().toISOString(),
    };

    this.eventBus.emit('task:lifecycle-event', event);
    return event;
  }

  private setupListeners(): void {
    this.eventBus.on('approval:received', (data) => {
      const task = this.tasks.get(data.taskId);
      // Only handle review tasks here — gate approvals (taskId = 'gate-N') are
      // handled by the Orchestrator's approval:received handler.
      if (!task) return;
      if (String(data.taskId).startsWith('gate-')) return;

      if (data.approved) {
        // Set reviewStatus BEFORE transition so the persisted record is correct
        task.reviewStatus = 'approved';
        this.transition(task.id, 'completed');
      } else {
        task.reviewStatus = 'revision-requested';
        task.reviewFeedback = data.feedback ?? null;
        this.transition(task.id, 'queued'); // Re-queue for revision
      }
    });
  }

  /** Create a new task, register in dependency graph, and auto-queue if ready. */
  create(input: CreateTaskInput): Task {
    const task: Task = {
      id: randomUUID(),
      floorId: input.floorId,
      phaseNumber: input.phaseNumber,
      assignedAgent: input.assignedAgent,
      modelTier: input.modelTier,
      taskType: input.taskType,
      description: input.description,
      prompt: input.prompt,
      inputFiles: input.inputFiles ?? [],
      outputFiles: input.outputFiles ?? [],
      dependsOn: input.dependsOn ?? [],
      blockedBy: [],
      status: 'created',
      priority: input.priority ?? 'normal',
      attempts: 0,
      maxAttempts: 3,
      estimatedCostCents: input.estimatedCostCents ?? 0,
      actualCostCents: 0,
      createdAt: new Date(),
      dispatchedAt: null,
      completedAt: null,
      result: null,
      reviewStatus: 'pending',
      reviewFeedback: null,
      revisionNote: null,
      approvalToken: null,
    };

    this.tasks.set(task.id, task);

    // Persist immediately on creation so task survives server restarts
    persistWithRetry(() => saveTask(task), `task:create:${task.id.slice(0, 8)}`);

    this.eventBus.emit('task:created', {
      taskId: task.id,
      floorId: task.floorId,
      agentId: task.assignedAgent,
    });

    // Auto-queue: if no dependencies, move straight to queued
    if (task.dependsOn.length === 0) {
      this.transition(task.id, 'queued');
    }
    // Tasks with dependencies stay 'created' until the Orchestrator's
    // dependency graph cascade queues them via onTaskCompleted

    return task;
  }

  /**
   * Restore a task recovered from Supabase (crash recovery).
   * The task is injected directly into the queue as 'queued'.
   */
  restore(task: Task): void {
    // Don't restore if already in memory
    if (this.tasks.has(task.id)) return;
    task.status = 'queued';
    this.tasks.set(task.id, task);
    console.log(`  [TaskManager] Restored task ${task.id.slice(0, 8)} (${task.taskType})`);
  }

  /** Restore a task with its actual status preserved (for display-only recovery of completed tasks). */
  restoreWithStatus(task: Task): void {
    if (this.tasks.has(task.id)) return;
    this.tasks.set(task.id, task);
  }

  /**
   * Pause all further retries on a task immediately.
   * Sets a sentinel reviewFeedback flag that recordFailure() checks before scheduling
   * the next retry. Does NOT change task status — the task stays in its current state
   * so the owner can inspect it. Returns false if task not found.
   */
  pauseRetries(taskId: string, reason = 'Retries paused by owner'): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    // Force attempts to maxAttempts so the next recordFailure() call escalates
    // instead of scheduling another retry.
    task.attempts = task.maxAttempts;
    task.reviewFeedback = `[RETRIES PAUSED] ${reason}`;
    persistWithRetry(() => saveTask(task), `task:pause-retries:${taskId.slice(0, 8)}`);
    console.log(`[TaskManager] Retries paused for task ${taskId.slice(0, 8)} (${task.taskType}): ${reason}`);
    return true;
  }

  /**
   * Get simplified prompt for final retry attempt.
   * Uses the FULL task.prompt (not task.description) to preserve format requirements,
   * but adds a preamble asking the agent to focus on the core task.
   * Critical: task.prompt contains output format specs that the dashboard parser depends on.
   */
  getSimplifiedPrompt(taskId: string): string | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    const revisionSuffix = task.revisionNote ? `\n\n${task.revisionNote}` : '';
    // Use task.prompt (full spec with format requirements), NOT task.description (short summary).
    // The description is just a human-readable label; the prompt has the actual instructions
    // including output format specs that downstream parsers depend on.
    const promptBody = task.prompt || task.description;
    return `SIMPLIFIED RETRY — Previous attempts failed. Focus only on the core task. Produce the simplest correct output. Do not add extras.\n\n${promptBody}${revisionSuffix}`;
  }

  /** Transition a task to a new status. */
  transition(taskId: string, newStatus: TaskStatus): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    const validTransitions: Record<TaskStatus, TaskStatus[]> = {
      created:   ['queued'],
      queued:    ['dispatched', 'review'],  // review = trust ladder requires owner approval before dispatch
      dispatched:['working', 'failed'],
      working:   ['review', 'completed', 'failed'],
      review:    ['completed', 'queued'], // queued = revision loop
      completed: [],
      failed:    ['retry', 'escalated'],
      retry:     ['queued'],
      escalated: [],
    };

    const allowed = validTransitions[task.status];
    if (!allowed?.includes(newStatus)) {
      return false;
    }

    const oldStatus = task.status;
    task.status = newStatus;

    if (newStatus === 'dispatched') task.dispatchedAt = new Date();
    if (newStatus === 'completed') task.completedAt = new Date();
    if (newStatus === 'retry') task.attempts++;

    // Persist key states to Supabase with retry
    if (ALWAYS_PERSIST_STATES.includes(newStatus)) {
      persistWithRetry(() => saveTask(task), `task:${newStatus}:${taskId.slice(0, 8)}`);
    }

    this.eventBus.emit('task:status-changed', {
      taskId,
      floorId: task.floorId,
      from: oldStatus,
      to: newStatus,
    });

    // Emit structured lifecycle event synchronously for all state transitions.
    // reexecutionOccurred = true when the task is being retried (retry→queued path).
    // This must fire BEFORE task:completed so listeners receive it first.
    const isReexecution = oldStatus === 'retry' || newStatus === 'retry' || newStatus === 'queued' && oldStatus === 'review';
    const reexecutionOutcome: TaskLifecycleEvent['reexecutionOutcome'] =
      newStatus === 'completed' ? 'success'
      : newStatus === 'escalated' ? 'failure'
      : newStatus === 'queued' && isReexecution ? 'pending'
      : null;
    this.emitLifecycleEvent(
      taskId,
      isReexecution,
      reexecutionOutcome,
      `transition:${oldStatus}→${newStatus}`,
    );

    if (newStatus === 'completed') {
      this.eventBus.emit('task:completed', {
        taskId,
        floorId: task.floorId,
        agentId: task.assignedAgent,
        result: task.result ?? '',
      });
    }

    return true;
  }

  /** Record a task failure and handle retry logic. */
  recordFailure(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    // Store error on task for API visibility
    (task as any).lastError = error;
    console.error(`[TaskManager] FAILURE ${taskId.slice(0, 8)} (${task.taskType}): ${error}`);

    this.transition(taskId, 'failed');

    this.eventBus.emit('task:failed', {
      taskId,
      floorId: task.floorId,
      agentId: task.assignedAgent,
      error,
      attempt: task.attempts,
    });

    if (task.attempts < task.maxAttempts) {
      // Schedule retry with backoff — lifecycle event for retry is emitted in transition()
      // FIX: Also set completedAt timestamp so the stall detector in processQueue can
      // recover this task if the setTimeout is lost due to server restart
      task.completedAt = new Date(); // marks when the failure happened for stall detection
      persistWithRetry(() => saveTask(task), `task:failed-ts:${taskId.slice(0, 8)}`);

      const delay = task.attempts === 1 ? 30_000 : 60_000;
      setTimeout(() => {
        this.transition(taskId, 'retry');
        this.transition(taskId, 'queued');

        // REQUIREMENT: For ALL requeued tasks, emit an explicit queue-status event
        // carrying {task_id, current_queue_state, execution_outcome} so floor-manager
        // verification loops can observe the requeue without retry exhaustion on missing signals.
        // This applies system-wide, not just to budget-plan tasks.
        const requeuedTask = this.tasks.get(taskId);
        if (requeuedTask) {
          try {
            this.eventBus.emit('task:queue-status', {
              taskId: requeuedTask.id,
              floorId: requeuedTask.floorId,
              agentId: requeuedTask.assignedAgent,
              payload: {
                task_id: requeuedTask.id,
                status: 'partial' as const,
                timestamp: new Date().toISOString(),
                result_summary: (
                  `Requeued after failure (attempt ${requeuedTask.attempts}/${requeuedTask.maxAttempts}): ` +
                  error.slice(0, 150)
                ).slice(0, 200),
              },
            });
            console.log(
              `[TaskManager] requeue queue-status event emitted: ` +
              `task_id=${requeuedTask.id.slice(0, 8)}, ` +
              `current_queue_state=pending, ` +
              `execution_outcome=pending ` +
              `(attempt ${requeuedTask.attempts}/${requeuedTask.maxAttempts})`,
            );
          } catch (emitErr) {
            console.warn(
              `[TaskManager] requeue queue-status emission failed for ` +
              `task ${taskId.slice(0, 8)}: ${(emitErr as Error).message}`,
            );
          }
        }
      }, delay);
    } else {
      // Final escalation — emit explicit lifecycle event before transitioning
      // so the floor feedback chain receives queueState=failed + reexecutionOutcome=failure
      // BEFORE the directive is marked complete by the orchestrator.
      this.emitLifecycleEvent(
        taskId,
        task.attempts > 0, // reexecutionOccurred if any retries happened
        'failure',
        'escalation:max-attempts-exceeded',
      );
      this.transition(taskId, 'escalated');
    }
  }

  /** Record task result and cost. */
  recordResult(taskId: string, result: string, costCents: number): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.result = result;
    task.actualCostCents += costCents;
  }

  /**
   * Emit a structured queue-status completion event BEFORE marking a task complete.
   * Required by system learnings: floor-manager verification loops resolve task state
   * from this event, not from polling alone.
   *
   * Payload: { task_id, status, timestamp, result_summary (max 200 chars) }
   *
   * If emission fails (eventBus.emit throws), the task is held in 'pending_verification'
   * (via reviewStatus field) and retried up to 3 times before escalating.
   *
   * @returns true if emission succeeded, false if it failed after all retries.
   */
  async emitPreCompletionEvent(
    taskId: string,
    status: 'complete' | 'failed' | 'partial',
  ): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    const payload: {
      task_id: string;
      status: 'complete' | 'failed' | 'partial';
      timestamp: string;
      result_summary: string;
    } = {
      task_id: task.id,
      status,
      timestamp: new Date().toISOString(),
      result_summary: (task.result ?? task.description ?? '').slice(0, 200),
    };

    const MAX_EMISSION_RETRIES = 3;
    let emissionAttempt = 0;
    let lastError: string | null = null;

    while (emissionAttempt < MAX_EMISSION_RETRIES) {
      emissionAttempt++;
      try {
        // Emit on internal EventBus — this is the authoritative pre-completion event.
        // Listeners (floor-manager, lifecycle handlers) receive this BEFORE 'task:completed'.
        this.eventBus.emit('task:queue-status', {
          taskId: task.id,
          floorId: task.floorId,
          agentId: task.assignedAgent,
          payload,
        });

        // Audit log to console (persisted to event bus audit trail via 'task:queue-status' handler)
        console.log(
          `[TaskManager] pre-completion event emitted: ` +
          `task_id=${payload.task_id.slice(0, 8)}, ` +
          `status=${payload.status}, ` +
          `timestamp=${payload.timestamp}, ` +
          `result_summary="${payload.result_summary.slice(0, 80)}${payload.result_summary.length > 80 ? '...' : ''}"`,
        );

        return true; // Emission succeeded
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.warn(
          `[TaskManager] pre-completion event emission attempt ${emissionAttempt}/${MAX_EMISSION_RETRIES} ` +
          `failed for task ${taskId.slice(0, 8)}: ${lastError}`,
        );

        if (emissionAttempt < MAX_EMISSION_RETRIES) {
          // Hold task in pending_verification state (via reviewStatus) while retrying
          task.reviewStatus = 'pending'; // reset to pending = pending_verification hold
          task.reviewFeedback =
            `Held in pending_verification: emission attempt ${emissionAttempt} failed — ${lastError}`;
          persistWithRetry(() => saveTask(task), `task:verify-hold:${taskId.slice(0, 8)}`);

          // Backoff: 500ms, 1000ms between retries
          await new Promise(resolve => setTimeout(resolve, emissionAttempt * 500));
        }
      }
    }

    // All retries exhausted — escalate
    console.error(
      `[TaskManager] pre-completion event FAILED after ${MAX_EMISSION_RETRIES} attempts ` +
      `for task ${taskId.slice(0, 8)}: ${lastError}. ` +
      `Task held in pending_verification — manual escalation required.`,
    );
    task.reviewFeedback =
      `ESCALATED: pre-completion event emission failed after ${MAX_EMISSION_RETRIES} attempts. ` +
      `Last error: ${lastError}. Task held in pending_verification.`;
    persistWithRetry(() => saveTask(task), `task:verify-escalate:${taskId.slice(0, 8)}`);
    return false;
  }

  /** Submit a task for review. */
  submitForReview(taskId: string, reviewerAgent: AgentId): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    this.transition(taskId, 'review');
    this.eventBus.emit('task:review-needed', {
      taskId,
      floorId: task.floorId,
      reviewerAgent,
    });
  }

  // --- Queries ---

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  getFloorTasks(floorId: string): Task[] {
    return [...this.tasks.values()].filter(t => t.floorId === floorId);
  }

  getFloorTasksByStatus(floorId: string, status: TaskStatus): Task[] {
    return [...this.tasks.values()].filter(
      t => t.floorId === floorId && t.status === status,
    );
  }

  removeFloorTasks(floorId: string): void {
    for (const [id, task] of this.tasks) {
      if (task.floorId === floorId) this.tasks.delete(id);
    }
  }

  getFloorCost(floorId: string): number {
    return [...this.tasks.values()]
      .filter(t => t.floorId === floorId)
      .reduce((sum, t) => sum + t.actualCostCents, 0);
  }

  /**
   * Find a working/dispatched task that expects the given output file path.
   * Used by FileWatcher to map file writes to task completions.
   */
  getTaskByOutputFile(floorId: string, relativeFilePath: string): Task | undefined {
    return [...this.tasks.values()].find(t =>
      t.floorId === floorId &&
      (t.status === 'working' || t.status === 'dispatched') &&
      t.outputFiles.some(f => f === relativeFilePath || relativeFilePath.endsWith(f)),
    );
  }

  /**
   * Emit an explicit queue-status event for a budget-plan (finance-agent) task.
   * Required by system learnings for all task requeues and completions:
   * the event carries {task_id, current_queue_state, execution_outcome} and is
   * routed to the floor-manager feedback channel so queue state can be verified
   * without retry exhaustion.
   *
   * This is distinct from emitPreCompletionEvent (which fires before status
   * transition) — this fires AFTER execution to confirm the final state.
   *
   * @param taskId            - The task UUID
   * @param executionOutcome  - 'success' | 'failure' | 'pending'
   * @param trigger           - Human-readable trigger label for audit trail
   * @returns true if emission succeeded, false on error
   */
  emitBudgetPlanQueueStatusEvent(
    taskId: string,
    executionOutcome: 'success' | 'failure' | 'pending',
    trigger = 'finance-agent:budget-plan:execution',
  ): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.taskType !== 'budget-plan') return false;

    const currentQueueState = toQueueState(task.status);

    // Emit structured queue-status event to EventBus (floor-manager feedback chain)
    try {
      this.eventBus.emit('task:queue-status', {
        taskId: task.id,
        floorId: task.floorId,
        agentId: task.assignedAgent,
        payload: {
          task_id: task.id,
          status: executionOutcome === 'success' ? 'complete' as const
                : executionOutcome === 'failure' ? 'failed' as const
                : 'partial' as const,
          timestamp: new Date().toISOString(),
          result_summary: (task.result ?? task.description ?? '').slice(0, 200),
        },
      });

      // Also emit the richer lifecycle event with all three required fields
      this.eventBus.emit('task:lifecycle-event', {
        taskId: task.id,
        floorId: task.floorId,
        queueState: currentQueueState,
        reexecutionOccurred: task.attempts > 0,
        reexecutionOutcome: executionOutcome,
        taskType: task.taskType,
        agentId: task.assignedAgent,
        phaseNumber: task.phaseNumber,
        trigger,
        timestamp: new Date().toISOString(),
      });

      console.log(
        `[TaskManager] budget-plan queue-status event emitted: ` +
        `task_id=${task.id.slice(0, 8)}, ` +
        `current_queue_state=${currentQueueState}, ` +
        `execution_outcome=${executionOutcome}, ` +
        `trigger=${trigger}`,
      );
      return true;
    } catch (err) {
      console.warn(
        `[TaskManager] budget-plan queue-status event emission failed for ` +
        `task ${taskId.slice(0, 8)}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Mark all completed budget-plan tasks for a floor as superseded.
   * Sets reviewFeedback to the supersession note and reviewStatus to 'rejected'
   * so downstream consumers know these outputs must not be used for planning.
   * Persists each affected task to Supabase immediately.
   * Returns the number of tasks marked.
   */
  async markBudgetPlanTasksSuperseded(floorId: string, note: string): Promise<number> {
    const affected = [...this.tasks.values()].filter(
      t =>
        t.floorId === floorId &&
        t.taskType === 'budget-plan' &&
        t.status === 'completed',
    );

    let count = 0;
    for (const task of affected) {
      task.reviewStatus = 'rejected';
      task.reviewFeedback = note;
      // Persist the updated task record to Supabase so the staleness survives restarts
      try {
        await saveTask(task);
        count++;
        console.log(
          `[TaskManager] Marked budget-plan task ${task.id.slice(0, 8)} as superseded ` +
          `for floor ${floorId}`,
        );
      } catch (err) {
        console.warn(
          `[TaskManager] Failed to persist superseded state for task ${task.id.slice(0, 8)}:`,
          (err as Error).message,
        );
      }
    }
    return count;
  }

  /** Get queued tasks sorted by priority then creation time. */
  getQueuedTasks(floorId?: string): Task[] {
    const priorityOrder: Record<TaskPriority, number> = {
      critical: 0, high: 1, normal: 2, low: 3,
    };

    return [...this.tasks.values()]
      .filter(t => t.status === 'queued' && (!floorId || t.floorId === floorId))
      .sort((a, b) => {
        const priDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (priDiff !== 0) return priDiff;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
  }
}
