/**
 * Health check API routes.
 * GET /api/health — orchestrator health
 * GET /api/health/integrations — integration API key validity
 */

import type { FastifyInstance } from 'fastify';
import type { Orchestrator } from '../../orchestrator/index.js';

interface IntegrationCheckResult {
  status: 'ok' | 'missing' | 'expiring' | 'error';
  expiresAt?: string;
  message?: string;
}

function unwrapCheck(result: PromiseSettledResult<IntegrationCheckResult>): IntegrationCheckResult {
  if (result.status === 'fulfilled') return result.value;
  return { status: 'error', message: (result.reason as Error)?.message ?? 'Check failed' };
}

async function checkAnthropicKey(): Promise<IntegrationCheckResult> {
  const key = process.env['ANTHROPIC_API_KEY'];
  if (!key) return { status: 'missing', message: 'ANTHROPIC_API_KEY not set' };
  return { status: 'ok' };
}

async function checkFalKey(): Promise<IntegrationCheckResult> {
  const key = process.env['FAL_KEY'];
  if (!key) return { status: 'missing', message: 'FAL_KEY not set' };
  return { status: 'ok' };
}

async function checkOpenAIKey(): Promise<IntegrationCheckResult> {
  const key = process.env['OPENAI_API_KEY'];
  if (!key) return { status: 'missing', message: 'OPENAI_API_KEY not set' };
  return { status: 'ok' };
}

async function checkStripeKey(): Promise<IntegrationCheckResult> {
  try {
    const { checkConnection } = await import('../../integrations/stripe.js');
    const valid = await checkConnection();
    if (valid) return { status: 'ok' };
    return { status: 'missing', message: 'Stripe not configured' };
  } catch {
    const key = process.env['STRIPE_SECRET_KEY'];
    if (!key) return { status: 'missing', message: 'STRIPE_SECRET_KEY not set' };
    return { status: 'ok' };
  }
}

async function checkElevenLabsKey(): Promise<IntegrationCheckResult> {
  const key = process.env['ELEVENLABS_API_KEY'];
  if (!key) return { status: 'missing', message: 'ELEVENLABS_API_KEY not set' };
  return { status: 'ok' };
}

async function checkPrintfulKey(): Promise<IntegrationCheckResult> {
  try {
    const { checkConnection } = await import('../../integrations/printful.js');
    const valid = await checkConnection();
    if (valid) return { status: 'ok' };
    return { status: 'missing', message: 'Printful not configured' };
  } catch {
    const key = process.env['PRINTFUL_API_KEY'];
    if (!key) return { status: 'missing', message: 'PRINTFUL_API_KEY not set' };
    return { status: 'ok' };
  }
}

async function checkMetaToken(): Promise<IntegrationCheckResult> {
  const token = process.env['META_ACCESS_TOKEN'];
  if (!token) return { status: 'missing', message: 'META_ACCESS_TOKEN not set' };
  // For now, just check if it exists (detailed expiry check would require API call)
  return { status: 'ok' };
}

async function checkTikTokToken(): Promise<IntegrationCheckResult> {
  const token = process.env['TIKTOK_ACCESS_TOKEN'];
  if (!token) return { status: 'missing', message: 'TIKTOK_ACCESS_TOKEN not set' };
  // For now, just check if it exists (detailed expiry check would require API call)
  return { status: 'ok' };
}

