/**
 * Notification API routes — handle notifications and Web Push subscriptions.
 */

import type { FastifyInstance } from 'fastify';
import {
  getAll,
  getUnread,
  markRead,
  markAllRead,
  registerPushSubscription,
  getVapidPublicKey,
} from '../../integrations/notifications.js';

interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function registerNotificationRoutes(app: FastifyInstance): void {
  // Get all notifications for a floor
  app.get<{ Querystring: { floorId?: string } }>('/api/notifications', async (request) => {
    const { floorId } = request.query;
    return getAll(floorId);
  });

  // Get unread notifications for a floor
  app.get<{ Querystring: { floorId?: string } }>('/api/notifications/unread', async (request) => {
    const { floorId } = request.query;
    return getUnread(floorId);
  });

  // Mark a specific notification as read
  app.post<{ Params: { id: string } }>('/api/notifications/:id/read', async (request) => {
    const { id } = request.params;
    return { success: markRead(id) };
  });

  // Mark all notifications as read for a floor
  app.post<{ Querystring: { floorId?: string } }>('/api/notifications/read-all', async (request) => {
    const { floorId } = request.query;
    return { count: markAllRead(floorId) };
  });

  // Get VAPID public key for Web Push
  app.get('/api/notifications/vapid-key', async () => {
    return { publicKey: getVapidPublicKey() };
  });

  // Register a Web Push subscription
  app.post<{ Body: PushSubscription }>('/api/notifications/subscribe', async (request) => {
    registerPushSubscription(request.body);
    return { success: true };
  });
}
