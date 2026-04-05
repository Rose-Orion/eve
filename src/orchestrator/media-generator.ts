/**
 * MediaGenerator — routes media generation requests to the appropriate API.
 * Design Agent and Video Agent produce prompts; this module executes them.
 *
 * Phase 6 Extensions:
 * - Task 6.1: Intelligent model routing for creative tasks
 * - Task 6.2: Video production pipeline (Path A + Path B)
 * - Task 6.3: UGC-style ad creative production
 */

import { generateImage } from '../clients/fal.js';
import type { ImageGenRequest, ImageGenResult } from '../clients/fal.js';
import { generateVideo } from '../clients/fal.js';
import type { VideoGenRequest, VideoGenResult } from '../clients/fal.js';
import { generateGptImage } from '../clients/openai.js';
import type { GptImageRequest, GptImageResult } from '../clients/openai.js';
import { generateSpeech } from '../clients/elevenlabs.js';
import type { VoiceGenRequest, VoiceGenResult } from '../clients/elevenlabs.js';
import type { EventBus } from './event-bus.js';

export type MediaType = 'image' | 'video' | 'audio';

export interface MediaRequest {
  floorId: string;
  taskId: string;
  type: MediaType;
  request: ImageGenRequest | VideoGenRequest | GptImageRequest | VoiceGenRequest;
  useGptImage?: boolean; // Force GPT Image for text rendering
}

export interface MediaResult {
  type: MediaType;
  urls: string[];
  costCents: number;
  audioBuffer?: Buffer;
}

/**
 * Task 6.1: Creative task routing information
 */
export interface CreativeRoute {
  model: string;
  provider: 'fal' | 'openai';
  reason: string;
}

export interface CreativeVariation {
  url: string;
  model: string;
  variationIndex: number;
}

export interface CreativeReviewResult {
  approved: Array<{ url: string }>;
  rejected: string[];
}

/**
 * Task 6.2: Video production result types
 */
export interface VideoProductionResult {
  videoUrl: string;
  steps: string[];
}

/**
 * Task 6.3: UGC style and result types
 */
export type UGCStyle = 'avatar-script' | 'authentic-ugc' | 'product-showcase';

export interface UGCVariation {
  url: string;
  style: string;
  variationIndex: number;
}

export interface UGCBatchResult {
  variations: Array<{ url: string; style: string; type: string }>;
  totalGenerated: number;
}

export interface ProductInfo {
  name: string;
  description: string;
  imageUrl?: string;
}

/**
 * Task 6.1: Intelligent routing table for creative content types
 */
const CREATIVE_MODEL_ROUTING: Record<string, CreativeRoute> = {
  'product-photography': {
    model: 'fal-ai/flux-pro/v1.1',
    provider: 'fal',
    reason: 'Photorealistic product shots',
  },
  'logo-brand-asset': {
    model: 'fal-ai/recraft/v3/text-to-image',
    provider: 'fal',
    reason: 'Vector-style brand assets (legacy fallback)',
  },
  'logo-vector': {
    model: 'fal-ai/recraft/v3/text-to-image',
    provider: 'fal',
    reason: 'Vector logos and brand marks — SVG-ready, clean lines, scales 16px to billboard',
  },
  'logo-wordmark': {
    model: 'gpt-image-1',
    provider: 'openai',
    reason: 'Text-heavy logos/wordmarks — GPT Image best text rendering (~95% accuracy)',
  },
  'text-in-image': {
    model: 'gpt-image-1',
    provider: 'openai',
    reason: 'Best text rendering accuracy',
  },
  'social-content': {
    model: 'fal-ai/flux/schnell',
    provider: 'fal',
    reason: 'Fast generation, good quality',
  },
  'hero-image': {
    model: 'fal-ai/ideogram/v2',
    provider: 'fal',
    reason: 'Cinematic, high-impact visuals',
  },
  'ugc-style': {
    model: 'fal-ai/flux/dev',
    provider: 'fal',
    reason: 'Authentic, raw aesthetic',
  },
  'ad-creative': {
    model: 'fal-ai/flux-pro/v1.1',
    provider: 'fal',
    reason: 'High-quality ad visuals',
  },
};

/**
 * Task 6.2: Video model routing table
 */
