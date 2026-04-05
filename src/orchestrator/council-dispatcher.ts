/**
 * CouncilDispatcher — runs N agents in parallel on the same task,
 * then an evaluator picks the best output.
 *
 * Uses EVE's existing VirtualDispatcher for each agent call (direct Anthropic API),
 * not the openclaw-claude-code plugin. This keeps latency low and cost predictable.
 *
 * Flow:
 *   1. Dispatch same task to N agents with different persona overlays
 *   2. Collect all results via Promise.allSettled
 *   3. Run evaluator pass — separate Anthropic call that reads all proposals
 *   4. Return the winning output as a single DispatchResult
 */

import type { VirtualAgentId, ModelTier } from '../config/types.js';
import type { DispatchInput, DispatchResult } from './virtual-dispatcher.js';
import { VirtualDispatcher } from './virtual-dispatcher.js';
import type { CouncilPlan } from './council-router.js';
import type { EventBus } from './event-bus.js';
import { callAnthropic } from '../clients/anthropic.js';

export interface CouncilResult {
  /** The winning output (ready to use as task result) */
  winnerContent: string;
  /** Index of the winning proposal (0-based) */
  winnerIndex: number;
  /** Evaluator's rationale for the pick */
  rationale: string;
  /** All proposals for logging/debugging */
  proposals: Array<{
    persona: string;
    content: string;
    costCents: number;
    success: boolean;
  }>;
  /** Total cost of all agent calls + evaluator */
  totalCostCents: number;
  /** Total input tokens across all calls */
  totalInputTokens: number;
  /** Total output tokens across all calls */
  totalOutputTokens: number;
}

export class CouncilDispatcher {
  private virtualDispatcher: VirtualDispatcher;

  constructor(private eventBus: EventBus) {
    this.virtualDispatcher = new VirtualDispatcher(eventBus);
  }

  /**
   * Run a council dispatch — N parallel agents + 1 evaluator.
   */
  async dispatch(
    baseInput: DispatchInput,
    plan: CouncilPlan,
  ): Promise<CouncilResult> {
    console.log(
      `[Council] Starting ${plan.agentCount}-agent council for ${baseInput.taskType} ` +
      `(${plan.agentTier} agents, ${plan.evaluatorTier} evaluator)`,
    );

    // Phase 1: Dispatch N agents in parallel with persona overlays
    const agentPromises = plan.personas.map((persona, i) => {
      const personaInput: DispatchInput = {
        ...baseInput,
        // Append unique task ID suffix so cost events don't collide
        taskId: `${baseInput.taskId}-council-${i}`,
        // Prepend persona instruction to the task description
        taskDescription: `${persona}\n\n---\n\n${baseInput.taskDescription}`,
        modelTier: plan.agentTier,
      };
      return this.virtualDispatcher.dispatch(personaInput);
    });

    const results = await Promise.allSettled(agentPromises);

    // Collect proposals
    const proposals: Array<{ persona: string; content: string; costCents: number; success: boolean }> = results.map((r, i) => {
      if (r.status === 'fulfilled' && r.value.success) {
        return {
          persona: plan.personas[i] ?? `agent-${i}`,
          content: r.value.content,
          costCents: r.value.costCents,
          success: true,
        };
      }
      const error = r.status === 'rejected'
        ? (r.reason as Error).message
        : (r.value?.error ?? 'Unknown failure');
      console.warn(`[Council] Agent ${i} failed: ${error}`);
      return {
        persona: plan.personas[i] ?? `agent-${i}`,
        content: '',
        costCents: 0,
        success: false,
      };
    });

    const successfulProposals = proposals.filter(p => p.success && p.content.length > 100);

    // If no proposals succeeded, return failure
    if (successfulProposals.length === 0) {
      console.error('[Council] All agents failed — no proposals to evaluate');
      return {
        winnerContent: '',
        winnerIndex: -1,
        rationale: 'All council agents failed to produce output.',
        proposals,
        totalCostCents: proposals.reduce((sum, p) => sum + p.costCents, 0),
        totalInputTokens: 0,
        totalOutputTokens: 0,
      };
    }

    // If only 1 succeeded, skip evaluation — use it directly
    if (successfulProposals.length === 1) {
      const winner = successfulProposals[0]!;
      const winnerIdx = proposals.indexOf(winner);
      console.log(`[Council] Only 1 proposal succeeded — using it directly (agent ${winnerIdx})`);
      return {
        winnerContent: winner.content,
        winnerIndex: winnerIdx,
        rationale: 'Only one agent produced valid output.',
        proposals,
        totalCostCents: proposals.reduce((sum, p) => sum + p.costCents, 0),
        totalInputTokens: 0,
        totalOutputTokens: 0,
      };
    }

    // Phase 2: Evaluator picks the best proposal
    console.log(`[Council] Evaluating ${successfulProposals.length} proposals...`);

    const evalResult = await this.evaluate(
      baseInput,
      successfulProposals,
      plan,
    );

    // Total cost = all agent calls + evaluator
    const agentCost = proposals.reduce((sum, p) => sum + p.costCents, 0);
    const totalCost = agentCost + evalResult.costCents;

    console.log(
      `[Council] Winner: proposal ${evalResult.winnerIndex} ` +
      `(total cost: ${totalCost}¢, ${successfulProposals.length} proposals evaluated)`,
    );

    return {
      winnerContent: evalResult.winnerContent,
      winnerIndex: evalResult.winnerIndex,
      rationale: evalResult.rationale,
      proposals,
      totalCostCents: totalCost,
      totalInputTokens: evalResult.inputTokens,
      totalOutputTokens: evalResult.outputTokens,
    };
  }

