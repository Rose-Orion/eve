/**
 * Anthropic SDK wrapper — handles all direct Claude API calls for virtual agents.
 * Records token usage and cost per call.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ModelTier } from '../config/types.js';
import { MODEL_IDS } from '../config/types.js';
import { getConfig } from '../config/index.js';
import { withRetry } from './retry.js';
import { checkBudget } from './budget-check.js';

export interface AnthropicCallResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  model: string;
  stopReason: string | null;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Cost per million tokens (in cents) — March 2026 pricing
const COST_PER_MILLION: Record<ModelTier, { input: number; output: number }> = {
  opus:   { input: 1500, output: 7500 },
  sonnet: { input: 300,  output: 1500 },
  haiku:  { input: 80,   output: 400 },
};

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: getConfig().ANTHROPIC_API_KEY });
  }
  return client;
}

/**
 * Call the Anthropic Messages API with a system prompt and conversation history.
 */
export async function callAnthropic(
  systemPrompt: string,
  messages: ConversationMessage[],
  modelTier: ModelTier,
  maxTokens: number = 4096,
  floorId?: string,
): Promise<AnthropicCallResult> {
  const model = MODEL_IDS[modelTier];
  const anthropic = getClient();

  // Estimate cost and check budget before making the API call
  if (floorId) {
    const pricing = COST_PER_MILLION[modelTier];
    const estimatedInputTokens = 2000; // Conservative estimate
    const estimatedOutputTokens = maxTokens;
    const estimatedCostCents =
      (estimatedInputTokens / 1_000_000) * pricing.input +
      (estimatedOutputTokens / 1_000_000) * pricing.output;
    checkBudget(floorId, Math.ceil(estimatedCostCents * 100) / 100);
  }

  const response = await withRetry(
    () => anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
    { label: `Anthropic:${modelTier}`, maxRetries: 3, initialDelayMs: 2000 },
  );

  const content = response.content
    .filter(block => block.type === 'text')
    .map(block => {
      if (block.type === 'text') return block.text;
      return '';
    })
    .join('\n');

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const pricing = COST_PER_MILLION[modelTier];
  const costCents =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output;

  return {
    content,
    inputTokens,
    outputTokens,
    costCents: Math.round(costCents * 100) / 100,
    model,
    stopReason: response.stop_reason,
  };
}

/**
 * Calculate estimated cost for a prompt before sending.
 */
export function estimateCost(
  inputTokens: number,
  estimatedOutputTokens: number,
  modelTier: ModelTier,
): number {
  const pricing = COST_PER_MILLION[modelTier];
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (estimatedOutputTokens / 1_000_000) * pricing.output
  );
}
