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
import { loadTemplate } from '../prompt-builder/template-loader.js';
import type { EventBus } from './event-bus.js';

/**
 * Knowledge file routing — maps agent IDs to the knowledge library files
 * they should receive in their prompts. Paths are relative to ~/.openclaw/knowledge/.
 * Max 2 files per task (enforced by knowledge-loader).
 */
const AGENT_KNOWLEDGE_FILES: Partial<Record<VirtualAgentId, string[]>> = {
  'design-agent':       ['design/design-styles.md', 'design/ui-patterns.md'],
  'copy-agent':         ['marketing/hook-formulas.md', 'marketing/copywriting-frameworks.md'],
  'ads-agent':          ['marketing/ad-frameworks.md', 'marketing/platform-best-practices.md'],
  'social-media-agent': ['marketing/social-playbook.md', 'marketing/hook-formulas.md'],
  'strategy-agent':     ['business/market-analysis-frameworks.md'],
  'finance-agent':      ['business/pricing-models.md', 'business/unit-economics.md'],
  'commerce-agent':     ['ecommerce/conversion-optimization.md', 'ecommerce/product-page-best-practices.md'],
  'video-agent':        ['design/video-production-guide.md'],
};

/**
 * Resolve knowledge files for a dispatch. Uses explicit files if provided,
 * otherwise falls back to the agent's default knowledge routing.
 */
function resolveKnowledgeFiles(agentId: VirtualAgentId, explicit?: string[]): string[] {
  if (explicit && explicit.length > 0) return explicit;
  return AGENT_KNOWLEDGE_FILES[agentId] ?? [];
}

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
  /** Knowledge library files to load (relative paths under ~/.openclaw/knowledge/) */
  knowledgeFiles?: string[];
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
    const knowledgeFiles = resolveKnowledgeFiles(input.agentId, input.knowledgeFiles);
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
      knowledgeFiles,
      outcomeExamplesXml: input.outcomeExamplesXml,
      crossFloorInsightsXml: input.crossFloorInsightsXml,
    };

    const assembled = await this.promptBuilder.build(promptInput);

    // 1.5. Generated Knowledge Pattern — two-phase dispatch for flagged agents.
    // Phase 1: generate relevant facts. Phase 2: reason using those facts.
    const template = await loadTemplate(input.agentId);
    let generatedKnowledge: string | null = null;
    if (template.usesGeneratedKnowledge) {
      try {
        const phase1Result = await callAnthropic(
          assembled.systemPrompt,
          [{
            role: 'user',
            content: `PHASE 1 — FACT GENERATION ONLY.\n\nTask: ${input.taskDescription}\n\nBefore reasoning about this task, generate 5-8 relevant facts from the brand context, market data, and your domain expertise. Output ONLY a numbered list of facts. Do not reason, recommend, or conclude yet.`,
          }],
          input.modelTier === 'opus' ? 'sonnet' : 'haiku', // Use cheaper tier for fact generation
          2048,
          input.floorId,
        );
        if (phase1Result.content) {
          generatedKnowledge = phase1Result.content;
          // Record the Phase 1 cost
          this.eventBus.emit('cost:recorded', {
            floorId: input.floorId,
            taskId: input.taskId,
            costCents: phase1Result.costCents,
          });
        }
      } catch (err) {
        console.warn(`[VirtualDispatcher] Generated Knowledge Phase 1 failed for ${input.agentId}: ${err}`);
        // Non-fatal — proceed without generated knowledge
      }
    }

    // 2. Prepare conversation messages
    const messages: ConversationMessage[] = [
      ...(input.conversationHistory ?? []),
    ];

    if (generatedKnowledge) {
      // Inject Phase 1 facts as a prior assistant message, then task as Phase 2
      messages.push(
        { role: 'user', content: `Generate relevant facts for this task: ${input.taskDescription}` },
        { role: 'assistant', content: generatedKnowledge },
        { role: 'user', content: `PHASE 2 — Now reason using ONLY the facts above. ${input.taskDescription}\n\nCite which fact supports each conclusion. Recommend with expected impact, timeline, risk, and rollback plan.` },
      );
    } else {
      messages.push({ role: 'user', content: input.taskDescription });
    }

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