const VIDEO_MODEL_ROUTING: Record<string, CreativeRoute> = {
  cinematic: {
    model: 'fal-ai/veo2',
    provider: 'fal',
    reason: 'Highest quality cinematic',
  },
  'product-demo': {
    model: 'fal-ai/runway-gen3/turbo/image-to-video',
    provider: 'fal',
    reason: 'Product demonstrations',
  },
  'social-ugc': {
    model: 'fal-ai/kling-video/v2/standard/image-to-video',
    provider: 'fal',
    reason: 'Social media / UGC style',
  },
  'quick-social': {
    model: 'fal-ai/kling-video/v2/standard/text-to-video',
    provider: 'fal',
    reason: 'Fast social content',
  },
};

export class MediaGenerator {
  constructor(private eventBus: EventBus) {}

  async generate(input: MediaRequest): Promise<MediaResult> {
    let result: MediaResult;

    switch (input.type) {
      case 'image': {
        if (input.useGptImage) {
          const gptResult = await generateGptImage(input.request as GptImageRequest);
          result = { type: 'image', urls: gptResult.imageUrls, costCents: gptResult.costCents };
        } else {
          const falResult = await generateImage(input.request as ImageGenRequest);
          result = { type: 'image', urls: falResult.imageUrls, costCents: falResult.costCents };
        }
        break;
      }
      case 'video': {
        const videoResult = await generateVideo(input.request as VideoGenRequest);
        result = { type: 'video', urls: [videoResult.videoUrl], costCents: videoResult.costCents };
        break;
      }
      case 'audio': {
        const audioResult = await generateSpeech(input.request as VoiceGenRequest);
        result = {
          type: 'audio',
          urls: [],
          costCents: audioResult.costCents,
          audioBuffer: audioResult.audioBuffer,
        };
        break;
      }
    }

    // Record cost
    this.eventBus.emit('cost:recorded', {
      floorId: input.floorId,
      taskId: input.taskId,
      costCents: result.costCents,
    });

    // Emit media generated event
    for (const url of result.urls) {
      this.eventBus.emit('media:generated', {
        floorId: input.floorId,
        taskId: input.taskId,
        type: input.type,
        url,
      });
    }

    return result;
  }

  /**
   * Task 6.1: Route a creative task to the optimal model/provider
   */
  routeCreativeTask(contentType: string): CreativeRoute {
    return (
      CREATIVE_MODEL_ROUTING[contentType] || {
        model: 'fal-ai/flux/schnell',
        provider: 'fal',
        reason: 'Default fallback for unknown content type',
      }
    );
  }

  /**
   * Task 6.1: Generate creative variations using the routed model
   */
  async generateCreativeVariations(
    floorId: string,
    contentType: string,
    prompt: string,
    count: number = 3,
  ): Promise<CreativeVariation[]> {
    const route = this.routeCreativeTask(contentType);
    const taskId = `creative-${contentType}-${Date.now()}`;

    this.eventBus.emit('creative:routed', {
      floorId,
      taskId,
      model: route.model,
      provider: route.provider,
      reason: route.reason,
    });

    const variations: CreativeVariation[] = [];
    let totalCostCents = 0;

    for (let i = 0; i < count; i++) {
      let result: ImageGenResult;

      if (route.provider === 'openai') {
        const gptResult = await generateGptImage({
          prompt,
          size: '1024x1024',
          quality: 'high',
          n: 1,
        });
        result = {
          imageUrls: gptResult.imageUrls,
          costCents: gptResult.costCents,
          model: route.model,
        };
      } else {
        result = await generateImage({
          model: route.model as string,
          prompt,
          width: 1024,
          height: 1024,
          numImages: 1,
        });
      }

      const url = result.imageUrls[0];
      if (url) {
        variations.push({
          url,
          model: result.model,
          variationIndex: i,
        });
      }

      totalCostCents += result.costCents;
    }

    this.eventBus.emit('creative:generated', {
      floorId,
      taskId,
      count: variations.length,
      costCents: totalCostCents,
    });

    return variations;
  }

