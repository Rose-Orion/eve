/**
 * Auth middleware — supports bearer token (API) and Supabase magic link (Dashboard).
 * Bearer token: direct API key or session token.
 * Supabase JWT: verified against Supabase auth.
 * Session expiry: 24 hours.
 */

import type { FastifyInstance } from 'fastify';

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// Simple in-memory session store (sufficient for single-instance deployment)
const sessions = new Map<string, { userId: string; email: string; createdAt: number }>();

export function registerAuthMiddleware(app: FastifyInstance): void {
  const apiKey = process.env['EVE_API_KEY'];

  // If no API key configured, skip auth (development mode)
  if (!apiKey) return;

  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'OPTIONS') return;
    if (request.url === '/api/health') return;
    if (request.url === '/api/health/integrations') return;
    if (request.url.startsWith('/api/auth/')) return; // auth endpoints are public
    if (!request.url.startsWith('/api/')) return;

    const authHeader = request.headers.authorization;
    if (!authHeader) {
      reply.status(401).send({ error: 'Missing authorization header' });
      return;
    }

    // Method 1: Bearer token (API key or session)
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);

      // Check direct API key
      if (token === apiKey) return;

      // Check session token
      const session = sessions.get(token);
      if (session && Date.now() - session.createdAt < SESSION_MAX_AGE_MS) return;

      // Expired session — clean up
      if (session) sessions.delete(token);

      // Try Supabase JWT verification
      try {
        const { getSupabase } = await import('../../integrations/supabase.js');
        const sb = getSupabase();
        if (sb) {
          const { data, error } = await sb.auth.getUser(token);
          if (!error && data.user) return; // Valid Supabase JWT
        }
      } catch {
        /* fall through to 403 */
      }

      reply.status(403).send({ error: 'Invalid or expired token' });
      return;
    }

    reply.status(401).send({ error: 'Invalid authorization format' });
  });

  // Magic link request endpoint
  app.post('/api/auth/magic-link', async (request, reply) => {
    const { email } = request.body as { email?: string };
    if (!email) {
      return reply.status(400).send({ error: 'Email required' });
    }

    try {
      const { getSupabase } = await import('../../integrations/supabase.js');
      const sb = getSupabase();
      if (!sb) {
        return reply.status(503).send({ error: 'Supabase not configured' });
      }

      const { error } = await sb.auth.signInWithOtp({ email });
      if (error) {
        return reply.status(400).send({ error: error.message });
      }

      return { success: true, message: 'Magic link sent to email' };
    } catch (err) {
      return reply.status(500).send({ error: 'Failed to send magic link' });
    }
  });

  // Token verification endpoint (exchanges magic link token for session)
  app.post('/api/auth/verify', async (request, reply) => {
    const { token, type } = request.body as { token?: string; type?: string };
    if (!token) {
      return reply.status(400).send({ error: 'Token required' });
    }

    try {
      const { getSupabase } = await import('../../integrations/supabase.js');
      const sb = getSupabase();
      if (!sb) {
        return reply.status(503).send({ error: 'Supabase not configured' });
      }

      const { data, error } = await sb.auth.verifyOtp({
        token_hash: token,
        type: (type as 'magiclink') || 'magiclink',
      });

      if (error || !data.session) {
        return reply.status(401).send({ error: error?.message ?? 'Verification failed' });
      }

      // Create local session
      const sessionToken = crypto.randomUUID();
      sessions.set(sessionToken, {
        userId: data.user?.id ?? 'unknown',
        email: data.user?.email ?? 'unknown',
        createdAt: Date.now(),
      });

      return {
        sessionToken,
        expiresIn: SESSION_MAX_AGE_MS / 1000,
        user: { id: data.user?.id, email: data.user?.email },
      };
    } catch (err) {
      return reply.status(500).send({ error: 'Verification failed' });
    }
  });

  // Periodic session cleanup (every hour)
  setInterval(() => {
    const now = Date.now();
    for (const [token, session] of sessions) {
      if (now - session.createdAt > SESSION_MAX_AGE_MS) {
        sessions.delete(token);
      }
    }
  }, 60 * 60 * 1000);
}
