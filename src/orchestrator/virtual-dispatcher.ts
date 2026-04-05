/**
 * VirtualDispatcher — dispatches tasks to virtual agents via direct Anthropic API calls.
 * Uses PromptBuilder to assemble system prompts, then calls the Anthropic client.
 */

import type { AgentId, BrandState, ModelTier, VirtualAgentId } from '../config/types.js';
import { isVirtualAgent } from '../config/types.js';
import { PromptBuilder } from '../prompt-builder/index.js';
import type { BuildPromptInput } from '../prompt-builder/index.js';
import { callAnthropic, estimateCost } from '../clients/anthropic.js';
import type { AnthropicCallResult, ConversationMessage } from '../clients/anthropic.js';
import type { EventBus } from './event-bus.js';

export interface DispatchInput {
  taskId: string;
  floorId: string;
  floorSlug: string;
  agentId: VirtualAgentId;
  taskType: string;
  taskDescription: string;
  acceptanceCriteria: string[];
  inputFiles: string[];
  pendingInputs: string[];
  outputSpec: string;
  priority: string;
  modelTier: ModelTier;
  brandState: BrandState;
  selectedBrand?: import('../config/types.js').SelectedBrand | null;
  workspaceFiles?: string[];
  conversationHistory?: ConversationMessage[];
  /** Pre-formatted outcome gold standards XML (Phase 4) */
  outcomeExamplesXml?: string;
  /** Pre-formatted cross-floor intelligence XML (Phase 4) */
  crossFloorInsightsXml?: string;
}

export interface DispatchResult {
  success: boolean;
  content: string;
  costCents: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
  promptTokens: number;
  error?: string;
}

export class VirtualDispatcher {
  private promptBuilder = new PromptBuilder();

  constructor(private eventBus: EventBus) {}

  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    if (!isVirtualAgent(input.agentId)) {
      throw new Error(`${input.agentId} is a real agent — use OpenClawDispatcher`);
    }

    // 1. Build the system prompt
    const promptInput: BuildPromptInput = {
      agentId: input.agentId,
      floorId: input.floorId,
      floorSlug: input.floorSlug,
      taskId: input.taskId,
      taskDescription: input.taskDescription,
      taskType: input.taskType,
      acceptanceCriteria: input.acceptanceCriteria,
      inputFiles: input.inputFiles,
      pendingInputs: input.pendingInputs,
      outputSpec: input.outputSpec,
      priority: input.priority,
      modelTier: input.modelTier,
      brandState: input.brandState,
      selectedBrand: input.selectedBrand ?? null,
      workspaceFiles: input.workspaceFiles,
      outcomeExamplesXml: input.outcomeExamplesXml,
      crossFloorInsightsXml: input.crossFloorInsightsXml,
    };

    const assembled = await this.promptBuilder.build(promptInput);

    // 2. Prepare conversation messages
    const messages: ConversationMessage[] = [
      ...(input.conversationHistory ?? []),
      { role: 'user', content: input.taskDescription },
    ];

    // 3. Call Anthropic API
    let result: AnthropicCallResult;
    try {
      result = await callAnthropic(
        assembled.systemPrompt,
        messages,
        input.modelTier,
        assembled.maxTokens,
        input.floorId,
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        content: '',
        costCents: 0,
        inputTokens: 0,
        outputTokens: 0,
        model: assembled.model,
        promptTokens: assembled.totalTokens,
        error: errorMsg,
      };
    }

    // 4. Record cost
    this.eventBus.emit('cost:recorded', {
      floorId: input.floorId,
      taskId: input.taskId,
      costCents: result.costCents,
    });

    return {
      success: true,
      content: result.content,
      costCents: result.costCents,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      model: result.model,
      promptTokens: assembled.totalTokens,
    };
  }

  /**
   * Estimate cost before dispatching (for budget checks).
   */
  async estimateDispatchCost(
    input: Omit<DispatchInput, 'conversationHistory'>,
  ): Promise<number> {
    const promptInput: BuildPromptInput = {
      agentId: input.agentId,
      floorId: input.floorId,
      floorSlug: input.floorSlug,
      taskId: input.taskId,
      taskDescription: input.taskDescription,
      taskType: input.taskType,
      acceptanceCriteria: input.acceptanceCriteria,
      inputFiles: input.inputFiles,
      pendingInputs: input.pendingInputs,
      outputSpec: input.outputSpec,
      priority: input.priority,
      modelTier: input.modelTier,
      brandState: input.brandState,
      workspaceFiles: input.workspaceFiles,
    };

    const assembled = await this.promptBuilder.build(promptInput);
    return estimateCost(assembled.totalTokens, 2000, input.modelTier);
  }
}
