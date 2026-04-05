/**
 * Push notification system.
 * Stores notifications in-memory and logs to console.
 * When Web Push is configured, sends to the owner's device via the Dashboard PWA.
 */

export interface Notification {
  id: string;
  title: string;
  body: string;
  floorId?: string;
  type: 'info' | 'approval' | 'alert' | 'error';
  read: boolean;
  createdAt: Date;
}

// Web Push subscription storage (in-memory, could be persisted to Supabase)
interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

let counter = 0;
const notifications: Notification[] = [];
const MAX_STORED = 500;
let pushSubscription: PushSubscription | null = null;
let vapidKeys: { publicKey: string; privateKey: string } | null = null;

export function send(input: Omit<Notification, 'id' | 'read' | 'createdAt'>): Notification {
  const notification: Notification = {
    ...input,
    id: `notif-${++counter}`,
    read: false,
    createdAt: new Date(),
  };

  notifications.push(notification);
  if (notifications.length > MAX_STORED) {
    notifications.splice(0, notifications.length - MAX_STORED);
  }

  const prefix = notification.type === 'error' ? '❌' :
    notification.type === 'alert' ? '⚠️' :
    notification.type === 'approval' ? '👤' : 'ℹ️';

  console.log(`[NOTIFICATION] ${prefix} ${notification.title} — ${notification.body}`);

  // Send Web Push notification if subscription exists
  if (pushSubscription && vapidKeys) {
    sendWebPush(notification).catch(err => {
      console.warn('[Notifications] Web Push failed:', (err as Error).message);
    });
  }

  return notification;
}

export function getAll(floorId?: string): Notification[] {
  if (floorId) return notifications.filter(n => n.floorId === floorId);
  return [...notifications];
}

export function getUnread(floorId?: string): Notification[] {
  return getAll(floorId).filter(n => !n.read);
}

export function markRead(notificationId: string): boolean {
  const notif = notifications.find(n => n.id === notificationId);
  if (!notif) return false;
  notif.read = true;
  return true;
}

export function markAllRead(floorId?: string): number {
  let count = 0;
  for (const n of notifications) {
    if (!n.read && (!floorId || n.floorId === floorId)) {
      n.read = true;
      count++;
    }
  }
  return count;
}

// --- Web Push ---

/**
 * Initialize Web Push with VAPID keys from config.
 */
export function initWebPush(publicKey: string, privateKey: string): void {
  vapidKeys = { publicKey, privateKey };
  console.log('[Notifications] Web Push initialized');
}

/**
 * Register a push subscription from the owner's browser.
 */
export function registerPushSubscription(subscription: PushSubscription): void {
  pushSubscription = subscription;
  console.log('[Notifications] Push subscription registered');
}

/**
 * Get the VAPID public key for the Dashboard to subscribe.
 */
export function getVapidPublicKey(): string | null {
  return vapidKeys?.publicKey ?? null;
}

/**
 * Send a notification via Web Push protocol to the registered subscription.
 */
async function sendWebPush(notification: Notification): Promise<void> {
  if (!pushSubscription || !vapidKeys) return;

  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    type: notification.type,
    floorId: notification.floorId,
    timestamp: notification.createdAt.toISOString(),
  });

  // Use Web Push protocol directly (avoid adding web-push npm dependency)
  // The Dashboard PWA service worker handles the push event
  const res = await fetch(pushSubscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'TTL': '86400',
    },
    body: payload,
  });

  if (!res.ok) {
    // Subscription may be expired — remove it
    if (res.status === 410 || res.status === 404) {
      pushSubscription = null;
      console.log('[Notifications] Push subscription expired — removed');
    }
    throw new Error(`Web Push failed: ${res.status}`);
  }
}
