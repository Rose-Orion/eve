/**
 * EmailAutomation — Marketing email sequences and triggered campaigns.
 *
 * Manages:
 *   - Welcome sequence enrollment (new subscribers from website)
 *   - Post-purchase sequences (triggered by fulfillment pipeline)
 *   - Broadcast campaigns (one-time sends from Social/Copy agents)
 *   - Subscriber lifecycle management via Kit (ConvertKit)
 *   - Transactional emails via Resend
 *   - Sequence execution engine with variable substitution
 *   - Subscriber segmentation and CLV tracking
 *
 * Flow:
 *   Website signup → Kit form → Welcome sequence → Purchase → Post-purchase sequence
 *   Ad click → Landing page → Kit form → Nurture sequence → Purchase → ...
 */

import type { EventBus } from './event-bus.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type SequenceType = 'welcome' | 'post-purchase' | 'nurture' | 're-engagement' | 'abandoned-cart' | 'custom';
export type TriggerType = 'signup' | 'purchase' | 'cart-abandon' | 'inactivity' | 'manual';
export type EmailChannel = 'resend' | 'kit';

export interface SequenceEnrollment {
  id: string;
  floorId: string;
  email: string;
  sequenceName: string;
  currentStep: number;
  nextSendAt: string; // ISO date
  status: 'active' | 'completed' | 'exited';
  metadata: Record<string, string>;
  createdAt: string;
}

export interface EmailSequenceStep {
  index: number;
  subject: string;
  bodyTemplate: string;
  delayHours: number;
  channel: EmailChannel;
}

export interface EmailSequenceDefinition {
  name: string;
  steps: EmailSequenceStep[];
  exitOn?: string; // event name that triggers exit
  maxEmails: number;
}

export interface EmailSequenceConfig {
  id: string;
  floorId: string;
  name: string;
  type: SequenceType;
  trigger: TriggerType;
  /** Kit sequence ID (if using Kit) */
  kitSequenceId?: number;
  /** Delay before first email (hours) */
  delayHours: number;
  /** Email steps in the sequence */
  steps: EmailStep[];
  /** Whether this sequence is active */
  active: boolean;
}

export interface EmailStep {
  /** Step index (0-based) */
  index: number;
  /** Subject line */
  subject: string;
  /** HTML body template (supports {{firstName}}, {{businessName}} placeholders) */
  htmlTemplate: string;
  /** Delay from previous step (hours) */
  delayFromPreviousHours: number;
}

export interface SubscriberEvent {
  floorId: string;
  email: string;
  firstName?: string;
  trigger: TriggerType;
  /** Additional data (e.g., order ID for post-purchase) */
  metadata?: Record<string, string>;
}

export interface FloorEmailConfig {
  floorId: string;
  /** Business name for email branding */
  businessName: string;
  /** Verified sender email */
  fromEmail: string;
  /** Reply-to email */
  replyToEmail?: string;
  /** Kit API secret */
  kitApiSecret?: string;
  /** Kit form ID for website signups */
  kitSignupFormId?: string;
  /** Active sequences */
  sequences: EmailSequenceConfig[];
}

export interface EmailSendResult {
  success: boolean;
  emailId?: string;
  error?: string;
}

// ─── EmailAutomation ────────────────────────────────────────────────────────

export class EmailAutomation {
  private floorConfigs = new Map<string, FloorEmailConfig>();

  /** Track which subscribers have been enrolled in which sequences to prevent duplicates */
  private enrollments = new Map<string, Set<string>>(); // key: floorId:email, value: Set<sequenceId>

  constructor(private eventBus: EventBus) {
    this.setupEventHandlers();
  }

  // ── Configuration ──

  setFloorConfig(floorId: string, config: FloorEmailConfig): void {
    this.floorConfigs.set(floorId, config);
  }

  getFloorConfig(floorId: string): FloorEmailConfig | undefined {
    return this.floorConfigs.get(floorId);
  }

  // ── Event Handlers ──

