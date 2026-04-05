/**
 * CartTracker — Abandoned cart detection and recovery.
 *
 * Tracks shopping cart state and triggers abandoned-cart sequence
 * when carts remain unconverted for > 1 hour.
 *
 * Flow:
 *   User adds items → trackCartEvent() → cart stored in memory
 *   checkAbandonedCarts() runs every 15 min → finds carts > 1h old
 *   → enrolls in abandoned-cart sequence
 *   On checkout → markCartConverted() → cancels sequence
 */

import type { EventBus } from './event-bus.js';
import { enrollSubscriber, exitSequence } from './email-automation.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CartItem {
  productId: string;
  name: string;
  quantity: number;
  priceCents: number;
}

export interface CartState {
  floorId: string;
  sessionId: string;
  email: string;
  items: CartItem[];
  createdAt: string;
  convertedAt?: string;
}

// ─── CartTracker ────────────────────────────────────────────────────────────

/** In-memory store of active shopping carts. Key: sessionId */
const cartStore = new Map<string, CartState>();

/** Map session ID to enrollment ID for cleanup. Key: sessionId, Value: enrollmentId */
const cartEnrollments = new Map<string, string>();

let eventBus: EventBus | null = null;

/**
 * Initialize cart tracker with event bus.
 */
export function initializeCartTracker(bus: EventBus): void {
  eventBus = bus;

  // Listen for order creation to mark carts converted
  eventBus.on('order:created', (data) => {
    const sessionId = data.paymentIntentId; // Use payment intent as session identifier
    if (sessionId) {
      markCartConverted(sessionId);
    }
  });
}

/**
 * Track a cart event. Called when user adds/modifies items.
 */
export function trackCartEvent(
  floorId: string,
  sessionId: string,
  email: string,
  items: CartItem[],
): void {
  const cartState: CartState = {
    floorId,
    sessionId,
    email,
    items,
    createdAt: new Date().toISOString(),
  };

  cartStore.set(sessionId, cartState);

  if (eventBus) {
    eventBus.emit('cart:tracked', {
      floorId,
      email,
      firstName: email.split('@')[0] || 'customer',
      trigger: 'manual',
      metadata: {
        sessionId,
        itemCount: String(items.length),
        totalCents: String(items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0)),
      },
    });
  }

  console.log(`[CartTracker] Tracked cart for ${email}: ${items.length} items`);
}

/**
 * Check for abandoned carts (> 1 hour old without conversion).
 * Enrolls them in abandoned-cart sequence.
 * Called every 15 minutes.
 * Returns count of carts abandoned.
 */
export async function checkAbandonedCarts(): Promise<number> {
  const now = Date.now();
  const ABANDONED_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

  const abandonedCarts = [...cartStore.values()].filter(
    cart => !cart.convertedAt && (now - new Date(cart.createdAt).getTime()) > ABANDONED_THRESHOLD_MS,
  );

  let count = 0;

  for (const cart of abandonedCarts) {
    // Enroll in abandoned-cart sequence
    const enrollment = await enrollSubscriber(
      cart.floorId,
      cart.email,
      'abandoned-cart',
      {
        cartItems: cart.items.map(i => `${i.name} (${i.quantity})`).join(', '),
        productName: cart.items[0]?.name || 'Your Items',
        discountCode: 'COMEBACK10',
      },
    );

    if (enrollment) {
      cartEnrollments.set(cart.sessionId, enrollment.id);
      count++;

      if (eventBus) {
        eventBus.emit('cart:abandoned', {
          floorId: cart.floorId,
          email: cart.email,
          firstName: cart.email.split('@')[0] || 'customer',
          trigger: 'cart-abandon',
          metadata: {
            sessionId: cart.sessionId,
            itemCount: String(cart.items.length),
            totalCents: String(cart.items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0)),
          },
        });
      }

      console.log(`[CartTracker] Detected abandoned cart: ${cart.email} (${cart.items.length} items)`);
    }
  }

  return count;
}

/**
 * Mark a cart as converted. Called on successful checkout.
 */
export function markCartConverted(sessionId: string): void {
  const cart = cartStore.get(sessionId);
  if (cart) {
    cart.convertedAt = new Date().toISOString();

    // Exit from abandoned-cart sequence if enrolled
    const enrollmentId = cartEnrollments.get(sessionId);
    if (enrollmentId) {
      exitSequence(cart.email, 'abandoned-cart', 'purchase-completed');
      cartEnrollments.delete(sessionId);
    }

    if (eventBus) {
      eventBus.emit('cart:converted', {
        floorId: cart.floorId,
        email: cart.email,
        firstName: cart.email.split('@')[0] || 'customer',
        trigger: 'purchase',
        metadata: {
          sessionId,
          itemCount: String(cart.items.length),
          totalCents: String(cart.items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0)),
        },
      });
    }

    console.log(`[CartTracker] Cart converted: ${cart.email}`);
  }
}

/**
 * Get count of unconverted carts for a floor.
 */
export function getActiveCartsCount(floorId: string): number {
  return [...cartStore.values()].filter(
    cart => cart.floorId === floorId && !cart.convertedAt,
  ).length;
}

/**
 * Cleanup old carts (converted > 7 days ago or created > 30 days ago).
 * Called periodically.
 */
export function cleanupOldCarts(): number {
  const now = Date.now();
  const CONVERTED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  const CREATED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  const keysToDelete: string[] = [];

  for (const [sessionId, cart] of cartStore.entries()) {
    if (cart.convertedAt) {
      const age = now - new Date(cart.convertedAt).getTime();
      if (age > CONVERTED_RETENTION_MS) {
        keysToDelete.push(sessionId);
      }
    } else {
      const age = now - new Date(cart.createdAt).getTime();
      if (age > CREATED_RETENTION_MS) {
        keysToDelete.push(sessionId);
      }
    }
  }

  for (const key of keysToDelete) {
    cartStore.delete(key);
    cartEnrollments.delete(key);
  }

  console.log(`[CartTracker] Cleaned up ${keysToDelete.length} old carts`);
  return keysToDelete.length;
}
