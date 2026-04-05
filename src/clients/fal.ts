/**
 * fal.ai SDK wrapper — handles image and video generation.
 * Design Agent directs generation; this client executes the API calls.
 */

import { fal } from '@fal-ai/client';
import { getConfig } from '../config/index.js';
import { withRetry } from './retry.js';
import { checkBudget } from './budget-check.js';

/** Per-model cost estimates in cents — updated from fal.ai pricing 2026 */
const FAL_COST_MAP: Record<string, number> = {
  'fal-ai/flux/dev': 5,
  'fal-ai/flux-pro': 5,
  'fal-ai/flux/schnell': 3,
  'fal-ai/recraft-v3': 4,
  'fal-ai/recraft/v3/text-to-image': 4,
  'fal-ai/ideogram/v2': 4,
  'fal-ai/nano-banana-2': 2,
};

/** Video cost in cents based on duration (seconds) */
function videoGenerationCost(durationSec: number): number {
  if (durationSec <= 5) return 15;
  if (durationSec <= 10) return 25;
  if (durationSec <= 20) return 40;
  return 50; // 20-30s
}

export type ImageModel =
  | 'fal-ai/flux/dev'         // FLUX photorealism
  | 'fal-ai/recraft/v3/text-to-image'  // Logos/vectors
  | 'fal-ai/ideogram/v2'     // Text-in-images
  | string;

export interface ImageGenRequest {
  model: ImageModel;
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  numImages?: number;
  style?: string; // Model-specific style hint (e.g. 'vector_illustration' for Recraft)
}

export interface ImageGenResult {
  imageUrls: string[];
  costCents: number;
  model: string;
  seed?: number;
}

export interface VideoGenRequest {
  model: string;
  prompt: string;
  imageUrl?: string; // For image-to-video
  duration?: number;
  aspectRatio?: string;
}

export interface VideoGenResult {
  videoUrl: string;
  costCents: number;
  model: string;
}

let initialized = false;

function ensureInit(): void {
  if (initialized) return;
  const config = getConfig();
  if (config.FAL_KEY) {
    (fal as { config?: (opts: { credentials: string }) => void }).config?.({ credentials: config.FAL_KEY });
    initialized = true;
  }
}

/**
 * Generate images via fal.ai.
 */
export async function generateImage(request: ImageGenRequest, floorId?: string): Promise<ImageGenResult> {
  ensureInit();

  // Estimate cost and check budget before making the API call
  const costPerImage = FAL_COST_MAP[request.model] ?? 5; // cents, default to 5 if unknown model
  const estimatedCostCents = (request.numImages ?? 1) * costPerImage;
  if (floorId) {
    checkBudget(floorId, estimatedCostCents);
  }

  // Different fal.ai models accept different parameter formats:
  // - Flux: accepts `image_size` as { width, height } object
  // - Ideogram: accepts `image_size` as { width, height } but may also need `aspect_ratio`
  // - Recraft: expects `image_size` as { width, height } and supports `style`
  // FIX: Some models are strict about the format. Use model-specific input construction
  // to ensure compatibility across all providers.
  const isRecraft = request.model.includes('recraft');
  const isIdeogram = request.model.includes('ideogram');

  const input: Record<string, unknown> = {
    prompt: request.prompt,
    num_images: request.numImages ?? 1,
  };

  // Recraft and Ideogram need image_size as a WxH string OR flat width/height
  // Flux accepts image_size as nested object
  if (isRecraft) {
    // Recraft V3: expects image_size as enum string (square_hd, portrait_4_3, landscape_4_3, etc.)
    // Map pixel dimensions to the closest preset
    const w = request.width ?? 1024;
    const h = request.height ?? 1024;
    const ratio = w / h;
    let sizePreset = 'square_hd'; // default
    if (ratio > 1.5) sizePreset = 'landscape_16_9';
    else if (ratio > 1.2) sizePreset = 'landscape_4_3';
    else if (ratio < 0.67) sizePreset = 'portrait_16_9';
    else if (ratio < 0.85) sizePreset = 'portrait_4_3';
    input['image_size'] = sizePreset;
    if (request.style) input['style'] = request.style;
  } else if (isIdeogram) {
    // Ideogram V2: pass width/height directly
    input['width'] = request.width ?? 1024;
    input['height'] = request.height ?? 1024;
    if (request.negativePrompt) input['negative_prompt'] = request.negativePrompt;
  } else {
    // Flux and other models: nested image_size object
    input['image_size'] = { width: request.width ?? 1024, height: request.height ?? 1024 };
    if (request.negativePrompt) input['negative_prompt'] = request.negativePrompt;
    if (request.style) input['style'] = request.style;
  }

  const result = await withRetry(
    () => fal.subscribe(request.model, { input }),
    { label: 'fal:image', maxRetries: 2 },
  ) as { data: { images?: Array<{ url: string }>; seed?: number } };

  const images = result.data.images ?? [];
  const actualCostPerImage = FAL_COST_MAP[request.model] ?? 5;

  // FIX: Detect silent failures — if the API returned no images, that's an error
  if (images.length === 0) {
    console.error(`[fal.ts] Model ${request.model} returned 0 images. Full response:`, JSON.stringify(result.data).slice(0, 500));
    throw new Error(`fal.ai model ${request.model} returned no images — possible parameter format issue`);
  }

  return {
    imageUrls: images.map(img => img.url),
    costCents: images.length * actualCostPerImage,
    model: request.model,
    seed: result.data.seed,
  };
}

/**
 * Generate video via fal.ai.
 */
export async function generateVideo(request: VideoGenRequest, floorId?: string): Promise<VideoGenResult> {
  ensureInit();

  // Estimate cost and check budget before making the API call
  const estimatedCostCents = videoGenerationCost(request.duration ?? 5);
  if (floorId) {
    checkBudget(floorId, estimatedCostCents);
  }

  const input: Record<string, unknown> = {
    prompt: request.prompt,
  };
  if (request.imageUrl) input['image_url'] = request.imageUrl;
  if (request.duration) input['duration'] = request.duration;
  if (request.aspectRatio) input['aspect_ratio'] = request.aspectRatio;

  const result = await withRetry(
    () => fal.subscribe(request.model, { input }),
    { label: 'fal:video', maxRetries: 2 },
  ) as {
    data: { video?: { url: string } };
  };

  const actualCostCents = videoGenerationCost(request.duration ?? 5);

  return {
    videoUrl: result.data.video?.url ?? '',
    costCents: actualCostCents,
    model: request.model,
  };
}