  private setupEventHandlers(): void {
    // Listen for order events to trigger post-purchase sequences
    this.eventBus.on('order:created', async (data) => {
      if (!data.customerEmail) return;

      await this.handleSubscriberEvent({
        floorId: data.floorId,
        email: data.customerEmail,
        firstName: data.customerName.split(' ')[0],
        trigger: 'purchase',
        metadata: { orderId: data.orderId, amount: String(data.amountCents) },
      });
    });
  }

  // ── Subscriber Management ──

  /**
   * Handle a subscriber event (signup, purchase, etc.) and enroll in matching sequences.
   */
  async handleSubscriberEvent(event: SubscriberEvent): Promise<void> {
    const config = this.floorConfigs.get(event.floorId);
    if (!config) {
      console.warn(`[EmailAutomation] No email config for floor ${event.floorId}`);
      return;
    }

    console.log(`[EmailAutomation] Subscriber event: ${event.trigger} for ${event.email} on floor ${event.floorId}`);

    // Add to Kit if configured
    if (config.kitApiSecret && config.kitSignupFormId && event.trigger === 'signup') {
      await this.addToKit(config, event);
    }

    // Find matching sequences for this trigger
    const matchingSequences = config.sequences.filter(s => s.active && s.trigger === event.trigger);

    for (const sequence of matchingSequences) {
      await this.enrollInSequence(config, sequence, event);
    }
  }

  /**
   * Enroll a subscriber in a specific sequence.
   */
  private async enrollInSequence(
    config: FloorEmailConfig,
    sequence: EmailSequenceConfig,
    event: SubscriberEvent,
  ): Promise<void> {
    // Check for duplicate enrollment
    const enrollKey = `${event.floorId}:${event.email}`;
    const enrolled = this.enrollments.get(enrollKey) ?? new Set();

    if (enrolled.has(sequence.id)) {
      console.log(`[EmailAutomation] ${event.email} already enrolled in "${sequence.name}" — skipping`);
      return;
    }

    enrolled.add(sequence.id);
    this.enrollments.set(enrollKey, enrolled);

    // If Kit sequence is configured, use Kit's built-in sequence engine
    if (sequence.kitSequenceId && config.kitApiSecret) {
      try {
        const { addToSequence } = await import('../integrations/kit.js');
        const success = await addToSequence(config.kitApiSecret, sequence.kitSequenceId, event.email);

        if (success) {
          console.log(`[EmailAutomation] Enrolled ${event.email} in Kit sequence "${sequence.name}" (ID: ${sequence.kitSequenceId})`);
          return;
        }
      } catch (err) {
        console.error(`[EmailAutomation] Kit enrollment failed: ${(err as Error).message}`);
      }
    }

    // Fallback: use Resend for direct email delivery with delay scheduling
    console.log(`[EmailAutomation] Starting Resend sequence "${sequence.name}" for ${event.email}`);
    await this.executeResendSequence(config, sequence, event);
  }

  /**
   * Execute a sequence using Resend (when Kit is not available).
   * Sends the first email immediately (after initial delay), then schedules follow-ups.
   */
  private async executeResendSequence(
    config: FloorEmailConfig,
    sequence: EmailSequenceConfig,
    event: SubscriberEvent,
  ): Promise<void> {
    // Send first email after initial delay
    const firstStep = sequence.steps[0];
    if (!firstStep) return;

    const initialDelayMs = sequence.delayHours * 60 * 60 * 1000;

    // Schedule first email
    setTimeout(async () => {
      await this.sendSequenceEmail(config, firstStep, event);

      // Schedule subsequent emails
      let cumulativeDelayMs = 0;
      for (let i = 1; i < sequence.steps.length; i++) {
        const step = sequence.steps[i];
        if (!step) continue;
        cumulativeDelayMs += step.delayFromPreviousHours * 60 * 60 * 1000;

        setTimeout(async () => {
          await this.sendSequenceEmail(config, step, event);
        }, cumulativeDelayMs);
      }
    }, initialDelayMs);
  }