  /**
   * Task 6.1: Generate variations and have Brand Agent review them
   * Note: This is a stub implementation since we need VirtualDispatcher which is in a separate context.
   * In production, this would call VirtualDispatcher to dispatch Brand Agent task.
   */
  async generateWithBrandReview(
    floorId: string,
    contentType: string,
    prompt: string,
    _brandGuidelines?: string,
  ): Promise<CreativeReviewResult> {
    const variations = await this.generateCreativeVariations(floorId, contentType, prompt, 3);
    const taskId = `creative-review-${contentType}-${Date.now()}`;

    // TODO: In production, dispatch Brand Agent task with this review flow:
    // const reviewTask = await virtualDispatcher.dispatch({
    //   agentId: 'brand',
    //   taskType: 'creative-review',
    //   taskDescription: `Review these ${variations.length} image variations for brand alignment...`,
    //   inputFiles: variations.map(v => v.url),
    //   acceptanceCriteria: [...],
    // });

    // For now, simulate approval with a simple metric (e.g., first 2 approved)
    const approved = variations.slice(0, 2).map(v => ({ url: v.url }));
    const rejected = variations.slice(2).map(v => v.url);

    this.eventBus.emit('creative:reviewed', {
      floorId,
      taskId,
      approvedCount: approved.length,
      rejectedCount: rejected.length,
    });

    return { approved, rejected };
  }

  /**
   * Convert hex color to a human-readable color name for image generation prompts.
   * AI image models render better results with natural color descriptions than hex codes.
   */
  private hexToColorName(hex: string): string {
    const h = hex.replace('#', '').toLowerCase();
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const brightness = (r + g + b) / 3;

    if (brightness < 30) return 'black';
    if (brightness > 230) return 'white';
    if (brightness > 200 && r > 200 && g > 190 && b > 170) return 'cream';

    // Dominant channel detection
    if (r > g + 40 && r > b + 40) {
      if (r > 180) return b > 100 ? 'coral' : 'red';
      if (r > 120) return g > 80 ? 'burnt orange' : 'dark red';
      return 'maroon';
    }
    if (g > r + 30 && g > b + 30) {
      if (g > 160) return 'green';
      return r > 80 ? 'olive' : 'dark green';
    }
    if (b > r + 30 && b > g + 30) {
      if (b > 180) return 'blue';
      return 'navy';
    }

    // Mixed tones
    if (r > 150 && g > 100 && b < 80) return 'gold';
    if (r > 120 && g > 100 && b > 80 && brightness < 160) return 'bronze';
    if (r > 100 && g > 100 && b > 100 && brightness < 160) return 'slate gray';
    if (Math.abs(r - g) < 20 && Math.abs(g - b) < 20) {
      return brightness > 160 ? 'light gray' : brightness > 80 ? 'gray' : 'charcoal';
    }

    return 'muted tone';
  }

