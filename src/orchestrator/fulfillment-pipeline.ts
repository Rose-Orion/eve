/**
 * FulfillmentPipeline — Automated order processing.
 *
 * Listens for order:created events (from Stripe webhooks) and orchestrates:
 *   1. Create Printful order (POD fulfillment)
 *   2. Send order confirmation email (Resend)
 *   3. Track fulfillment status
 *   4. Send shipping notification when fulfilled
 *
 * Each order progresses through states:
 *   RECEIVED → FULFILLMENT_CREATED → SHIPPED → DELIVERED
 *
 * Non-POD products (digital, service) skip Printful and go straight to confirmation.
 */

import type { EventBus } from './event-bus.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type OrderStatus = 'received' | 'fulfillment_created' | 'shipped' | 'delivered' | 'failed' | 'refunded';

export interface Order {
  id: string;
  floorId: string;
  customerEmail: string;
  customerName: string;
  amountCents: number;
  lineItems: Array<{ description?: string; quantity?: number; amount_total?: number }>;
  shippingAddress: ShippingAddress | null;
  paymentIntentId: string;
  status: OrderStatus;
  printfulOrderId?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ShippingAddress {
  city?: string;
  country?: string;
  line1?: string;
  line2?: string;
  postal_code?: string;
  state?: string;
}

export interface FloorFulfillmentConfig {
  /** Business name for email branding */
  businessName: string;
  /** From email address */
  fromEmail: string;
  /** Reply-to email */
  replyToEmail?: string;
  /** Whether this floor uses POD (Printful) */
  usesPrintful: boolean;
  /** Printful product ID mapping: Stripe price ID → Printful variant ID */
  printfulVariantMap?: Record<string, number>;
}

// ─── FulfillmentPipeline ────────────────────────────────────────────────────

export class FulfillmentPipeline {
  /** In-memory order store (will be persisted to Supabase in production) */
  private orders = new Map<string, Order>();
  /** Per-floor fulfillment config */
  private floorConfigs = new Map<string, FloorFulfillmentConfig>();

  constructor(private eventBus: EventBus) {
    this.setupEventHandlers();
  }

  // ── Configuration ──

  setFloorConfig(floorId: string, config: FloorFulfillmentConfig): void {
    this.floorConfigs.set(floorId, config);
  }

  getFloorConfig(floorId: string): FloorFulfillmentConfig | undefined {
    return this.floorConfigs.get(floorId);
  }

  // ── Event Handlers ──

  private setupEventHandlers(): void {
    // Listen for new orders (from event bus — alternative to direct processNewOrder calls)
    this.eventBus.on('order:created', async (data) => {
      await this.processNewOrder(data);
    });
  }

  // ── Order Processing ──

  /**
   * Process a new order through the fulfillment pipeline.
   */
  async processNewOrder(data: {
    floorId: string;
    orderId: string;
    customerEmail: string;
    customerName: string;
    amountCents: number;
    lineItems: Array<{ description?: string; quantity?: number; amount_total?: number }>;
    shippingAddress: ShippingAddress | null;
    paymentIntentId: string;
  }): Promise<void> {
    const order: Order = {
      id: data.orderId,
      floorId: data.floorId,
      customerEmail: data.customerEmail,
      customerName: data.customerName,
      amountCents: data.amountCents,
      lineItems: data.lineItems,
      shippingAddress: data.shippingAddress,
      paymentIntentId: data.paymentIntentId,
      status: 'received',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.orders.set(order.id, order);
    console.log(`[Fulfillment] Order ${order.id} received for floor ${order.floorId}: $${(order.amountCents / 100).toFixed(2)}`);

    const floorConfig = this.floorConfigs.get(order.floorId);

    // Step 1: Send confirmation email
    await this.sendConfirmationEmail(order, floorConfig);

    // Step 2: Create Printful order (if POD floor)
    if (floorConfig?.usesPrintful && order.shippingAddress) {
      await this.createPrintfulOrder(order, floorConfig);
    } else {
      // Digital/service product — mark as delivered immediately
      order.status = 'delivered';
      order.updatedAt = new Date();
      console.log(`[Fulfillment] Order ${order.id} is digital/service — marked delivered`);
    }
  }

  /**
   * Send order confirmation email via Resend.
   */
  private async sendConfirmationEmail(order: Order, config?: FloorFulfillmentConfig): Promise<void> {
    try {
      const { sendEmail } = await import('../integrations/resend.js');

      const businessName = config?.businessName ?? 'Our Store';
      const fromEmail = config?.fromEmail ?? 'orders@example.com';
      const itemsHtml = order.lineItems.map(item =>
        `<tr><td style="padding: 8px; border-bottom: 1px solid #eee;">${item.description ?? 'Item'}</td><td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">×${item.quantity ?? 1}</td><td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">$${((item.amount_total ?? 0) / 100).toFixed(2)}</td></tr>`,
      ).join('');

      const html = `
<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
  <h1 style="color: #333;">Order Confirmed!</h1>
  <p>Hi ${order.customerName || 'there'},</p>
  <p>Thank you for your order! Here's a summary:</p>

  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    <thead>
      <tr style="background: #f7f7f7;">
        <th style="padding: 8px; text-align: left;">Item</th>
        <th style="padding: 8px; text-align: right;">Qty</th>
        <th style="padding: 8px; text-align: right;">Price</th>
      </tr>
    </thead>
    <tbody>${itemsHtml}</tbody>
    <tfoot>
      <tr>
        <td colspan="2" style="padding: 8px; font-weight: bold;">Total</td>
        <td style="padding: 8px; text-align: right; font-weight: bold;">$${(order.amountCents / 100).toFixed(2)}</td>
      </tr>
    </tfoot>
  </table>

  <p>Order ID: <code>${order.id}</code></p>
  ${order.shippingAddress ? `<p>We'll send you a tracking number once your order ships.</p>` : '<p>Your order is being processed and will be available shortly.</p>'}

  <p style="color: #666; margin-top: 30px;">Thanks for choosing ${businessName}!</p>
</div>`;

      await sendEmail({
        from: fromEmail,
        to: order.customerEmail,
        subject: `Order Confirmed — ${businessName} #${order.id.slice(-8)}`,
        html,
        replyTo: config?.replyToEmail,
      });

      console.log(`[Fulfillment] Confirmation email sent to ${order.customerEmail} for order ${order.id}`);
    } catch (err) {
      console.error(`[Fulfillment] Failed to send confirmation email for ${order.id}: ${(err as Error).message}`);
    }
  }