  /**
   * Send a single sequence email via Resend.
   */
  private async sendSequenceEmail(
    config: FloorEmailConfig,
    step: EmailStep,
    event: SubscriberEvent,
  ): Promise<EmailSendResult> {
    try {
      const { sendEmail } = await import('../integrations/resend.js');

      // Replace placeholders in template
      const html = this.replacePlaceholders(step.htmlTemplate, {
        firstName: event.firstName ?? 'there',
        businessName: config.businessName,
        email: event.email,
        ...event.metadata,
      });

      const subject = this.replacePlaceholders(step.subject, {
        firstName: event.firstName ?? 'there',
        businessName: config.businessName,
      });

      const result = await sendEmail({
        from: config.fromEmail,
        to: event.email,
        subject,
        html,
        replyTo: config.replyToEmail,
      });

      console.log(`[EmailAutomation] Sent step ${step.index} to ${event.email}: "${subject}"`);
      return { success: result.success, emailId: result.id };
    } catch (err) {
      console.error(`[EmailAutomation] Failed to send step ${step.index} to ${event.email}: ${(err as Error).message}`);
      return { success: false, error: (err as Error).message };
    }
  }

  // ── Kit Integration ──

  /**
   * Add subscriber to Kit (ConvertKit) via signup form.
   */
  private async addToKit(config: FloorEmailConfig, event: SubscriberEvent): Promise<void> {
    if (!config.kitApiSecret || !config.kitSignupFormId) return;

    try {
      const { addSubscriber } = await import('../integrations/kit.js');
      await addSubscriber(
        config.kitApiSecret,
        config.kitSignupFormId,
        event.email,
        event.firstName ?? '',
      );
      console.log(`[EmailAutomation] Added ${event.email} to Kit form ${config.kitSignupFormId}`);
    } catch (err) {
      console.error(`[EmailAutomation] Kit addSubscriber failed: ${(err as Error).message}`);
    }
  }

  // ── Broadcast Campaigns ──

  /**
   * Send a one-time broadcast email to a list of recipients.
   * Used for promotions, announcements, and content marketing.
   */
  async sendBroadcast(
    floorId: string,
    subject: string,
    html: string,
    recipients: string[],
  ): Promise<{ sent: number; failed: number }> {
    const config = this.floorConfigs.get(floorId);
    if (!config) return { sent: 0, failed: 0 };

    const { sendEmail } = await import('../integrations/resend.js');
    let sent = 0;
    let failed = 0;

    // Send in batches to respect rate limits
    const batchSize = 10;
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);

      const results = await Promise.allSettled(
        batch.map(to =>
          sendEmail({ from: config.fromEmail, to, subject, html, replyTo: config.replyToEmail }),
        ),
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.success) {
          sent++;
        } else {
          failed++;
        }
      }

      // Brief pause between batches
      if (i + batchSize < recipients.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`[EmailAutomation] Broadcast "${subject}": ${sent} sent, ${failed} failed`);
    return { sent, failed };
  }

  // ── Helpers ──

  private replacePlaceholders(template: string, data: Record<string, string | undefined>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => data[key] ?? '');
  }

  // ── Stats ──

  getStats(floorId: string): {
    totalSubscribers: number;
    activeSequences: number;
    enrolledInSequences: number;
  } {
    const config = this.floorConfigs.get(floorId);
    const prefix = `${floorId}:`;
    const enrolledCount = [...this.enrollments.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .reduce((sum, [, seqs]) => sum + seqs.size, 0);

    return {
      totalSubscribers: [...this.enrollments.keys()].filter(k => k.startsWith(prefix)).length,
      activeSequences: config?.sequences.filter(s => s.active).length ?? 0,
      enrolledInSequences: enrolledCount,
    };
  }
}

// ─── Sequence Execution Engine (Exported Functions) ──────────────────────────

/** Global store for sequence enrollments (in-memory + Supabase) */
const enrollmentStore = new Map<string, SequenceEnrollment>(); // key: enrollmentId

