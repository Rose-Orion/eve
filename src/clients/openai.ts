/**
 * OpenAI SDK wrapper — used ONLY for GPT Image generation (text-in-images).
 * Not used for text generation — all text goes through Anthropic.
 */

import OpenAI from 'openai';
import { getConfig } from '../config/index.js';
import { withRetry } from './retry.js';
import { checkBudget } from './budget-check.js';

export interface GptImageRequest {
  prompt: string;
  size: '1024x1024' | '1024x1536' | '1536x1024';
  quality?: 'low' | 'medium' | 'high';
  n?: number;
}

export interface GptImageResult {
  imageUrls: string[];
  costCents: number;
}

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const config = getConfig();
    if (!config.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
    client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  }
  return client;
}

/**
 * Generate images via OpenAI GPT Image API.
 * Best for text-in-image rendering (quotes, scripture designs).
 */
export async function generateGptImage(request: GptImageRequest, floorId?: string): Promise<GptImageResult> {
  const openai = getClient();

  // Estimate cost and check budget before making the API call
  const costPerImage = request.quality === 'high' ? 12 : request.quality === 'low' ? 3 : 7;
  const estimatedCostCents = (request.n ?? 1) * costPerImage;
  if (floorId) {
    checkBudget(floorId, estimatedCostCents);
  }

  const response = await withRetry(
    () => openai.images.generate({
      model: 'gpt-image-1',
      prompt: request.prompt,
      size: request.size,
      quality: request.quality ?? 'medium',
      n: request.n ?? 1,
    }),
    { label: 'OpenAI:image', maxRetries: 2 },
  );

  const urls = (response.data ?? [])
    .map(img => img.url)
    .filter((url): url is string => url != null);

  return {
    imageUrls: urls,
    costCents: urls.length * costPerImage,
  };
}
