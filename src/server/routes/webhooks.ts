/**
 * Stripe Webhook Handler — Receives payment events and triggers fulfillment.
 *
 * Handles:
 *   - checkout.session.completed → new order → fulfillment pipeline
 *   - payment_intent.succeeded → revenue tracking
 *   - charge.refunded → refund processing
 *
 * Security:
 *   - Verifies Stripe webhook signature (STRIPE_WEBHOOK_SECRET)
 *   - Raw body preserved via Fastify plugin encapsulation for signature verification
 *   - Idempotent event processing (deduplicates by event ID)
 */

import type { FastifyInstance } from 'fastify';
import type { Orchestrator } from '../../orchestrator/index.js';
import { getConfig } from '../../config/index.js';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Track processed event IDs to prevent double-processing
const processedEvents = new Set<string>();
const MAX_PROCESSED_EVENTS = 10_000;

export function registerWebhookRoutes(app: FastifyInstance, orchestrator: Orchestrator) {

  // Use Fastify's register() encapsulation so the raw body parser
  // only applies to routes inside this plugin scope, not globally.
  app.register(async function webhookPlugin(instance) {

    // Override JSON parser to preserve raw body as Buffer inside this scope only
    instance.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (_req, body, done) => {
        done(null, body);
      },
    );

    instance.post('/api/webhooks/stripe', async (request, reply) => {
      const config = getConfig();
      const rawBody = request.body as Buffer;

      // Verify webhook signature
      if (config.STRIPE_WEBHOOK_SECRET) {
        const signature = request.headers['stripe-signature'] as string | undefined;
        if (!signature) {
          return reply.code(400).send({ error: 'Missing stripe-signature header' });
        }

        const verified = verifyStripeSignature(rawBody, signature, config.STRIPE_WEBHOOK_SECRET);
        if (!verified) {
          console.warn('[Webhook] Stripe signature verification failed');
          return reply.code(401).send({ error: 'Invalid signature' });
        }
      }

      // Parse event
      let event: StripeEvent;
      try {
        event = JSON.parse(rawBody.toString()) as StripeEvent;
      } catch {
        return reply.code(400).send({ error: 'Invalid JSON body' });
      }

      // Idempotency check
      if (processedEvents.has(event.id)) {
        return reply.code(200).send({ received: true, duplicate: true });
      }

      // Housekeeping: prevent memory leak
      if (processedEvents.size > MAX_PROCESSED_EVENTS) {
        const toDelete = [...processedEvents].slice(0, processedEvents.size - MAX_PROCESSED_EVENTS / 2);
        for (const id of toDelete) processedEvents.delete(id);
      }

      processedEvents.add(event.id);

      console.log(`[Webhook] Stripe event: ${event.type} (${event.id})`);

      // Route event to handler
      try {
        switch (event.type) {
          case 'checkout.session.completed':
            await handleCheckoutCompleted(orchestrator, event.data.object as unknown as CheckoutSession);
            break;

          case 'payment_intent.succeeded':
            await handlePaymentSucceeded(orchestrator, event.data.object as unknown as PaymentIntent);
            break;

          case 'charge.refunded':
            await handleRefund(orchestrator, event.data.object as unknown as Charge);
            break;

          default:
            console.log(`[Webhook] Unhandled Stripe event type: ${event.type}`);
        }
      } catch (err) {
        console.error(`[Webhook] Error handling ${event.type}: ${(err as Error).message}`);
        // Return 200 to prevent Stripe from retrying — we log the error
        return reply.code(200).send({ received: true, error: (err as Error).message });
      }

      return reply.code(200).send({ received: true });
    });
  });

  // Meta webhook verification + event handling
  app.get('/api/webhooks/meta', async (request, reply) => {
    // Meta webhook verification challenge
    const query = request.query as { 'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string };
    const config = getConfig();
    if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === config.META_WEBHOOK_VERIFY_TOKEN) {
      return reply.send(query['hub.challenge']);
    }
    return reply.code(403).send({ error: 'Verification failed' });
  });

  app.post('/api/webhooks/meta', async (request, reply) => {
    const body = request.body as { entry?: Array<{ changes?: Array<{ field: string; value: unknown }> }> };
    console.log('[Webhook] Meta event received');

    // Process asynchronously — acknowledge immediately
    setImmediate(() => {
      for (const entry of body.entry ?? []) {
        for (const change of entry.changes ?? []) {
          orchestrator.eventBus.emit('webhook:meta' as any, { field: change.field, value: change.value });
        }
      }
    });

    return reply.code(200).send({ received: true });
  });

  // TikTok webhook
  app.post('/api/webhooks/tiktok', async (request, reply) => {
    const body = request.body as { event?: string; data?: unknown };
    console.log(`[Webhook] TikTok event: ${body.event}`);

    setImmediate(() => {
      orchestrator.eventBus.emit('webhook:tiktok' as any, { event: body.event, data: body.data });
    });

    return reply.code(200).send({ received: true });
  });

  // Printful webhook
  app.post('/api/webhooks/printful', async (request, reply) => {
    const body = request.body as { type?: string; data?: { order?: { id: number; status: string } } };
    console.log(`[Webhook] Printful event: ${body.type}`);

    setImmediate(() => {
      if (body.type === 'order_updated' || body.type === 'order_created' || body.type === 'package_shipped') {
        orchestrator.eventBus.emit('webhook:printful' as any, { type: body.type, data: body.data });
      }
    });

    return reply.code(200).send({ received: true });
  });
}