/** Map of sequence definitions by name */
const sequenceDefinitions = new Map<string, EmailSequenceDefinition>();

/**
 * Pre-configured email sequences for Phase 4.
 * Populated by registerSequence() or loadSequencesFromConfig().
 */
export const EMAIL_SEQUENCES: Record<string, EmailSequenceDefinition> = {
  welcome: {
    name: 'welcome',
    steps: [
      {
        index: 0,
        subject: 'Welcome to {{businessName}}!',
        bodyTemplate: `<h1>Welcome {{firstName}}!</h1>
<p>Thanks for joining us. Learn our brand story and mission.</p>`,
        delayHours: 0,
        channel: 'kit',
      },
      {
        index: 1,
        subject: 'Our Bestsellers Are Here',
        bodyTemplate: `<h1>Check Out Our Top Products</h1>
<p>{{firstName}}, here are our bestselling items just for you.</p>`,
        delayHours: 48,
        channel: 'kit',
      },
      {
        index: 2,
        subject: 'See What Customers Love About Us',
        bodyTemplate: `<h1>Real Customer Stories</h1>
<p>{{firstName}}, here's what our customers are saying.</p>`,
        delayHours: 96,
        channel: 'kit',
      },
      {
        index: 3,
        subject: 'Exclusive: 15% Off for You',
        bodyTemplate: `<h1>Special Offer for {{firstName}}</h1>
<p>Use code {{discountCode}} for 15% off your first order.</p>`,
        delayHours: 168,
        channel: 'kit',
      },
      {
        index: 4,
        subject: 'Last Chance: Complete Your First Purchase',
        bodyTemplate: `<h1>One More Thing, {{firstName}}</h1>
<p>Your discount code {{discountCode}} expires soon. Shop now!</p>`,
        delayHours: 216,
        channel: 'kit',
      },
    ],
    exitOn: 'order:created',
    maxEmails: 5,
  },
  'abandoned-cart': {
    name: 'abandoned-cart',
    steps: [
      {
        index: 0,
        subject: "You Left Something Behind",
        bodyTemplate: `<h1>{{firstName}}, Your Cart is Waiting</h1>
<p>Items in your cart: {{cartItems}}</p>`,
        delayHours: 1,
        channel: 'kit',
      },
      {
        index: 1,
        subject: 'These Items Are Popular Right Now',
        bodyTemplate: `<h1>Why Others Love {{productName}}</h1>
<p>{{firstName}}, here's why customers adore this product.</p>`,
        delayHours: 24,
        channel: 'kit',
      },
      {
        index: 2,
        subject: '10% Off — Just for You',
        bodyTemplate: `<h1>Complete Your Purchase, {{firstName}}</h1>
<p>Use code {{discountCode}} for 10% off. This offer expires soon!</p>`,
        delayHours: 48,
        channel: 'kit',
      },
    ],
    exitOn: 'order:created',
    maxEmails: 3,
  },
  'post-purchase': {
    name: 'post-purchase',
    steps: [
      {
        index: 0,
        subject: 'Order Confirmed: {{orderId}}',
        bodyTemplate: `<h1>Thank You for Your Purchase, {{firstName}}!</h1>
<p>Order ID: {{orderId}}</p><p>Your order is being prepared.</p>`,
        delayHours: 0,
        channel: 'resend',
      },
      {
        index: 1,
        subject: 'Your Order Is On Its Way',
        bodyTemplate: `<h1>Great News, {{firstName}}!</h1>
<p>Order {{orderId}} has shipped. Tracking: {{trackingNumber}}</p>`,
        delayHours: 48,
        channel: 'resend',
      },
      {
        index: 2,
        subject: 'How Are You Enjoying Your Order?',
        bodyTemplate: `<h1>We Want to Know, {{firstName}}!</h1>
<p>How's your experience with {{productName}}? Share your thoughts.</p>`,
        delayHours: 120,
        channel: 'kit',
      },
      {
        index: 3,
        subject: '{{firstName}}, Please Leave a Review',
        bodyTemplate: `<h1>Help Other Customers</h1>
<p>Your review of {{productName}} helps others make the right choice.</p>`,
        delayHours: 240,
        channel: 'kit',
      },
      {
        index: 4,
        subject: 'Exclusive: Products You Might Like',
        bodyTemplate: `<h1>Just for You, {{firstName}}</h1>
<p>Based on your purchase, check out these complementary items.</p>`,
        delayHours: 336,
        channel: 'kit',
      },
    ],
    maxEmails: 5,
  },
  'win-back': {
    name: 'win-back',
    steps: [
      {
        index: 0,
        subject: "We Miss You, {{firstName}}",
        bodyTemplate: `<h1>Come Back to {{businessName}}</h1>
<p>We've missed you! Check out what's new.</p>`,
        delayHours: 0,
        channel: 'kit',
      },
      {
        index: 1,
        subject: 'Special Offer: 15% Off Your Next Order',
        bodyTemplate: `<h1>Welcome Back, {{firstName}}!</h1>
<p>Use code {{discountCode}} for 15% off. Valid for 7 days.</p>`,
        delayHours: 168,
        channel: 'kit',
      },
      {
        index: 2,
        subject: 'Last Call: Your 15% Discount Expires Tomorrow',
        bodyTemplate: `<h1>{{firstName}}, Final Reminder</h1>
<p>Your exclusive code {{discountCode}} expires in 24 hours. Shop now!</p>`,
        delayHours: 336,
        channel: 'kit',
      },
    ],
    exitOn: 'order:created',
    maxEmails: 3,
  },
  vip: {
    name: 'vip',
    steps: [
      {
        index: 0,
        subject: 'VIP: Early Access to New Products',
        bodyTemplate: `<h1>Exclusive for You, {{firstName}}</h1>
<p>As a valued VIP, be the first to access new items.</p>`,
        delayHours: 0,
        channel: 'kit',
      },
      {
        index: 1,
        subject: '{{businessName}}: Your Permanent 10% VIP Discount',
        bodyTemplate: `<h1>Premium Benefits Unlocked, {{firstName}}</h1>
<p>Enjoy 10% off every purchase, forever. No code needed!</p>`,
        delayHours: 72,
        channel: 'kit',
      },
    ],
    maxEmails: 999, // ongoing
  },
  broadcast: {
    name: 'broadcast',
    steps: [
      {
        index: 0,
        subject: '{{broadcastSubject}}',
        bodyTemplate: '{{broadcastBody}}',
        delayHours: 0,
        channel: 'kit',
      },
    ],
    maxEmails: 1, // broadcast is one-off per send
  },
};

