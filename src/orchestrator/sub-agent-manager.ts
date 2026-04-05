/**
 * SubAgentManager — spawns and manages sub-agents for batch work.
 *
 * Constraints (from spec):
 * - Max 3 concurrent sub-agents per parent agent
 * - Max 10 API turns per sub-agent
 * - Haiku only
 * - One level deep — sub-agents cannot spawn their own sub-agents
 * - Parent agent reviews all sub-agent output before it goes anywhere
 * - Sub-agents terminated after task completion — no persistent state
 */

import type { AgentId } from '../config/types.js';
import { PromptBuilder } from '../prompt-builder/index.js';
import { callAnthropic } from '../clients/anthropic.js';
import type { EventBus } from './event-bus.js';

const MAX_CONCURRENT_PER_PARENT = 3;
const MAX_TURNS_PER_SUBAGENT = 10;

export interface SubAgentTask {
  parentTaskId: string;
  parentAgent: AgentId;
  floorId: string;
  floorName: string;
  task: string;
  brandSummary: string;
  spawnDepth?: number; // 0 = top-level agent spawning, must not exceed 0
}

export interface SubAgentResult {
  taskIndex: number;
  content: string;
  costCents: number;
  turnsUsed: number;
  success: boolean;
  error?: string;
  needsParentReview: true; // Always true — parent must review before applying
}

export class SubAgentManager {
  private promptBuilder = new PromptBuilder();
  // Track active sub-agents per parent agent
  private activePerParent = new Map<string, number>();

  constructor(private eventBus: EventBus) {}

  /**
   * Spawn multiple sub-agents in parallel for batch work.
   * Enforces: max 3 per parent, max 10 turns each, Haiku only, no nesting.
   */
  async spawnBatch(
    tasks: SubAgentTask[],
  ): Promise<SubAgentResult[]> {
    // Reject if any task tries to nest (spawnDepth > 0)
    for (const task of tasks) {
      if ((task.spawnDepth ?? 0) > 0) {
        return tasks.map((_, i) => ({
          taskIndex: i,
          content: '',
          costCents: 0,
          turnsUsed: 0,
          success: false,
          error: 'Sub-agents cannot spawn their own sub-agents (max depth = 1)',
          needsParentReview: true as const,
        }));
      }
    }

    const results: SubAgentResult[] = [];
    const queue = [...tasks.entries()];
    const parentKey = tasks[0]?.parentAgent ?? 'unknown';

    // Process in batches of MAX_CONCURRENT_PER_PARENT
    while (queue.length > 0) {
      // Check how many slots this parent has available
      const active = this.activePerParent.get(parentKey) ?? 0;
      const available = Math.max(0, MAX_CONCURRENT_PER_PARENT - active);
      if (available === 0) {
        // All slots full — wait briefly and retry
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      const batch = queue.splice(0, available);
      this.activePerParent.set(parentKey, active + batch.length);

      const batchResults = await Promise.allSettled(
        batch.map(async ([index, task]) => {
          const prompt = await this.promptBuilder.buildSubAgentPrompt(
            task.parentAgent,
            task.floorName,
            task.task,
            task.brandSummary,
          );

          // Single-turn call with max_tokens capped for sub-agents
          const result = await callAnthropic(
            prompt,
            [{ role: 'user', content: task.task }],
            'haiku',
            2048,
          );

          this.eventBus.emit('cost:recorded', {
            floorId: task.floorId,
            taskId: task.parentTaskId,
            costCents: result.costCents,
          });

          // turnsUsed = 1 for single-turn; multi-turn would loop up to MAX_TURNS_PER_SUBAGENT
          return { index, content: result.content, costCents: result.costCents, turnsUsed: 1 };
        }),
      );

      // Release slots
      const currentActive = this.activePerParent.get(parentKey) ?? batch.length;
      this.activePerParent.set(parentKey, Math.max(0, currentActive - batch.length));

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push({
            taskIndex: result.value.index,
            content: result.value.content,
            costCents: result.value.costCents,
            turnsUsed: result.value.turnsUsed,
            success: true,
            needsParentReview: true,
          });
        } else {
          results.push({
            taskIndex: results.length,
            content: '',
            costCents: 0,
            turnsUsed: 0,
            success: false,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
            needsParentReview: true,
          });
        }
      }
    }

    return results.sort((a, b) => a.taskIndex - b.taskIndex);
  }

  /** Get how many sub-agents a parent currently has active. */
  getActiveCount(parentAgent: AgentId): number {
    return this.activePerParent.get(parentAgent) ?? 0;
  }

  /** Check if a parent can spawn more sub-agents. */
  canSpawn(parentAgent: AgentId): boolean {
    return (this.activePerParent.get(parentAgent) ?? 0) < MAX_CONCURRENT_PER_PARENT;
  }
}