  /**
   * Create a Printful order for POD fulfillment.
   */
  private async createPrintfulOrder(order: Order, config: FloorFulfillmentConfig): Promise<void> {
    try {
      const { getConfig } = await import('../config/index.js');
      const appConfig = getConfig();

      if (!appConfig.PRINTFUL_API_KEY) {
        console.warn(`[Fulfillment] Printful API key not configured — cannot fulfill order ${order.id}`);
        return;
      }

      const address = order.shippingAddress;
      if (!address) {
        console.warn(`[Fulfillment] No shipping address for order ${order.id}`);
        return;
      }

      // Build Printful order items
      const items = order.lineItems
        .map(item => {
          // Look up Printful variant from config mapping
          // In production, this maps Stripe product/price IDs to Printful variant IDs
          return {
            variant_id: config.printfulVariantMap?.[item.description ?? ''] ?? 0,
            quantity: item.quantity ?? 1,
            name: item.description ?? 'Product',
          };
        })
        .filter(item => item.variant_id > 0);

      if (items.length === 0) {
        console.log(`[Fulfillment] No Printful-mappable items in order ${order.id} — skipping POD fulfillment`);
        order.status = 'delivered';
        order.updatedAt = new Date();
        return;
      }

      const printfulOrder = {
        external_id: order.id,
        recipient: {
          name: order.customerName,
          email: order.customerEmail,
          address1: address.line1 ?? '',
          address2: address.line2 ?? '',
          city: address.city ?? '',
          state_code: address.state ?? '',
          country_code: address.country ?? 'US',
          zip: address.postal_code ?? '',
        },
        items,
      };

      const res = await fetch('https://api.printful.com/orders', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${appConfig.PRINTFUL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(printfulOrder),
      });

      if (!res.ok) {
        const err = await res.text().catch(() => 'unknown');
        throw new Error(`Printful order creation failed (${res.status}): ${err}`);
      }

      const data = await res.json() as { result?: { id: number } };
      order.printfulOrderId = String(data.result?.id ?? '');
      order.status = 'fulfillment_created';
      order.updatedAt = new Date();

      console.log(`[Fulfillment] Printful order ${order.printfulOrderId} created for order ${order.id}`);
    } catch (err) {
      console.error(`[Fulfillment] Printful order creation failed for ${order.id}: ${(err as Error).message}`);
      order.status = 'failed';
      order.updatedAt = new Date();
    }
  }

  /**
   * Send shipping notification email.
   * Called when Printful webhook reports shipment.
   */
  async sendShippingNotification(orderId: string, trackingNumber: string, trackingUrl: string): Promise<void> {
    const order = this.orders.get(orderId);
    if (!order) {
      console.warn(`[Fulfillment] Order ${orderId} not found for shipping notification`);
      return;
    }

    order.trackingNumber = trackingNumber;
    order.trackingUrl = trackingUrl;
    order.status = 'shipped';
    order.updatedAt = new Date();

    const config = this.floorConfigs.get(order.floorId);
    const businessName = config?.businessName ?? 'Our Store';

    try {
      const { sendEmail } = await import('../integrations/resend.js');

      await sendEmail({
        from: config?.fromEmail ?? 'orders@example.com',
        to: order.customerEmail,
        subject: `Your Order Has Shipped! — ${businessName}`,
        html: `
<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
  <h1 style="color: #333;">Your Order Has Shipped!</h1>
  <p>Hi ${order.customerName || 'there'},</p>
  <p>Great news — your order is on its way!</p>
  <p><strong>Tracking Number:</strong> ${trackingNumber}</p>
  ${trackingUrl ? `<p><a href="${trackingUrl}" style="color: #0066cc;">Track Your Package</a></p>` : ''}
  <p style="color: #666; margin-top: 30px;">Thanks for shopping with ${businessName}!</p>
</div>`,
        replyTo: config?.replyToEmail,
      });

      console.log(`[Fulfillment] Shipping notification sent for order ${orderId}`);
    } catch (err) {
      console.error(`[Fulfillment] Failed to send shipping notification for ${orderId}: ${(err as Error).message}`);
    }
  }

  // ── Order Queries ──

  getOrder(orderId: string): Order | undefined {
    return this.orders.get(orderId);
  }

  getFloorOrders(floorId: string): Order[] {
    return [...this.orders.values()].filter(o => o.floorId === floorId);
  }

  getFloorRevenue(floorId: string): { totalCents: number; orderCount: number } {
    const orders = this.getFloorOrders(floorId).filter(o => o.status !== 'refunded');
    return {
      totalCents: orders.reduce((sum, o) => sum + o.amountCents, 0),
      orderCount: orders.length,
    };
  }
}