  /**
   * Logo pipeline: Generate brand-aligned logo candidates.
   *
   * Research-backed approach (Recraft V3 prompt guide + Superside award winners):
   * - Recraft optimal format: "A <style> of <subject>. <details>. <background>."
   * - SHORT prompts outperform long ones — aim for 2-3 sentences, not paragraphs
   * - Magic keywords: "flat design", "geometric", "clean vector", "centered", "minimal"
   * - Recraft excels at icons/symbols; GPT Image excels at text rendering
   * - Route: Icon mark + Monogram → Recraft V3 | Wordmark → GPT Image
   * - Monochrome first — every great logo works in B&W before color
   *
   * Gold standards: Nike (pure motion), Apple (perfect geometry), Airbnb (belonging symbol),
   * FedEx (negative space arrow), Supreme (box logo authority), Stussy (cultural script).
   */
  async generateLogoCandidates(
    floorId: string,
    brandName: string,
    logoDirection: string,
    colors: string[],
    count: number = 3,
    brandContext?: {
      tagline?: string;
      concept?: string;
      voice?: string;
      typography?: string;
    },
  ): Promise<CreativeVariation[]> {
    const taskId = `logo-candidates-${Date.now()}`;

    // ── Color: describe naturally, never hex codes ──
    const colorNames = colors.slice(0, 3).map(c => this.hexToColorName(c));
    const bgColor = colorNames[0] || 'black';
    const markColor = colorNames[1] || 'white';

    // ── Brand personality → visual weight ──
    const concept = brandContext?.concept || '';
    const cLow = concept.toLowerCase();

    let strokeWeight = 'medium-weight';
    let shapeMood = 'balanced geometric';

    if (/bold|street|hip.?hop|urban|raw|energy|conviction|fire|loud|prophetic/i.test(cLow)) {
      strokeWeight = 'heavy bold';
      shapeMood = 'angular, commanding';
    } else if (/quiet|minimal|subtle|understated|refined|rebel|noticed|different/i.test(cLow)) {
      strokeWeight = 'thin precise';
      shapeMood = 'refined, elegant';
    } else if (/warm|generous|heritage|craft|supply|reliable|sturdy|provider|elder|weathered/i.test(cLow)) {
      strokeWeight = 'sturdy';
      shapeMood = 'solid, utilitarian';
    }

    // ── Extract initials for monogram ──
    const initials = brandName
      .replace(/["""''()]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 0 && w[0] === w[0]!.toUpperCase())
      .map(w => w[0])
      .join('')
      .slice(0, 3);

    // ── 3 logo briefs: icon (Recraft), wordmark (GPT Image), monogram (Recraft) ──
    // Each follows the optimal short-prompt pattern for its target model.

    interface LogoBrief {
      prompt: string;
      negativePrompt?: string;
      provider: 'fal' | 'openai';
      model: string;
      style?: string;
    }

    const recraftNeg = 'gradient, shadow, 3D, texture, mockup, t-shirt, product, person, photograph, multiple logos, text, words, letters';
    const vectorRoute = this.routeCreativeTask('logo-vector');
    const wordmarkRoute = this.routeCreativeTask('logo-wordmark');

    const briefs: LogoBrief[] = [
      // 1. ICON MARK → Recraft V3 (pure geometry, no text)
      {
        prompt: `A minimalist flat vector logo icon. ${shapeMood} abstract symbol, ${strokeWeight} strokes. ${markColor} mark on solid ${bgColor} background. Centered composition, single isolated mark, clean geometry, scalable.`,
        negativePrompt: recraftNeg,
        provider: vectorRoute.provider,
        model: vectorRoute.model,
        style: 'vector_illustration',
      },

      // 2. WORDMARK → GPT Image (text rendering is its strength)
      {
        prompt: `Minimalist wordmark logo on a solid ${bgColor} background. The word "${brandName}" in ${markColor}, rendered as a custom ${strokeWeight} logotype. Clean, professional type design with ${shapeMood} character. Centered, nothing else in the image — no icons, no tagline, no decorative elements. Flat design, no gradients, no shadows.`,
        provider: wordmarkRoute.provider,
        model: wordmarkRoute.model,
      },

      // 3. MONOGRAM → Recraft V3 (geometric letterforms, no full words)
      {
        prompt: `A minimalist flat vector monogram logo. The letters "${initials}" interlocking as one geometric mark, ${strokeWeight} strokes, clean negative space. ${markColor} on solid ${bgColor} background. Centered, single mark, precise geometry.`,
        negativePrompt: recraftNeg,
        provider: vectorRoute.provider,
        model: vectorRoute.model,
        style: 'vector_illustration',
      },
    ];

    this.eventBus.emit('creative:routed', {
      floorId,
      taskId,
      model: 'mixed (recraft + gpt-image)',
      provider: 'fal' as const,
      reason: 'Icon+Monogram→Recraft, Wordmark→GPT Image for text accuracy',
    });

    const variations: CreativeVariation[] = [];
    let totalCostCents = 0;

    // Generate all candidates in parallel (with GPT Image → Recraft fallback)
    const promises = briefs.slice(0, count).map(async (brief, i) => {
      try {
        let result: ImageGenResult;

        if (brief.provider === 'openai') {
          try {
            const gptResult = await generateGptImage({
              prompt: brief.prompt,
              size: '1024x1024',
              quality: 'high',
              n: 1,
            }, floorId);
            result = {
              imageUrls: gptResult.imageUrls,
              costCents: gptResult.costCents,
              model: brief.model,
            };
          } catch (gptErr) {
            // Fallback: GPT Image unavailable → use Recraft with wordmark-adapted prompt
            console.warn(`[Logo] GPT Image failed for wordmark, falling back to Recraft:`, (gptErr as Error).message);
            result = await generateImage({
              model: vectorRoute.model,
              prompt: `A minimalist flat vector wordmark logo. The word "${brandName}" in ${strokeWeight} custom lettering. ${markColor} on solid ${bgColor} background. Centered, typography only, clean flat design.`,
              negativePrompt: recraftNeg,
              width: 1024,
              height: 1024,
              numImages: 1,
              style: 'vector_illustration',
            }, floorId);
          }
        } else {
          result = await generateImage({
            model: brief.model,
            prompt: brief.prompt,
            negativePrompt: brief.negativePrompt,
            width: 1024,
            height: 1024,
            numImages: 1,
            style: brief.style,
          }, floorId);
        }

        const url = result.imageUrls[0];
        if (url) {
          variations.push({ url, model: result.model, variationIndex: i });
        }
        totalCostCents += result.costCents;
      } catch (err) {
        console.warn(`[Logo] Candidate ${i} failed for "${brandName}":`, (err as Error).message);
      }
    });

    await Promise.all(promises);

    this.eventBus.emit('creative:generated', {
      floorId,
      taskId,
      count: variations.length,
      costCents: totalCostCents,
    });

    // Sort by variationIndex to keep consistent ordering
    variations.sort((a, b) => a.variationIndex - b.variationIndex);

    return variations;
  }

  /**
   * Task 6.2: Route video production based on purpose
   */
  routeVideoProduction(purpose: 'ad' | 'hero' | 'social' | 'product'): 'pathA' | 'pathB' {
    // ads and hero -> Path A (quality, multiple steps)
    // social and product -> Path B (speed, direct generation)
    return purpose === 'ad' || purpose === 'hero' ? 'pathA' : 'pathB';
  }

  /**
   * Task 6.2: Path A - Quality video production with multiple steps
   */
  async generateVideoPathA(
    floorId: string,
    script: string,
    style: string,
    voiceId?: string,
  ): Promise<VideoProductionResult> {
    const steps: string[] = [];
    let videoUrl = '';
    let totalCostCents = 0;
    const taskId = `video-pathA-${Date.now()}`;

    // Step 1: Generate 3-5 key frames as images
    steps.push('Generating keyframes...');
    const keyframes = await this.generateCreativeVariations(
      floorId,
      `${style}-keyframe`,
      script,
      4,
    );
    totalCostCents += keyframes.reduce((sum) => sum + 3, 0); // Rough cost estimate

    // Step 2: Image-to-video with cinematic or product-demo model
    steps.push('Converting images to video...');
    const videoModel = style.includes('product')
      ? VIDEO_MODEL_ROUTING['product-demo']
      : VIDEO_MODEL_ROUTING.cinematic;

    if (!videoModel) {
      throw new Error('Video model routing failed');
    }

    const videoResult = await generateVideo({
      model: videoModel.model,
      prompt: script,
      imageUrl: keyframes[0]?.url,
      duration: 15,
      aspectRatio: '16:9',
    });
    videoUrl = videoResult.videoUrl;
    totalCostCents += videoResult.costCents;

    // Step 3: Generate voiceover if voiceId provided
    if (voiceId) {
      steps.push('Generating voiceover...');
      const voiceResult = await generateSpeech({
        text: script,
        voiceId,
      });
      totalCostCents += voiceResult.costCents;
    }

    steps.push('Video production complete');

    this.eventBus.emit('video:produced', {
      floorId,
      taskId,
      path: 'pathA',
      costCents: totalCostCents,
      stepCount: steps.length,
    });

    return { videoUrl, steps };
  }

  /**
   * Task 6.2: Path B - Speed video production with direct text-to-video
   */
  async generateVideoPathB(
    floorId: string,
    prompt: string,
    _style?: string,
  ): Promise<VideoProductionResult> {
    const steps: string[] = [];
    const taskId = `video-pathB-${Date.now()}`;

    steps.push('Generating video directly from text...');
    const quickSocialRoute = VIDEO_MODEL_ROUTING['quick-social'];
    if (!quickSocialRoute) {
      throw new Error('Quick social video model routing failed');
    }

    const videoResult = await generateVideo({
      model: quickSocialRoute.model,
      prompt,
      duration: 10,
      aspectRatio: '9:16',
    });
    steps.push('Video production complete');

    this.eventBus.emit('video:produced', {
      floorId,
      taskId,
      path: 'pathB',
      costCents: videoResult.costCents,
      stepCount: steps.length,
    });

    return { videoUrl: videoResult.videoUrl, steps };
  }

  /**
   * Task 6.2: Top-level video production orchestrator
   */
  async produceVideo(
    floorId: string,
    purpose: string,
    prompt: string,
    script?: string,
    voiceId?: string,
  ): Promise<{ videoUrl: string; path: string; steps: string[] }> {
    const path = this.routeVideoProduction(
      purpose as 'ad' | 'hero' | 'social' | 'product',
    );

    if (path === 'pathA') {
      const result = await this.generateVideoPathA(floorId, script || prompt, purpose, voiceId);
      return { ...result, path: 'pathA' };
    } else {
      const result = await this.generateVideoPathB(floorId, prompt, purpose);
      return { ...result, path: 'pathB' };
    }
  }

  /**
   * Task 6.3: Generate UGC-style creative variations
   */
  async generateUGCCreative(
    floorId: string,
    style: UGCStyle,
    product: ProductInfo,
    _script?: string,
  ): Promise<UGCVariation[]> {
    const variations: UGCVariation[] = [];
    let totalCostCents = 0;

    const ugcPrompts: Record<UGCStyle, string> = {
      'avatar-script': `Avatar holding ${product.name}. Professional product demo style. ${product.description}`,
      'authentic-ugc': `Raw, unpolished user-generated content style product demo. ${product.name}. ${product.description}`,
      'product-showcase': `Clean, professional product photography of ${product.name}. ${product.description}`,
    };

    const prompt = ugcPrompts[style];
    const count = 5;

    for (let i = 0; i < count; i++) {
      let result: ImageGenResult;

      if (style === 'authentic-ugc') {
        // Use raw aesthetic model
        result = await generateImage({
          model: 'fal-ai/flux/dev',
          prompt,
          width: 1080,
          height: 1920,
          numImages: 1,
        });
      } else if (style === 'product-showcase') {
        // Use high-quality photorealistic model
        result = await generateImage({
          model: 'fal-ai/flux-pro/v1.1',
          prompt,
          width: 1024,
          height: 1024,
          numImages: 1,
        });
      } else {
        // avatar-script: use standard model
        result = await generateImage({
          model: 'fal-ai/flux/schnell',
          prompt,
          width: 1080,
          height: 1920,
          numImages: 1,
        });
      }

      const url = result.imageUrls[0];
      if (url) {
        variations.push({
          url,
          style,
          variationIndex: i,
        });
      }

      totalCostCents += result.costCents;
    }

    return variations;
  }

  /**
   * Task 6.3: Generate batch of ad variations across all UGC styles
   */
  async generateAdVariationBatch(
    floorId: string,
    product: ProductInfo,
    count: number = 50,
  ): Promise<UGCBatchResult> {
    const styles: UGCStyle[] = ['avatar-script', 'authentic-ugc', 'product-showcase'];
    const variationsPerStyle = Math.ceil(count / styles.length);
    const taskId = `ugc-batch-${Date.now()}`;

    const allVariations: Array<{ url: string; style: string; type: string }> = [];
    let totalCostCents = 0;

    for (const style of styles) {
      const styleVariations = await this.generateUGCCreative(
        floorId,
        style,
        product,
        undefined,
      );

      // Limit to our target per style
      const limited = styleVariations.slice(0, variationsPerStyle);

      allVariations.push(
        ...limited.map(v => ({
          url: v.url,
          style: v.style,
          type: 'ugc-ad',
        })),
      );

      // Rough cost estimate: 3-5 cents per image
      totalCostCents += limited.length * 4;
    }

    // Trim to exactly the requested count
    const trimmed = allVariations.slice(0, count);

    this.eventBus.emit('ugc:batch-generated', {
      floorId,
      taskId,
      count: trimmed.length,
      costCents: totalCostCents,
      styleBreakdown: styles.map(s => ({
        style: s,
        count: trimmed.filter(v => v.style === s).length,
      })),
    });

    return {
      variations: trimmed,
      totalGenerated: trimmed.length,
    };
  }
}
