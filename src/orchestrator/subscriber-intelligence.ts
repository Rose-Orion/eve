/**
 * SubscriberIntelligence — Subscriber segmentation and CLV tracking.
 *
 * Segments subscribers by lifecycle stage and calculates Customer Lifetime Value.
 *
 * Lifecycle Segments:
 *   - new-subscriber: Just signed up
 *   - engaged: Opened email in last 30 days
 *   - first-time-buyer: Made 1 purchase
 *   - repeat-buyer: Made 2+ purchases
 *   - vip: 3+ purchases OR $150+ LTV
 *   - at-risk: No email open in 60 days
 *   - lapsed: No purchase in 90 days (but was buyer)
 *
 * CLV Formula: AOV × Purchase Frequency × Average Lifespan (2 years assumed)
 */

import type { EventBus } from './event-bus.js';
import { enrollSubscriber, exitSequence } from './email-automation.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type LifecycleSegment = 'new-subscriber' | 'engaged' | 'first-time-buyer' | 'repeat-buyer' | 'vip' | 'at-risk' | 'lapsed';

export interface SubscriberProfile {
  email: string;
  floorId: string;
  segment: LifecycleSegment;
  tags: string[];
  purchaseCount: number;
  totalSpendCents: number;
  clv: number;
  lastPurchaseAt?: string;
  lastOpenAt?: string;
  acquisitionSource?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── SubscriberIntelligence ─────────────────────────────────────────────────

/** In-memory store of subscriber profiles. Key: floorId:email */
const profileStore = new Map<string, SubscriberProfile>();

/** Track VIP promotions to avoid re-enrolling. Key: floorId:email */
const vipPromoted = new Set<string>();

let eventBus: EventBus | null = null;

/**
 * Initialize subscriber intelligence with event bus.
 */
export function initializeSubscriberIntelligence(bus: EventBus): void {
  eventBus = bus;

  // Listen for order creation to update purchase count
  eventBus.on('order:created', async (data) => {
    const key = `${data.floorId}:${data.customerEmail}`;
    const profile = profileStore.get(key);

    if (profile) {
      profile.purchaseCount++;
      profile.totalSpendCents += data.amountCents;
      profile.lastPurchaseAt = new Date().toISOString();
      profile.updatedAt = new Date().toISOString();

      // Re-segment
      const newSegment = await updateSegment(data.floorId, data.customerEmail);
      console.log(`[SubscriberIntel] Updated ${data.customerEmail}: segment=${newSegment}, CLV=$${calculateCLV(profile) / 100}`);
    }
  });
}

/**
 * Update subscriber segment based on rules. Returns new segment.
 */
export async function updateSegment(floorId: string, email: string): Promise<LifecycleSegment> {
  let profile = profileStore.get(`${floorId}:${email}`);

  // Create default profile if not exists
  if (!profile) {
    profile = {
      email,
      floorId,
      segment: 'new-subscriber',
      tags: [],
      purchaseCount: 0,
      totalSpendCents: 0,
      clv: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    profileStore.set(`${floorId}:${email}`, profile);
  }

  const now = Date.now();
  let newSegment: LifecycleSegment = 'new-subscriber';

  // Apply segmentation rules (in order of priority)
  if (profile.purchaseCount >= 3 || profile.totalSpendCents >= 15000) {
    // 3+ purchases OR $150+ total
    newSegment = 'vip';
  } else if (
    profile.lastOpenAt &&
    now - new Date(profile.lastOpenAt).getTime() > 60 * 24 * 60 * 60 * 1000
  ) {
    // No open in 60 days
    newSegment = 'at-risk';
  } else if (
    profile.purchaseCount > 0 &&
    profile.lastPurchaseAt &&
    now - new Date(profile.lastPurchaseAt).getTime() > 90 * 24 * 60 * 60 * 1000
  ) {
    // Was buyer, but no purchase in 90 days
    newSegment = 'lapsed';
  } else if (profile.purchaseCount >= 2) {
    newSegment = 'repeat-buyer';
  } else if (profile.purchaseCount === 1) {
    newSegment = 'first-time-buyer';
  } else if (profile.lastOpenAt && now - new Date(profile.lastOpenAt).getTime() <= 30 * 24 * 60 * 60 * 1000) {
    // Opened email in last 30 days
    newSegment = 'engaged';
  }

  const oldSegment = profile.segment;
  profile.segment = newSegment;
  profile.clv = calculateCLV(profile);
  profile.updatedAt = new Date().toISOString();

  // Emit segment change event if segment changed
  if (oldSegment !== newSegment) {
    if (eventBus) {
      eventBus.emit('subscriber:segmented', {
        floorId,
        email,
        firstName: email.split('@')[0] || 'subscriber',
        trigger: 'manual',
        metadata: { oldSegment: oldSegment || '', newSegment: newSegment || '' },
      });
    }

    // Auto-enroll VIP into VIP sequence
    if (newSegment === 'vip' && !vipPromoted.has(`${floorId}:${email}`)) {
      await enrollSubscriber(floorId, email, 'vip', {
        businessName: 'Your Business',
        firstName: email.split('@')[0] || 'subscriber',
      });
      vipPromoted.add(`${floorId}:${email}`);

      if (eventBus) {
        eventBus.emit('subscriber:vip-promoted', {
          floorId,
          email,
          firstName: email.split('@')[0] || 'subscriber',
          trigger: 'manual',
          metadata: { purchaseCount: String(profile.purchaseCount), totalSpendCents: String(profile.totalSpendCents) },
        });
      }

      console.log(`[SubscriberIntel] Promoted to VIP: ${email}`);
    }

    // Emit at-risk alert
    if (newSegment === 'at-risk' && oldSegment !== 'at-risk') {
      if (eventBus) {
        eventBus.emit('subscriber:at-risk', {
          floorId,
          email,
          firstName: email.split('@')[0] || 'subscriber',
          trigger: 'inactivity',
          metadata: { lastOpenAt: profile.lastOpenAt ?? 'never' },
        });
      }

      // Auto-enroll into win-back sequence
      await enrollSubscriber(floorId, email, 'win-back', {
        businessName: 'Your Business',
        firstName: email.split('@')[0] || 'subscriber',
        discountCode: 'WINBACK15',
      });

      console.log(`[SubscriberIntel] At-risk segment: ${email} enrolled in win-back`);
    }
  }

  return newSegment;
}

/**
 * Calculate CLV (Customer Lifetime Value).
 * Formula: AOV × Purchase Frequency × Average Lifespan (2 years)
 */
export function calculateCLV(profile: SubscriberProfile): number {
  if (profile.purchaseCount === 0) return 0;

  // AOV (Average Order Value)
  const aov = profile.totalSpendCents / profile.purchaseCount;

  // Purchase Frequency (purchases per month, assuming data spans reasonable time)
  // For simplicity: assume avg 1 purchase every 2 months if repeat buyer
  const purchaseFrequencyMonthly = profile.purchaseCount > 1 ? 0.5 : 0;

  // Lifespan in months (assume 24 months / 2 years)
  const lifespanMonths = 24;

  // CLV = AOV × (Frequency × Lifespan)
  const clv = aov * (purchaseFrequencyMonthly * lifespanMonths + 1); // +1 for base purchase

  return Math.round(clv);
}

/**
 * Bulk update all subscribers for a floor. Expensive; run in background.
 */
export async function runSegmentationUpdate(floorId: string): Promise<void> {
  const subscribers = [...profileStore.values()].filter(p => p.floorId === floorId);

  let updated = 0;
  for (const subscriber of subscribers) {
    const oldSeg = subscriber.segment;
    await updateSegment(floorId, subscriber.email);
    if (profileStore.get(`${floorId}:${subscriber.email}`)?.segment !== oldSeg) {
      updated++;
    }
  }

  console.log(`[SubscriberIntel] Segmentation update for floor ${floorId}: ${updated}/${subscribers.length} changed`);
}

/**
 * Get segment distribution for a floor.
 */
export async function getSegmentCounts(floorId: string): Promise<Record<LifecycleSegment, number>> {
  const segments: Record<LifecycleSegment, number> = {
    'new-subscriber': 0,
    engaged: 0,
    'first-time-buyer': 0,
    'repeat-buyer': 0,
    vip: 0,
    'at-risk': 0,
    lapsed: 0,
  };

  const subscribers = [...profileStore.values()].filter(p => p.floorId === floorId);
  for (const sub of subscribers) {
    segments[sub.segment]++;
  }

  return segments;
}

/**
 * Add tags to a subscriber.
 */
export async function tagSubscriber(floorId: string, email: string, tags: string[]): Promise<void> {
  const key = `${floorId}:${email}`;
  let profile = profileStore.get(key);

  if (!profile) {
    profile = {
      email,
      floorId,
      segment: 'new-subscriber',
      tags: [],
      purchaseCount: 0,
      totalSpendCents: 0,
      clv: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    profileStore.set(key, profile);
  }

  // Add tags that don't already exist
  for (const tag of tags) {
    if (!profile.tags.includes(tag)) {
      profile.tags.push(tag);
    }
  }

  profile.updatedAt = new Date().toISOString();
  console.log(`[SubscriberIntel] Tagged ${email}: ${tags.join(', ')}`);
}

/**
 * Get a subscriber profile.
 */
export function getProfile(floorId: string, email: string): SubscriberProfile | undefined {
  return profileStore.get(`${floorId}:${email}`);
}

/**
 * Get all profiles for a floor.
 */
export function getFloorProfiles(floorId: string): SubscriberProfile[] {
  return [...profileStore.values()].filter(p => p.floorId === floorId);
}

/**
 * Record an email open. Updates lastOpenAt.
 */
export async function recordEmailOpen(floorId: string, email: string): Promise<void> {
  const key = `${floorId}:${email}`;
  let profile = profileStore.get(key);

  if (!profile) {
    profile = {
      email,
      floorId,
      segment: 'new-subscriber',
      tags: [],
      purchaseCount: 0,
      totalSpendCents: 0,
      clv: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    profileStore.set(key, profile);
  }

  profile.lastOpenAt = new Date().toISOString();
  profile.updatedAt = new Date().toISOString();

  // Re-segment to possibly move out of at-risk
  await updateSegment(floorId, email);
}

/**
 * Get top VIPs by CLV.
 */
export function getTopVIPs(floorId: string, limit = 10): SubscriberProfile[] {
  return [...profileStore.values()]
    .filter(p => p.floorId === floorId && p.segment === 'vip')
    .sort((a, b) => b.clv - a.clv)
    .slice(0, limit);
}

/**
 * Get at-risk subscribers for a floor.
 */
export function getAtRiskSubscribers(floorId: string): SubscriberProfile[] {
  return [...profileStore.values()].filter(p => p.floorId === floorId && p.segment === 'at-risk');
}