export function registerHealthRoutes(app: FastifyInstance, orchestrator: Orchestrator): void {
  app.get('/api/health', async () => {
    return orchestrator.getHealthStatus();
  });

  // Integration health check — shows which API keys are valid/configured
  app.get('/api/health/integrations', async () => {
    const checks = await Promise.allSettled([
      checkAnthropicKey(),
      checkFalKey(),
      checkOpenAIKey(),
      checkStripeKey(),
      checkElevenLabsKey(),
      checkPrintfulKey(),
      checkMetaToken(),
      checkTikTokToken(),
    ]);

    const results = [
      { provider: 'anthropic', ...unwrapCheck(checks[0]) },
      { provider: 'fal', ...unwrapCheck(checks[1]) },
      { provider: 'openai', ...unwrapCheck(checks[2]) },
      { provider: 'stripe', ...unwrapCheck(checks[3]) },
      { provider: 'elevenlabs', ...unwrapCheck(checks[4]) },
      { provider: 'printful', ...unwrapCheck(checks[5]) },
      { provider: 'meta', ...unwrapCheck(checks[6]) },
      { provider: 'tiktok', ...unwrapCheck(checks[7]) },
    ];

    return {
      timestamp: new Date().toISOString(),
      integrations: results,
      healthy: results.filter(r => r.status === 'ok').length,
      total: results.length,
    };
  });

  // Admin restart endpoint — triggers process.exit(0) so PM2 restarts with new code
  app.post('/api/admin/restart', async (_request, reply) => {
    reply.code(200).send({ success: true, message: 'Restarting in 1s...' });
    setTimeout(() => process.exit(0), 1000);
  });

  // Debug: query Supabase floors table directly
  app.get('/api/debug/supabase-floors', async (_request, reply) => {
    try {
      const { getSupabase } = await import('../../integrations/supabase.js');
      const sb = getSupabase();
      if (!sb) return reply.code(500).send({ error: 'Supabase not connected' });
      const { data, error } = await sb.from('floors').select('id, name, slug, status, current_phase, created_at');
      if (error) return reply.code(500).send({ error: error.message });
      return reply.send({ rows: data });
    } catch (err: unknown) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  /** Debug: list workspace files for a floor */
  app.get<{ Params: { slug: string } }>('/api/debug/workspace/:slug', async (request, reply) => {
    try {
      const { readdir, stat } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const projectsDir = process.env['PROJECTS_DIR'] || `${process.env['HOME'] ?? '/Users/automation'}/eve-projects`;
      const floorDir = join(projectsDir, request.params.slug);

      async function listRecursive(dir: string, prefix = ''): Promise<string[]> {
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
        const files: string[] = [];
        for (const e of entries) {
          const rel = prefix ? `${prefix}/${e.name}` : e.name;
          if (e.name === 'node_modules' || e.name === '.git') continue;
          if (e.isDirectory()) {
            files.push(...await listRecursive(join(dir, e.name), rel));
          } else {
            const s = await stat(join(dir, e.name)).catch(() => null);
            files.push(`${rel} (${s ? s.size : '?'} bytes)`);
          }
        }
        return files;
      }

      const files = await listRecursive(floorDir);
      return reply.send({ slug: request.params.slug, projectsDir, floorDir, fileCount: files.length, files });
    } catch (err: unknown) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  /** Debug: read a workspace file for a floor */
  app.get<{ Params: { slug: string; '*': string } }>('/api/debug/workspace/:slug/file/*', async (request, reply) => {
    try {
      const { readFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const projectsDir = process.env['PROJECTS_DIR'] || `${process.env['HOME'] ?? '/Users/automation'}/eve-projects`;
      const filePath = join(projectsDir, request.params.slug, request.params['*']);
      // Security: prevent path traversal
      if (filePath.includes('..')) return reply.code(400).send({ error: 'Invalid path' });
      const content = await readFile(filePath, 'utf-8');
      return reply.send({ path: request.params['*'], size: content.length, content: content.slice(0, 8000) });
    } catch (err: unknown) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  /** Debug: serve a workspace file raw (no JSON wrapping, no truncation) */
  app.get<{ Params: { slug: string; '*': string } }>('/api/debug/workspace/:slug/raw/*', async (request, reply) => {
    try {
      const { readFile } = await import('node:fs/promises');
      const { join, extname } = await import('node:path');
      const projectsDir = process.env['PROJECTS_DIR'] || `${process.env['HOME'] ?? '/Users/automation'}/eve-projects`;
      const filePath = join(projectsDir, request.params.slug, request.params['*']);
      if (filePath.includes('..')) return reply.code(400).send('Invalid path');
      const ext = extname(filePath).toLowerCase();
      const mimeMap: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.md': 'text/markdown', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
      const contentType = mimeMap[ext] ?? 'application/octet-stream';
      const isText = ['.html', '.css', '.js', '.json', '.md', '.svg', '.txt'].includes(ext);
      const content = await readFile(filePath, isText ? 'utf-8' : undefined);
      return reply.type(contentType).send(content);
    } catch (err: unknown) {
      return reply.code(500).send((err as Error).message);
    }
  });

  // Debug endpoint: test fal.ai image generation (supports ?model=ideogram&prompt=...)
  app.get('/api/debug/test-fal', async (request, reply) => {
    try {
      const { generateImage } = await import('../../clients/fal.js');
      const query = request.query as Record<string, string>;
      const model = query['model'] ?? 'fal-ai/flux/schnell';
      const prompt = query['prompt'] ?? 'A simple red circle on a white background, minimalist';
      const width = parseInt(query['width'] ?? '512', 10);
      const height = parseInt(query['height'] ?? '512', 10);
      const start = Date.now();
      const result = await Promise.race([
        generateImage({ model, prompt, width, height, numImages: 1 }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('fal.ai test timed out after 90s')), 90_000)),
      ]);
      const elapsed = Date.now() - start;
      return reply.send({
        success: true,
        elapsed: `${elapsed}ms`,
        urls: result.imageUrls,
        costCents: result.costCents,
        model: result.model,
      });
    } catch (err: unknown) {
      return reply.code(500).send({ success: false, error: (err as Error).message, model: (request.query as Record<string, string>)['model'] ?? 'fal-ai/flux/schnell' });
    }
  });

  /** Debug: diagnose why queued tasks aren't dispatching */
  app.get('/api/debug/queue-diagnosis', async (_request, reply) => {
    try {
      const orch = orchestrator as unknown as {
        taskManager: { getQueuedTasks(): Array<{ id: string; taskType: string; floorId: string; assignedAgent: string; modelTier: string; estimatedCostCents: number; prompt: string; phaseNumber: number; dependsOn: string[]; approvalToken?: string }> };
        safetyControls: { canDispatch(floorId: string): { allowed: boolean; reason?: string }; checkBudgetPerTurn(floorId: string, cost: number): { allowed: boolean; reason?: string } };
        guardian: { verify(check: unknown): { approved: boolean; violations: string[]; warnings: string[] } };
        concurrency: { canDispatch(floorId: string, tier: string): { allowed: boolean; reason?: string }; getActiveCount(): number };
        rateLimitBackoffMs: number;
        rateLimitSince: number;
        trustLadder: { needsApproval(floorId: string, taskType: string): boolean; getLevel(floorId: string): number };
      };

      const queued = orch.taskManager.getQueuedTasks();
      const results = queued.slice(0, 5).map(task => {
        const safety = orch.safetyControls.canDispatch(task.floorId);
        const deps = task.dependsOn.length > 0 ? 'HAS_DEPS' : 'no_deps';
        const guardian = orch.guardian.verify({
          taskId: task.id, floorId: task.floorId, agentId: task.assignedAgent,
          modelTier: task.modelTier, estimatedCostCents: task.estimatedCostCents,
          prompt: task.prompt, taskType: task.taskType, approvalToken: task.approvalToken,
        });
        const TRUST_EXEMPT = new Set([3, 4, 5, 6, 8]);
        const trustExempt = TRUST_EXEMPT.has(task.phaseNumber);
        const trustNeeded = !trustExempt && orch.trustLadder.needsApproval(task.floorId, task.taskType);
        const concurrency = orch.concurrency.canDispatch(task.floorId, task.modelTier);
        const budgetTurn = orch.safetyControls.checkBudgetPerTurn(task.floorId, task.estimatedCostCents);
        const rateLimitActive = orch.rateLimitBackoffMs > 0 && Date.now() - orch.rateLimitSince < orch.rateLimitBackoffMs;

        return {
          task: task.taskType,
          floor: task.floorId.slice(0, 8),
          phase: task.phaseNumber,
          safety: safety.allowed ? 'OK' : `BLOCKED: ${safety.reason}`,
          deps,
          guardian: guardian.approved ? 'OK' : `BLOCKED: ${guardian.violations.join('; ')}`,
          trustExempt,
          trustNeeded: trustNeeded ? 'NEEDS_APPROVAL' : 'OK',
          concurrency: concurrency.allowed ? 'OK' : `BLOCKED: ${concurrency.reason}`,
          budgetTurn: budgetTurn.allowed ? 'OK' : `BLOCKED: ${budgetTurn.reason}`,
          rateLimit: rateLimitActive ? `BLOCKED: ${orch.rateLimitBackoffMs}ms` : 'OK',
        };
      });

      return reply.send({ queuedCount: queued.length, activeCount: orch.concurrency.getActiveCount(), rateLimitBackoffMs: orch.rateLimitBackoffMs, diagnosis: results });
    } catch (err: unknown) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // Debug: force-dispatch queued tasks for a floor
  app.post<{ Params: { id: string } }>('/api/debug/force-dispatch/:id', async (request, reply) => {
    const floorId = request.params.id;
    const tasks = orchestrator.getFloorTasks(floorId);
    const queued = tasks.filter((t: { status: string }) => t.status === 'queued');
    if (queued.length === 0) return reply.send({ message: 'No queued tasks', taskCount: tasks.length, statuses: tasks.map((t: { taskType: string; status: string }) => `${t.taskType}:${t.status}`) });
    // Trigger processQueue manually via the orchestrator's tick
    orchestrator.forceProcessQueue?.();
    return reply.send({ message: `Found ${queued.length} queued tasks, triggered queue processing`, queued: queued.map((t: { taskType: string }) => t.taskType) });
  });
}
