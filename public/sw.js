/**
 * EVE Dashboard Service Worker
 * Enables offline support, caching, and push notifications
 */

const CACHE_NAME = 'eve-dashboard-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/styles.css',
  '/manifest.json',
];

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        // Fail gracefully if some assets don't exist
        return Promise.resolve();
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch: network-first for API calls, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API calls: network-first
  if (url.pathname.startsWith('/api/')) {
    return event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful API responses
          if (response.ok) {
            const cache = caches.open(CACHE_NAME);
            cache.then((c) => c.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => {
          // Fallback to cache on network error
          return caches.match(request).then((response) => {
            if (response) return response;
            // Return offline fallback
            return new Response(
              JSON.stringify({ error: 'Offline', message: 'Unable to load data without internet' }),
              { status: 503, headers: { 'Content-Type': 'application/json' } }
            );
          });
        })
    );
  }

  // Static assets: cache-first
  return event.respondWith(
    caches.match(request).then((response) => {
      if (response) return response;
      return fetch(request)
        .then((response) => {
          if (response.ok) {
            const cache = caches.open(CACHE_NAME);
            cache.then((c) => c.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => {
          // Return offline page for HTML requests
          if (request.mode === 'navigate') {
            return new Response(
              `<!DOCTYPE html>
              <html>
                <head>
                  <meta charset="utf-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1">
                  <title>EVE - Offline</title>
                  <style>
                    body { font-family: -apple-system, system-ui; background: #05050f; color: #fff; padding: 20px; text-align: center; margin-top: 100px; }
                    h1 { font-size: 32px; margin: 0 0 10px; }
                    p { font-size: 16px; color: #aaa; }
                  </style>
                </head>
                <body>
                  <h1>🔌 Offline</h1>
                  <p>You're currently offline. Some features may be limited.</p>
                  <p>Reconnect to the internet to continue.</p>
                </body>
              </html>`,
              { status: 200, headers: { 'Content-Type': 'text/html' } }
            );
          }
          return new Response('Not found', { status: 404 });
        })
    })
  );
});

// Push notifications: show notification when message arrives
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const options = {
    badge: '/manifest.json',
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect fill="%234A3AFF" width="192" height="192"/><text x="96" y="144" font-size="120" font-weight="bold" text-anchor="middle" fill="%23FFB833" font-family="system-ui">E</text></svg>',
    badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect fill="%234A3AFF" width="96" height="96"/><text x="48" y="68" font-size="60" text-anchor="middle" fill="%23FFB833" font-weight="bold">E</text></svg>',
    tag: data.tag || 'eve-notification',
    requireInteraction: data.requireInteraction || false,
    data: data.data || {},
    actions: [
      {
        action: 'open',
        title: 'Open',
      },
      {
        action: 'close',
        title: 'Dismiss',
      },
    ],
  };

  const title = data.title || 'EVE Dashboard';
  const body = data.body || 'You have a new notification';

  event.waitUntil(
    self.registration.showNotification(title, {
      ...options,
      body,
    })
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'close') {
    return;
  }

  const urlToOpen = event.notification.data.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Check if there's already a window/tab open with the target URL
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // If not, open a new window/tab
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-approvals') {
    event.waitUntil(
      fetch('/api/approvals').then((response) => {
        if (response.ok) {
          return self.registration.showNotification('Approvals synced', {
            tag: 'eve-sync',
            body: 'Your approvals have been synced',
          });
        }
        return Promise.reject();
      })
    );
  }
});