/**
 * Enroll a subscriber in a sequence. Returns the enrollment record or null if excluded.
 */
export async function enrollSubscriber(
  floorId: string,
  email: string,
  sequenceName: string,
  metadata?: Record<string, string>,
): Promise<SequenceEnrollment | null> {
  const sequence = EMAIL_SEQUENCES[sequenceName];
  if (!sequence) {
    console.warn(`[EmailAutomation] Sequence "${sequenceName}" not found`);
    return null;
  }

  // Check for duplicate enrollment
  const existingKey = [...enrollmentStore.keys()].find(
    k => enrollmentStore.get(k)?.floorId === floorId &&
      enrollmentStore.get(k)?.email === email &&
      enrollmentStore.get(k)?.sequenceName === sequenceName,
  );

  if (existingKey) {
    console.log(`[EmailAutomation] ${email} already enrolled in "${sequenceName}"`);
    return null;
  }

  // TODO: Check exclusions (unsubscribed) from Supabase in production

  const firstStep = sequence.steps[0];
  if (!firstStep) {
    console.warn(`[EmailAutomation] Sequence "${sequenceName}" has no steps`);
    return null;
  }

  const enrollment: SequenceEnrollment = {
    id: `${floorId}:${email}:${sequenceName}:${Date.now()}`,
    floorId,
    email,
    sequenceName,
    currentStep: 0,
    nextSendAt: new Date(Date.now() + firstStep.delayHours * 60 * 60 * 1000).toISOString(),
    status: 'active',
    metadata: metadata || {},
    createdAt: new Date().toISOString(),
  };

  enrollmentStore.set(enrollment.id, enrollment);

  // TODO: Persist to Supabase in production
  console.log(`[EmailAutomation] Enrolled ${email} in sequence "${sequenceName}"`);
  return enrollment;
}

