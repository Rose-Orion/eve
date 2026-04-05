/**
 * ActionExecutor — Bridges agent text output to real-world API actions.
 *
 * When a virtual agent returns structured action specs (JSON blocks tagged with
 * <eve_actions>), the ActionExecutor parses, validates, and executes them through
 * the existing integration wrappers.
 *
 * Safety model:
 *   - LOW risk (generate image, list products): auto-execute
 *   - MEDIUM risk (create product, send email, publish post): execute with logging
 *   - HIGH risk (spend ad budget, create campaign, process payment): require owner approval
 *
 * Action specs are extracted from agent output without modifying the text deliverable.
 * Results are appended to the task output so downstream agents can reference them.
 */

import { z } from 'zod';
import type { EventBus } from './event-bus.js';
import type { BudgetEnforcer } from '../security/budget-enforcer.js';

// ─── Action Schema Definitions ───────────────────────────────────────────────

const StripeCreateProductAction = z.object({
  action: z.literal('stripe.createProduct'),
  params: z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000),
    priceCents: z.number().int().positive().max(999999), // Max $9,999.99
  }),
});

const StripeCreatePaymentLinkAction = z.object({
  action: z.literal('stripe.createPaymentLink'),
  params: z.object({
    priceId: z.string().min(1),
  }),
});

const MetaPublishPostAction = z.object({
  action: z.literal('meta.publishPost'),
  params: z.object({
    message: z.string().min(1).max(5000),
    imageUrl: z.string().url().optional(),
  }),
});

const MetaCreateCampaignAction = z.object({
  action: z.literal('meta.createCampaign'),
  params: z.object({
    name: z.string().min(1).max(200),
    objective: z.string(),
    dailyBudgetCents: z.number().int().positive().max(100000), // Max $1,000/day
  }),
});

const ResendEmailAction = z.object({
  action: z.literal('resend.sendEmail'),
  params: z.object({
    from: z.string().email(),
    to: z.string().email(),
    subject: z.string().min(1).max(500),
    html: z.string().min(1),
    replyTo: z.string().email().optional(),
  }),
});

const KitAddSubscriberAction = z.object({
  action: z.literal('kit.addSubscriber'),
  params: z.object({
    formId: z.string().min(1),
    email: z.string().email(),
    firstName: z.string().max(100),
  }),
});

const KitAddToSequenceAction = z.object({
  action: z.literal('kit.addToSequence'),
  params: z.object({
    sequenceId: z.number().int().positive(),
    email: z.string().email(),
  }),
});

const PrintfulCreateMockupAction = z.object({
  action: z.literal('printful.createMockup'),
  params: z.object({
    productId: z.number().int().positive(),
    imageUrl: z.string().url(),
  }),
});

const FalGenerateImageAction = z.object({
  action: z.literal('fal.generateImage'),
  params: z.object({
    prompt: z.string().min(1).max(5000),
    model: z.string().optional(),
    width: z.number().int().positive().max(2048).optional(),
    height: z.number().int().positive().max(2048).optional(),
    numImages: z.number().int().min(1).max(4).optional(),
  }),
});

const FalGenerateVideoAction = z.object({
  action: z.literal('fal.generateVideo'),
  params: z.object({
    prompt: z.string().min(1).max(5000),
    imageUrl: z.string().url().optional(),
    duration: z.number().positive().max(30).optional(),
  }),
});

const OpenAIGenerateImageAction = z.object({
  action: z.literal('openai.generateImage'),
  params: z.object({
    prompt: z.string().min(1).max(4000),
    size: z.enum(['1024x1024', '1024x1536', '1536x1024']).optional(),
    quality: z.enum(['low', 'medium', 'high']).optional(),
    n: z.number().int().min(1).max(4).optional(),
  }),
});

const ElevenLabsSpeechAction = z.object({
  action: z.literal('elevenlabs.generateSpeech'),
  params: z.object({
    text: z.string().min(1).max(5000),
    voiceId: z.string().optional(),
  }),
});

const VercelDeployAction = z.object({
  action: z.literal('vercel.deploy'),
  params: z.object({
    projectName: z.string().min(1).max(100),
    framework: z.enum(['nextjs', 'static', 'astro']),
    scaffoldType: z.enum(['ecommerce', 'service', 'content', 'personal-brand']).optional(),
    customDomain: z.string().optional(),
    envVars: z.record(z.string()).optional(),
  }),
});

