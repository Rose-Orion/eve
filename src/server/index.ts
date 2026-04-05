/**
 * Fastify server — Dashboard API.
 * Runs in the same Node.js process as the Orchestrator.
 */

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Orchestrator } from '../orchestrator/index.js';
import { getConfig } from '../config/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { registerAuthMiddleware } from './middleware/auth.js';
import { registerErrorHandler } from './middleware/errors.js';
import { registerFloorRoutes } from './routes/floors.js';
import { registerTaskRoutes } from './routes/tasks.js';
import { registerApprovalRoutes } from './routes/approvals.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerCostRoutes } from './routes/costs.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerImprovementRoutes } from './routes/improvements.js';
import { registerEvaluateRoutes } from './routes/evaluate.js';
import { registerFeedbackRoutes } from './routes/feedback.js';
import { registerWebhookRoutes } from './routes/webhooks.js';
import { registerNotificationRoutes } from './routes/notifications.js';
import { registerHeartbeatRoutes } from './routes/heartbeat.js';
import { getDashboardVersion } from '../orchestrator/eve-actions.js';

export async function createServer(orchestrator: Orchestrator) {
  const app = Fastify({ logger: { level: 'info' } });

  // CORS
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (request.method === 'OPTIONS') {
      reply.status(204).send();
    }
  });

  // Serve dashboard static files — disable caching so code changes appear immediately.
  // Use ETag based on file mtime so Chrome always revalidates.
  await app.register(fastifyStatic, {
    root: join(__dirname, '../../public'),
    prefix: '/',
    decorateReply: false,
    cacheControl: false,
    etag: true,
    lastModified: true,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
    },
  });

  // Cache busting: static plugin serves index.html with no-store headers.
  // Version param in the HTML file (app.js?v=xxx) must be bumped manually
  // or via a build step. The no-store + ETag headers ensure the browser
  // always revalidates both index.html and app.js on each load.

  // Auth + error handling
  registerAuthMiddleware(app);
  registerErrorHandler(app);

  // Public config (Supabase URL + anon key for frontend realtime)
  app.get('/api/config/public', async () => {
    const config = getConfig();
    return {
      supabaseUrl: config.SUPABASE_URL ?? null,
      supabaseAnonKey: config.SUPABASE_ANON_KEY ?? null,
    };
  });

  // Dashboard version — frontend polls this to detect live patches
  app.get('/api/dashboard/version', async () => ({ version: getDashboardVersion() }));

  // Webhook routes (registered first — uses encapsulated raw body parser for signature verification)
  registerWebhookRoutes(app, orchestrator);

  // Routes
  registerFloorRoutes(app, orchestrator);
  registerTaskRoutes(app, orchestrator);
  registerApprovalRoutes(app, orchestrator);
  registerHealthRoutes(app, orchestrator);
  registerCostRoutes(app, orchestrator);
  registerChatRoutes(app, orchestrator);
  registerImprovementRoutes(app, orchestrator);
  registerEvaluateRoutes(app);
  registerFeedbackRoutes(app, orchestrator);
  registerNotificationRoutes(app);
  registerHeartbeatRoutes(app, orchestrator);

  return app;
}