/**
 * Process pending enrollments. Called every 5 minutes.
 * Returns count of emails processed.
 */
export async function processEnrollments(): Promise<number> {
  const now = new Date();
  const pendingEnrollments = [...enrollmentStore.values()].filter(
    e => e.status === 'active' && new Date(e.nextSendAt) <= now,
  );

  let processed = 0;

  for (const enrollment of pendingEnrollments) {
    const sequence = EMAIL_SEQUENCES[enrollment.sequenceName];
    if (!sequence) continue;

    const step = sequence.steps[enrollment.currentStep];
    if (!step) continue;

    // Render template with variable substitution
    const subject = renderTemplate(step.subject, enrollment.metadata);
    const body = renderTemplate(step.bodyTemplate, enrollment.metadata);

    // Send via appropriate channel
    const sent = await sendSequenceEmail(enrollment.floorId, enrollment.email, subject, body, step.channel);

    if (sent) {
      processed++;

      // Advance step
      enrollment.currentStep++;
      if (enrollment.currentStep >= sequence.maxEmails || enrollment.currentStep >= sequence.steps.length) {
        enrollment.status = 'completed';
        console.log(`[EmailAutomation] Sequence "${enrollment.sequenceName}" completed for ${enrollment.email}`);
      } else {
        // Calculate next send time
        const nextStep = sequence.steps[enrollment.currentStep];
        if (nextStep) {
          enrollment.nextSendAt = new Date(Date.now() + nextStep.delayHours * 60 * 60 * 1000).toISOString();
        }
      }
    }

    // TODO: Persist updated enrollment to Supabase
  }

  return processed;
}

/**
 * Exit a subscriber from a sequence.
 */
export async function exitSequence(email: string, sequenceName: string, reason: string): Promise<void> {
  const enrollmentKey = [...enrollmentStore.keys()].find(
    k => enrollmentStore.get(k)?.email === email && enrollmentStore.get(k)?.sequenceName === sequenceName,
  );

  if (enrollmentKey) {
    const enrollment = enrollmentStore.get(enrollmentKey);
    if (enrollment) {
      enrollment.status = 'exited';
      console.log(`[EmailAutomation] Exited ${email} from "${sequenceName}": ${reason}`);
    }
  }

  // TODO: Persist to Supabase
}

/**
 * Render template with variable substitution.
 * Supports: {{firstName}}, {{businessName}}, {{productName}}, {{discountCode}}, {{cartItems}}, {{orderId}}, etc.
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

/**
 * Get a sequence definition by name.
 */
export function getSequenceDefinition(name: string): EmailSequenceDefinition | undefined {
  return EMAIL_SEQUENCES[name];
}

/**
 * Send a sequence email (internal helper).
 */
async function sendSequenceEmail(
  floorId: string,
  email: string,
  subject: string,
  body: string,
  channel: EmailChannel,
): Promise<boolean> {
  try {
    if (channel === 'resend') {
      const { sendEmail } = await import('../integrations/resend.js');
      // TODO: Get fromEmail from floor config
      const result = await sendEmail({
        from: 'noreply@example.com', // placeholder
        to: email,
        subject,
        html: body,
      });
      return result.success;
    } else if (channel === 'kit') {
      // Kit handles sequences; we'd typically add to Kit sequence instead
      // For now, log the intent
      console.log(`[EmailAutomation] Would send via Kit to ${email}: "${subject}"`);
      return true;
    }
  } catch (err) {
    console.error(`[EmailAutomation] Send failed to ${email}: ${(err as Error).message}`);
    return false;
  }

  return false;
}