/** Union of all valid action schemas */
const ActionSpec = z.discriminatedUnion('action', [
  StripeCreateProductAction,
  StripeCreatePaymentLinkAction,
  MetaPublishPostAction,
  MetaCreateCampaignAction,
  ResendEmailAction,
  KitAddSubscriberAction,
  KitAddToSequenceAction,
  PrintfulCreateMockupAction,
  FalGenerateImageAction,
  FalGenerateVideoAction,
  OpenAIGenerateImageAction,
  ElevenLabsSpeechAction,
  VercelDeployAction,
]);

type ActionSpec = z.infer<typeof ActionSpec>;

// ─── Risk Classification ─────────────────────────────────────────────────────

type RiskLevel = 'low' | 'medium' | 'high';

const ACTION_RISK_MAP: Record<string, RiskLevel> = {
  // Low risk: media generation, read-only queries
  'fal.generateImage':        'low',
  'fal.generateVideo':        'low',
  'openai.generateImage':     'low',
  'elevenlabs.generateSpeech': 'low',
  'printful.createMockup':    'low',

  // Medium risk: creates real resources, sends communications
  'stripe.createProduct':     'medium',
  'stripe.createPaymentLink': 'medium',
  'resend.sendEmail':         'medium',
  'kit.addSubscriber':        'medium',
  'kit.addToSequence':        'medium',
  'meta.publishPost':         'medium',

  // High risk: spends real money or deploys public infrastructure
  'meta.createCampaign':      'high',
  'vercel.deploy':            'medium',
};

// ─── Action Result ───────────────────────────────────────────────────────────

export interface ActionResult {
  action: string;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  costCents: number;
  riskLevel: RiskLevel;
}

export interface ActionExecutionSummary {
  /** Total actions found in agent output */
  actionsFound: number;
  /** Actions that executed successfully */
  actionsExecuted: number;
  /** Actions that require owner approval (queued) */
  actionsPendingApproval: number;
  /** Actions that failed validation or execution */
  actionsFailed: number;
  /** Individual results */
  results: ActionResult[];
  /** Total cost of all executed actions */
  totalCostCents: number;
}

// ─── Floor Auth Context ──────────────────────────────────────────────────────

export interface FloorAuthContext {
  floorId: string;
  /** Meta Business access token (from OAuth) */
  metaAccessToken?: string;
  metaPageId?: string;
  metaAdAccountId?: string;
  /** TikTok access token (from OAuth) */
  tiktokAccessToken?: string;
  /** Kit/ConvertKit API secret */
  kitApiSecret?: string;
}

// ─── ActionExecutor ──────────────────────────────────────────────────────────

export class ActionExecutor {
  /** Dry-run mode: validate and log actions but don't execute them */
  private dryRun = false;

  constructor(
    private eventBus: EventBus,
    private budgetEnforcer: BudgetEnforcer,
  ) {}

  /** Enable/disable dry-run mode (for testing) */
  setDryRun(enabled: boolean): void {
    this.dryRun = enabled;
  }

  /**
   * Extract action specs from agent output.
   * Looks for JSON blocks wrapped in <eve_actions>...</eve_actions> tags.
   */
  extractActions(agentOutput: string): ActionSpec[] {
    const actions: ActionSpec[] = [];

    // Match <eve_actions> blocks
    const tagPattern = /<eve_actions>([\s\S]*?)<\/eve_actions>/g;
    let match: RegExpExecArray | null;

    while ((match = tagPattern.exec(agentOutput)) !== null) {
      const block = match[1]?.trim();
      if (!block) continue;

      try {
        const parsed = JSON.parse(block);
        // Support both single action and array of actions
        const items = Array.isArray(parsed) ? parsed : [parsed];

        for (const item of items) {
          const validated = ActionSpec.safeParse(item);
          if (validated.success) {
            actions.push(validated.data);
          } else {
            console.warn(`[ActionExecutor] Invalid action spec: ${validated.error.message}`);
          }
        }
      } catch (err) {
        console.warn(`[ActionExecutor] Failed to parse action block: ${(err as Error).message}`);
      }
    }

    return actions;
  }

