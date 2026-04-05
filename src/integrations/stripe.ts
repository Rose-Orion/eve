/**
 * Stripe integration — payment processing for ecommerce floors.
 * Handles products, prices, and payment link creation.
 */

import { getConfig } from '../config/index.js';

const STRIPE_API = 'https://api.stripe.com/v1';

function getHeaders(): Record<string, string> {
  const config = getConfig();
  if (!config.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not configured');
  return {
    'Authorization': `Bearer ${config.STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

export interface StripeProduct {
  id: string;
  name: string;
  priceId: string;
  priceCents: number;
  paymentLink?: string;
}

export async function createProduct(name: string, description: string, priceCents: number): Promise<StripeProduct> {
  // Create product
  const productRes = await fetch(`${STRIPE_API}/products`, {
    method: 'POST',
    headers: getHeaders(),
    body: new URLSearchParams({ name, description }),
  });

  if (!productRes.ok) {
    const errorBody = await productRes.text().catch(() => 'unknown error');
    throw new Error(`Stripe createProduct failed (${productRes.status}): ${errorBody}`);
  }

  const product = await productRes.json() as { id: string };

  // Create price
  const priceRes = await fetch(`${STRIPE_API}/prices`, {
    method: 'POST',
    headers: getHeaders(),
    body: new URLSearchParams({
      product: product.id,
      unit_amount: String(priceCents),
      currency: 'usd',
    }),
  });

  if (!priceRes.ok) {
    const errorBody = await priceRes.text().catch(() => 'unknown error');
    console.error(`[Stripe] createPrice failed for product ${product.id}: ${errorBody}`);
    throw new Error(`Stripe createPrice failed (${priceRes.status}): ${errorBody}`);
  }

  const price = await priceRes.json() as { id: string };

  return { id: product.id, name, priceId: price.id, priceCents };
}

export async function createPaymentLink(priceId: string): Promise<string> {
  const res = await fetch(`${STRIPE_API}/payment_links`, {
    method: 'POST',
    headers: getHeaders(),
    body: new URLSearchParams({ 'line_items[0][price]': priceId, 'line_items[0][quantity]': '1' }),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => 'unknown error');
    throw new Error(`Stripe createPaymentLink failed (${res.status}): ${errorBody}`);
  }

  const link = await res.json() as { url: string };
  return link.url;
}

export async function checkConnection(): Promise<boolean> {
  const config = getConfig();
  if (!config.STRIPE_SECRET_KEY) return false;
  try {
    const res = await fetch(`${STRIPE_API}/balance`, { headers: getHeaders() });
    return res.ok;
  } catch { return false; }
}
