/**
 * Printful integration — Print-on-demand fulfillment.
 * Handles product sync, mockup generation, and order tracking.
 */

import { getConfig } from '../config/index.js';

const PRINTFUL_API = 'https://api.printful.com';

export interface PrintfulProduct {
  id: number;
  name: string;
  variants: Array<{ id: number; name: string; retailPrice: number }>;
}

export interface PrintfulMockup {
  taskKey: string;
  status: string;
  mockupUrl?: string;
}

export interface PrintfulRecipient {
  name: string;
  address1: string;
  city: string;
  stateCode: string;
  countryCode: string;
  zip: string;
}

export interface PrintfulOrderItem {
  syncVariantId: number;
  quantity: number;
}

export interface PrintfulOrder {
  id: number;
  status: string;
  trackingUrl?: string;
  estimatedDelivery?: string;
}

export interface PrintfulShippingRate {
  id: string;
  name: string;
  rate: number;
  currency: string;
  minDeliveryDays?: number;
  maxDeliveryDays?: number;
}

async function printfulFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const config = getConfig();
  return fetch(`${PRINTFUL_API}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${config.PRINTFUL_API_KEY ?? ''}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

export async function listProducts(): Promise<PrintfulProduct[]> {
  const res = await printfulFetch('/store/products');
  if (!res.ok) return [];
  const data = await res.json() as { result?: Array<{ id: number; name: string }> };
  return (data.result ?? []).map(p => ({ id: p.id, name: p.name, variants: [] }));
}

export async function createMockup(
  productId: number,
  imageUrl: string,
): Promise<PrintfulMockup> {
  const res = await printfulFetch(`/mockup-generator/create-task/${productId}`, {
    method: 'POST',
    body: JSON.stringify({
      variant_ids: [],
      files: [{ placement: 'front', image_url: imageUrl }],
    }),
  });
  const data = await res.json() as { result?: { task_key: string; status: string } };
  return {
    taskKey: data.result?.task_key ?? '',
    status: data.result?.status ?? 'unknown',
  };
}

export async function getMockupResult(taskKey: string): Promise<PrintfulMockup> {
  const res = await printfulFetch(`/mockup-generator/task?task_key=${taskKey}`);
  const data = await res.json() as { result?: { status: string; mockups?: Array<{ mockup_url: string }> } };
  return {
    taskKey,
    status: data.result?.status ?? 'unknown',
    mockupUrl: data.result?.mockups?.[0]?.mockup_url,
  };
}

export async function checkConnection(): Promise<boolean> {
  try {
    const res = await printfulFetch('/store');
    return res.ok;
  } catch { return false; }
}

export async function createSyncProduct(
  storeId: number,
  product: {
    name: string;
    thumbnail: string;
    variants: Array<{
      variantId: number;
      retailPrice: number;
      files: Array<{ url: string; placement: string }>;
    }>;
  },
): Promise<{ id: number; syncVariantIds: Record<number, number> } | null> {
  const body = {
    external_id: `prod_${Date.now()}`,
    name: product.name,
    thumbnail: product.thumbnail,
    variants: product.variants.map(v => ({
      external_id: `var_${v.variantId}_${Date.now()}`,
      variant_id: v.variantId,
      retail_price: v.retailPrice,
      files: v.files,
    })),
  };

  const res = await printfulFetch('/store/products', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res.ok) return null;

  const data = await res.json() as {
    result?: {
      id: number;
      sync_variants: Array<{ id: number; external_id: string }>;
    };
  };

  if (!data.result) return null;

  const syncVariantMap: Record<number, number> = {};
  data.result.sync_variants.forEach(sv => {
    const match = sv.external_id.match(/var_(\d+)_/);
    if (match && match[1]) {
      syncVariantMap[parseInt(match[1], 10)] = sv.id;
    }
  });

  return {
    id: data.result.id,
    syncVariantIds: syncVariantMap,
  };
}

export async function createOrder(
  recipient: PrintfulRecipient,
  items: PrintfulOrderItem[],
): Promise<PrintfulOrder | null> {
  const body = {
    recipient: {
      name: recipient.name,
      address1: recipient.address1,
      city: recipient.city,
      state_code: recipient.stateCode,
      country_code: recipient.countryCode,
      zip: recipient.zip,
    },
    items: items.map(item => ({
      sync_variant_id: item.syncVariantId,
      quantity: item.quantity,
    })),
  };

  const res = await printfulFetch('/orders', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res.ok) return null;

  const data = await res.json() as {
    result?: {
      id: number;
      status: string;
      tracking_url?: string;
      estimated_delivery?: string;
    };
  };

  if (!data.result) return null;

  return {
    id: data.result.id,
    status: data.result.status,
    trackingUrl: data.result.tracking_url,
    estimatedDelivery: data.result.estimated_delivery,
  };
}

export async function getShippingRates(
  recipient: {
    address1: string;
    city: string;
    stateCode: string;
    countryCode: string;
    zip: string;
  },
  items: Array<{ variantId: string; quantity: number }>,
): Promise<PrintfulShippingRate[]> {
  const body = {
    recipient: {
      address1: recipient.address1,
      city: recipient.city,
      state_code: recipient.stateCode,
      country_code: recipient.countryCode,
      zip: recipient.zip,
    },
    items: items.map(item => ({
      variant_id: item.variantId,
      quantity: item.quantity,
    })),
  };

  const res = await printfulFetch('/shipping/rates', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res.ok) return [];

  const data = await res.json() as {
    result?: Array<{
      id: string;
      name: string;
      rate: number;
      currency: string;
      min_delivery_days?: number;
      max_delivery_days?: number;
    }>;
  };

  return (data.result ?? []).map(rate => ({
    id: rate.id,
    name: rate.name,
    rate: rate.rate,
    currency: rate.currency,
    minDeliveryDays: rate.min_delivery_days,
    maxDeliveryDays: rate.max_delivery_days,
  }));
}

export async function getOrderStatus(orderId: number): Promise<PrintfulOrder | null> {
  const res = await printfulFetch(`/orders/${orderId}`);

  if (!res.ok) return null;

  const data = await res.json() as {
    result?: {
      id: number;
      status: string;
      tracking_url?: string;
      estimated_delivery?: string;
    };
  };

  if (!data.result) return null;

  return {
    id: data.result.id,
    status: data.result.status,
    trackingUrl: data.result.tracking_url,
    estimatedDelivery: data.result.estimated_delivery,
  };
}

export async function listVariants(productId: number): Promise<
  Array<{ id: number; name: string; retailPrice: number }>
> {
  const res = await printfulFetch(`/products/${productId}`);

  if (!res.ok) return [];

  const data = await res.json() as {
    result?: {
      variants: Array<{ id: number; name: string; retail_price: number }>;
    };
  };

  return (data.result?.variants ?? []).map(v => ({
    id: v.id,
    name: v.name,
    retailPrice: v.retail_price,
  }));
}

export async function getProductDetails(syncProductId: number): Promise<
  { id: number; name: string; variants: Array<{ id: number; name: string; retailPrice: number }> } | null
> {
  const res = await printfulFetch(`/store/products/${syncProductId}`);

  if (!res.ok) return null;

  const data = await res.json() as {
    result?: {
      id: number;
      name: string;
      sync_variants: Array<{ id: number; name: string; retail_price: number }>;
    };
  };

  if (!data.result) return null;

  return {
    id: data.result.id,
    name: data.result.name,
    variants: (data.result.sync_variants ?? []).map(v => ({
      id: v.id,
      name: v.name,
      retailPrice: v.retail_price,
    })),
  };
}