  /**
   * Evaluator pass — reads all proposals and picks the best one.
   */
  private async evaluate(
    baseInput: DispatchInput,
    proposals: Array<{ persona: string; content: string }>,
    plan: CouncilPlan,
  ): Promise<{
    winnerContent: string;
    winnerIndex: number;
    rationale: string;
    costCents: number;
    inputTokens: number;
    outputTokens: number;
  }> {
    // Build evaluation prompt
    const proposalBlocks = proposals.map((p, i) => {
      // Truncate very long proposals to keep evaluator prompt manageable
      const truncated = p.content.length > 8000
        ? p.content.slice(0, 8000) + '\n\n... [truncated for evaluation]'
        : p.content;
      return `<proposal index="${i}">\n${truncated}\n</proposal>`;
    }).join('\n\n');

    const systemPrompt = `You are an expert evaluator for a business-building AI system called EVE.
Your job: read ${proposals.length} competing proposals for the same task, then pick the BEST one.

<evaluation_criteria>
${plan.evaluationCriteria}
</evaluation_criteria>

<instructions>
1. Read all proposals carefully.
2. Evaluate each against the criteria above.
3. Pick the single best proposal.
4. You MAY synthesize — take the best elements from multiple proposals and combine them into an improved version. If you synthesize, clearly state which elements came from which proposal.
5. Output your response in this exact format:

<winner index="N">
(The complete winning output — either the original proposal verbatim, or your synthesized improvement. This must be the FULL deliverable, not a summary.)
</winner>

<rationale>
(2-3 sentences explaining why this proposal won and what made it stronger than the alternatives.)
</rationale>
</instructions>`;

    const userMessage = `Here are ${proposals.length} competing proposals for: ${baseInput.taskType}\n\nTask: ${baseInput.taskDescription.slice(0, 2000)}\n\n${proposalBlocks}`;

    try {
      const result = await callAnthropic(
        systemPrompt,
        [{ role: 'user', content: userMessage }],
        plan.evaluatorTier,
        8192,
      );

      // Track evaluator cost
      this.eventBus.emit('cost:recorded', {
        floorId: baseInput.floorId,
        taskId: `${baseInput.taskId}-council-eval`,
        costCents: result.costCents,
      });

      // Parse winner from response
      const winnerMatch = result.content.match(/<winner\s+index="(\d+)">([\s\S]*?)<\/winner>/);
      const rationaleMatch = result.content.match(/<rationale>([\s\S]*?)<\/rationale>/);

      if (winnerMatch && winnerMatch[1] && winnerMatch[2]) {
        const idx = parseInt(winnerMatch[1], 10);
        const content = winnerMatch[2].trim();
        return {
          winnerContent: content,
          winnerIndex: idx,
          rationale: rationaleMatch?.[1]?.trim() ?? 'Selected by evaluator.',
          costCents: result.costCents,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        };
      }

      // Fallback: if parsing fails, use the longest proposal
      console.warn('[Council] Evaluator output parsing failed — falling back to longest proposal');
      let longestIdx = 0;
      let longestLen = 0;
      for (let i = 0; i < proposals.length; i++) {
        const p = proposals[i];
        if (p && p.content.length > longestLen) {
          longestLen = p.content.length;
          longestIdx = i;
        }
      }

      return {
        winnerContent: proposals[longestIdx]?.content ?? '',
        winnerIndex: longestIdx,
        rationale: 'Evaluator parsing failed — selected longest proposal as fallback.',
        costCents: result.costCents,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      };
    } catch (err) {
      // Evaluator failed — fall back to first proposal
      console.error(`[Council] Evaluator failed: ${(err as Error).message} — using first proposal`);
      return {
        winnerContent: proposals[0]?.content ?? '',
        winnerIndex: 0,
        rationale: `Evaluator failed (${(err as Error).message}), using first proposal.`,
        costCents: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
    }
  }
}