  /**
   * Execute a set of actions for a task.
   * Validates each action, checks risk level, and routes to appropriate handler.
   */
  async execute(
    floorId: string,
    taskId: string,
    actions: ActionSpec[],
    authContext: FloorAuthContext,
  ): Promise<ActionExecutionSummary> {
    const results: ActionResult[] = [];
    let actionsExecuted = 0;
    let actionsPendingApproval = 0;
    let actionsFailed = 0;
    let totalCostCents = 0;

    for (const action of actions) {
      const riskLevel = ACTION_RISK_MAP[action.action] ?? 'high';

      // High-risk actions require owner approval
      if (riskLevel === 'high') {
        console.log(`[ActionExecutor] HIGH-RISK action "${action.action}" queued for owner approval`);
        this.eventBus.emit('approval:needed', {
          floorId,
          taskId,
          type: `action:${action.action}`,
          summary: `Agent wants to execute: ${action.action} — ${JSON.stringify(action.params).slice(0, 200)}`,
        });
        actionsPendingApproval++;
        results.push({
          action: action.action,
          success: false,
          error: 'Queued for owner approval (high-risk action)',
          costCents: 0,
          riskLevel,
        });
        continue;
      }

      // Budget check for medium-risk actions
      if (riskLevel === 'medium') {
        const estimatedCost = this.estimateActionCost(action);
        const budgetCheck = this.budgetEnforcer.canAfford(floorId, estimatedCost);
        if (!budgetCheck.allowed) {
          console.warn(`[ActionExecutor] Budget check failed for "${action.action}": ${budgetCheck.reason}`);
          actionsFailed++;
          results.push({
            action: action.action,
            success: false,
            error: `Budget exceeded: ${budgetCheck.reason}`,
            costCents: 0,
            riskLevel,
          });
          continue;
        }
      }

      // Dry-run mode: log but don't execute
      if (this.dryRun) {
        console.log(`[ActionExecutor] DRY-RUN: would execute ${action.action} with params:`, action.params);
        results.push({
          action: action.action,
          success: true,
          data: { dryRun: true },
          costCents: 0,
          riskLevel,
        });
        actionsExecuted++;
        continue;
      }

      // Execute the action
      try {
        const result = await this.executeAction(action, authContext);
        results.push(result);

        if (result.success) {
          actionsExecuted++;
          totalCostCents += result.costCents;

          // Record cost
          if (result.costCents > 0) {
            this.eventBus.emit('cost:recorded', { floorId, taskId, costCents: result.costCents });
          }

          console.log(`[ActionExecutor] Executed ${action.action} successfully (cost: ${result.costCents}¢)`);
        } else {
          actionsFailed++;
          console.warn(`[ActionExecutor] Action ${action.action} failed: ${result.error}`);
        }
      } catch (err) {
        actionsFailed++;
        results.push({
          action: action.action,
          success: false,
          error: (err as Error).message,
          costCents: 0,
          riskLevel,
        });
        console.error(`[ActionExecutor] Error executing ${action.action}: ${(err as Error).message}`);
      }
    }

    return {
      actionsFound: actions.length,
      actionsExecuted,
      actionsPendingApproval,
      actionsFailed,
      results,
      totalCostCents,
    };
  }