// ─── Event Handlers ─────────────────────────────────────────────────────────

/**
 * Handle completed checkout — triggers order fulfillment.
 */
async function handleCheckoutCompleted(
  orchestrator: Orchestrator,
  session: CheckoutSession,
): Promise<void> {
  console.log(`[Webhook] Checkout completed: ${session.id}, amount: ${session.amount_total}¢`);

  // Extract floor ID from metadata (set during payment link creation)
  const floorId = session.metadata?.floor_id;
  if (!floorId) {
    console.warn(`[Webhook] Checkout ${session.id} has no floor_id metadata — cannot route to floor`);
    return;
  }

  // Record revenue (negative cost = revenue)
  orchestrator.eventBus.emit('cost:recorded', {
    floorId,
    taskId: `stripe-checkout-${session.id}`,
    costCents: -(session.amount_total ?? 0),
  });

  // Trigger fulfillment pipeline via event bus (FulfillmentPipeline listens for order:created)
  orchestrator.eventBus.emit('order:created', {
    floorId,
    orderId: session.id,
    customerEmail: session.customer_details?.email ?? session.customer_email ?? '',
    customerName: session.customer_details?.name ?? '',
    amountCents: session.amount_total ?? 0,
    lineItems: session.line_items?.data ?? [],
    shippingAddress: session.shipping_details?.address ?? null,
    paymentIntentId: (session.payment_intent as string) ?? '',
  });

  console.log(`[Webhook] Order created for floor ${floorId}: ${session.id} ($${((session.amount_total ?? 0) / 100).toFixed(2)})`);
}

/**
 * Handle successful payment — revenue tracking.
 */
async function handlePaymentSucceeded(
  orchestrator: Orchestrator,
  paymentIntent: PaymentIntent,
): Promise<void> {
  const floorId = paymentIntent.metadata?.floor_id;
  if (!floorId) return;

  console.log(`[Webhook] Payment succeeded for floor ${floorId}: ${paymentIntent.id} ($${(paymentIntent.amount / 100).toFixed(2)})`);

  // Broadcast for dashboard real-time updates
  try {
    const { broadcastFloorEvent } = await import('../../integrations/supabase.js');
    await broadcastFloorEvent(floorId, 'revenue:payment', {
      paymentId: paymentIntent.id,
      amountCents: paymentIntent.amount,
      timestamp: new Date().toISOString(),
    });
  } catch {
    // Non-critical — dashboard update failure shouldn't block anything
  }
}

/**
 * Handle refund — adjusts revenue tracking.
 */
async function handleRefund(
  orchestrator: Orchestrator,
  charge: Charge,
): Promise<void> {
  const floorId = charge.metadata?.floor_id;
  if (!floorId) return;

  const refundedAmount = charge.amount_refunded ?? 0;
  console.log(`[Webhook] Refund processed for floor ${floorId}: ${charge.id} ($${(refundedAmount / 100).toFixed(2)})`);

  // Record refund as positive cost (reduces net revenue)
  orchestrator.eventBus.emit('cost:recorded', {
    floorId,
    taskId: `stripe-refund-${charge.id}`,
    costCents: refundedAmount,
  });
}

// ─── Stripe Signature Verification ──────────────────────────────────────────

/**
 * Verify Stripe webhook signature using HMAC-SHA256.
 * Implements Stripe's v1 signature scheme.
 */
function verifyStripeSignature(payload: Buffer, header: string, secret: string): boolean {
  try {
    // Parse header: t=timestamp,v1=signature
    const elements = header.split(',');
    const timestamp = elements.find(e => e.startsWith('t='))?.slice(2);
    const signature = elements.find(e => e.startsWith('v1='))?.slice(3);

    if (!timestamp || !signature) return false;

    // Check timestamp (reject events older than 5 minutes)
    const age = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (age > 300) return false;

    // Compute expected signature
    const signedPayload = `${timestamp}.${payload.toString()}`;
    const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');

    // Constant-time comparison
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ─── Stripe Types (minimal, for webhook payloads) ───────────────────────────

interface StripeEvent {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
}

interface CheckoutSession {
  id: string;
  amount_total: number | null;
  customer_email: string | null;
  customer_details: { email?: string; name?: string } | null;
  payment_intent: string | null;
  metadata: Record<string, string> | null;
  line_items?: { data: Array<{ description?: string; quantity?: number; amount_total?: number }> };
  shipping_details?: { address?: StripeAddress } | null;
}

interface PaymentIntent {
  id: string;
  amount: number;
  metadata: Record<string, string> | null;
}

interface Charge {
  id: string;
  amount: number;
  amount_refunded: number;
  metadata: Record<string, string> | null;
}

interface StripeAddress {
  city?: string;
  country?: string;
  line1?: string;
  line2?: string;
  postal_code?: string;
  state?: string;
}