  /**
   * Route and execute a single action through the appropriate integration.
   */
  private async executeAction(action: ActionSpec, auth: FloorAuthContext): Promise<ActionResult> {
    const riskLevel = ACTION_RISK_MAP[action.action] ?? 'high';

    switch (action.action) {
      // ── Stripe ──
      case 'stripe.createProduct': {
        const { createProduct } = await import('../integrations/stripe.js');
        const product = await createProduct(action.params.name, action.params.description, action.params.priceCents);
        return { action: action.action, success: true, data: product as unknown as Record<string, unknown>, costCents: 0, riskLevel };
      }
      case 'stripe.createPaymentLink': {
        const { createPaymentLink } = await import('../integrations/stripe.js');
        const url = await createPaymentLink(action.params.priceId);
        return { action: action.action, success: true, data: { url }, costCents: 0, riskLevel };
      }

      // ── Meta ──
      case 'meta.publishPost': {
        if (!auth.metaAccessToken || !auth.metaPageId) {
          return { action: action.action, success: false, error: 'Meta OAuth not configured for this floor', costCents: 0, riskLevel };
        }
        const { publishPost } = await import('../integrations/meta.js');
        const post = await publishPost(auth.metaAccessToken, auth.metaPageId, action.params.message, action.params.imageUrl);
        return { action: action.action, success: true, data: post as unknown as Record<string, unknown>, costCents: 0, riskLevel };
      }
      case 'meta.createCampaign': {
        if (!auth.metaAccessToken || !auth.metaAdAccountId) {
          return { action: action.action, success: false, error: 'Meta Ads OAuth not configured for this floor', costCents: 0, riskLevel };
        }
        const { createCampaign } = await import('../integrations/meta.js');
        const campaign = await createCampaign(auth.metaAccessToken, auth.metaAdAccountId, action.params.name, action.params.objective, action.params.dailyBudgetCents);
        return { action: action.action, success: true, data: campaign as unknown as Record<string, unknown>, costCents: 0, riskLevel };
      }

      // ── Email (Resend) ──
      case 'resend.sendEmail': {
        const { sendEmail } = await import('../integrations/resend.js');
        const result = await sendEmail(action.params);
        return { action: action.action, success: result.success, data: { id: result.id }, costCents: 0, riskLevel };
      }

      // ── Kit (ConvertKit) ──
      case 'kit.addSubscriber': {
        if (!auth.kitApiSecret) {
          return { action: action.action, success: false, error: 'Kit API secret not configured for this floor', costCents: 0, riskLevel };
        }
        const { addSubscriber } = await import('../integrations/kit.js');
        const sub = await addSubscriber(auth.kitApiSecret, action.params.formId, action.params.email, action.params.firstName);
        return { action: action.action, success: !!sub, data: sub as unknown as Record<string, unknown> ?? undefined, costCents: 0, riskLevel };
      }
      case 'kit.addToSequence': {
        if (!auth.kitApiSecret) {
          return { action: action.action, success: false, error: 'Kit API secret not configured for this floor', costCents: 0, riskLevel };
        }
        const { addToSequence } = await import('../integrations/kit.js');
        const ok = await addToSequence(auth.kitApiSecret, action.params.sequenceId, action.params.email);
        return { action: action.action, success: ok, costCents: 0, riskLevel };
      }

      // ── Printful ──
      case 'printful.createMockup': {
        const { createMockup } = await import('../integrations/printful.js');
        const mockup = await createMockup(action.params.productId, action.params.imageUrl);
        return { action: action.action, success: true, data: mockup as unknown as Record<string, unknown>, costCents: 0, riskLevel };
      }

      // ── fal.ai (Images + Video) ──
      case 'fal.generateImage': {
        const { generateImage } = await import('../clients/fal.js');
        // Resolve short model names to full fal.ai IDs
        const rawModel = (action.params.model ?? 'fal-ai/flux/dev').toLowerCase().trim();
        const MODEL_MAP: Record<string, string> = {
          'recraft': 'fal-ai/recraft/v3/text-to-image', 'recraft-v3': 'fal-ai/recraft/v3/text-to-image',
          'flux': 'fal-ai/flux/dev', 'flux-dev': 'fal-ai/flux/dev',
          'flux-pro': 'fal-ai/flux-pro', 'flux-schnell': 'fal-ai/flux/schnell',
          'ideogram': 'fal-ai/ideogram/v2', 'ideogram-v2': 'fal-ai/ideogram/v2',
          'gpt-image': 'fal-ai/ideogram/v2', // fallback: gpt-image → ideogram for text-in-images
        };
        const resolvedModel = MODEL_MAP[rawModel] ?? (rawModel.startsWith('fal-ai/') ? rawModel : `fal-ai/${rawModel}`);
        console.log(`[ActionExecutor] fal.generateImage: ${rawModel} → ${resolvedModel} (${action.params.width ?? 1024}x${action.params.height ?? 1024})`);
        // 60-second timeout to prevent orphaned tasks
        const imagePromise = generateImage({
          prompt: action.params.prompt,
          model: resolvedModel,
          width: action.params.width ?? 1024,
          height: action.params.height ?? 1024,
          numImages: action.params.numImages,
        });
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('fal.ai image generation timed out after 60s')), 60_000)
        );
        const result = await Promise.race([imagePromise, timeoutPromise]);
        console.log(`[ActionExecutor] fal.generateImage SUCCESS: ${result.imageUrls.length} image(s) generated`);
        return { action: action.action, success: true, data: { urls: result.imageUrls, costCents: result.costCents }, costCents: result.costCents, riskLevel };
      }
      case 'fal.generateVideo': {
        const { generateVideo } = await import('../clients/fal.js');
        const result = await generateVideo({
          model: 'fal-ai/runway-gen3/turbo',
          prompt: action.params.prompt,
          imageUrl: action.params.imageUrl,
          duration: action.params.duration,
        });
        return { action: action.action, success: true, data: { url: result.videoUrl, costCents: result.costCents }, costCents: result.costCents, riskLevel };
      }

      // ── OpenAI (GPT Image) ──
      case 'openai.generateImage': {
        const { generateGptImage } = await import('../clients/openai.js');
        const result = await generateGptImage({
          prompt: action.params.prompt,
          size: action.params.size ?? '1024x1024',
          quality: action.params.quality ?? 'medium',
          n: action.params.n ?? 1,
        });
        return { action: action.action, success: true, data: { urls: result.imageUrls, costCents: result.costCents }, costCents: result.costCents, riskLevel };
      }

      // ── ElevenLabs (Voice) ──
      case 'elevenlabs.generateSpeech': {
        const { generateSpeech } = await import('../clients/elevenlabs.js');
        const result = await generateSpeech({
          text: action.params.text,
          voiceId: action.params.voiceId ?? 'default',
        });
        return { action: action.action, success: true, data: { audioSize: result.audioBuffer.byteLength, costCents: result.costCents }, costCents: result.costCents, riskLevel };
      }

      // ── Vercel (Website Deployment) ──
      case 'vercel.deploy': {
        const { WebsiteDeployer } = await import('./website-deployer.js');
        const { ScaffoldGenerator } = await import('./scaffold-generator.js');
        const deployer = new WebsiteDeployer(this.eventBus);
        const scaffold = new ScaffoldGenerator();

        // Generate scaffold files if scaffoldType is provided
        // In production, the Web Agent would provide full file contents
        const files = action.params.scaffoldType
          ? scaffold.generate(action.params.scaffoldType, {
              businessName: action.params.projectName,
              tagline: '',
              colorPrimary: '#000000',
              colorSecondary: '#666666',
              colorNeutral: '#999999',
              fontHeading: 'Inter',
              fontBody: 'Inter',
              description: '',
            }).files
          : [];

        const result = await deployer.deploy({
          floorId: auth.floorId,
          floorSlug: action.params.projectName,
          projectName: action.params.projectName,
          framework: action.params.framework,
          files,
          envVars: action.params.envVars,
          customDomain: action.params.customDomain,
        });

        return {
          action: action.action,
          success: result.success,
          data: result.success ? { deploymentUrl: result.deploymentUrl, vercelUrl: result.vercelUrl, projectId: result.projectId } : undefined,
          error: result.error,
          costCents: 0,
          riskLevel,
        };
      }

      default:
        return { action: (action as { action: string }).action, success: false, error: `Unknown action: ${(action as { action: string }).action}`, costCents: 0, riskLevel };
    }
  }

  /**
   * Estimate cost for an action (used for budget checks before execution).
   */
  private estimateActionCost(action: ActionSpec): number {
    switch (action.action) {
      case 'fal.generateImage': return 500;       // ~$5 per image
      case 'fal.generateVideo': return 2500;       // ~$25 per video
      case 'openai.generateImage': return 700;     // ~$7 per image
      case 'elevenlabs.generateSpeech': return 30;  // ~$0.30 per 1K chars
      case 'meta.createCampaign': return action.params.dailyBudgetCents;
      case 'vercel.deploy': return 0; // Vercel hobby tier is free
      default: return 0; // Stripe, Resend, Kit, Printful have no EVE-side cost
    }
  }

  /**
   * Format action results as a text block to append to task output.
   * This allows downstream agents to reference executed action results.
   */
  formatResultsForOutput(summary: ActionExecutionSummary): string {
    if (summary.actionsFound === 0) return '';

    const lines: string[] = [
      '',
      '---',
      'EVE ACTION EXECUTION RESULTS:',
    ];

    for (const result of summary.results) {
      const status = result.success ? 'SUCCESS' : 'FAILED';
      lines.push(`  [${status}] ${result.action} (${result.riskLevel} risk, ${result.costCents}¢)`);
      if (result.data) {
        lines.push(`    Data: ${JSON.stringify(result.data).slice(0, 500)}`);
      }
      if (result.error) {
        lines.push(`    Error: ${result.error}`);
      }
    }

    lines.push(`  Total: ${summary.actionsExecuted} executed, ${summary.actionsPendingApproval} pending approval, ${summary.actionsFailed} failed (${summary.totalCostCents}¢)`);
    lines.push('---');

    return lines.join('\n');
  }
}
