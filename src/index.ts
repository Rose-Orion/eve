/**
 * EVE Orchestrator — Entry Point
 *
 * Boots the system: loads config, verifies connections, starts services.
 */

import { config as loadDotenv } from 'dotenv';
loadDotenv({ override: true });
import { mkdir } from 'node:fs/promises';
import { loadConfig } from './config/index.js';
import { Orchestrator } from './orchestrator/index.js';
import { createServer } from './server/index.js';
import { isAvailable as isOpenClawAvailable, getStatus as getOpenClawStatus } from './clients/openclaw.js';
import { checkConnection as checkSupabase, isPromptPersisted } from './integrations/supabase.js';
import { AgentHealthMonitor } from './agents/health.js';

async function boot() {
  console.log('=== EVE Orchestrator ===');
  console.log('');

  // 1. Load and validate config
  const config = loadConfig();
  console.log(`  Environment:  ${config.NODE_ENV}`);
  console.log(`  Projects dir: ${config.PROJECTS_DIR}`);
  console.log(`  API port:     ${config.PORT}`);
  console.log('');

  // Ensure projects directory exists
  await mkdir(config.PROJECTS_DIR, { recursive: true });

  // 2. Check external services
  console.log('Checking services...');

  // Anthropic
  console.log(`  Anthropic API: ${config.ANTHROPIC_API_KEY ? 'configured' : 'MISSING'}`);

  // Redis
  try {
    const ioredis = await import('ioredis');
    const RedisClass = ioredis.default as unknown as new (url: string) => { ping: () => Promise<string>; quit: () => Promise<void> };
    const redis = new RedisClass(config.REDIS_URL);
    const pong = await redis.ping();
    console.log(`  Redis:         ${pong === 'PONG' ? 'connected' : 'error'}`);
    await redis.quit();
  } catch {
    console.log('  Redis:         not available (tasks will run in-memory)');
  }

  // Supabase
  const supabaseOk = await checkSupabase();
  console.log(`  Supabase:      ${supabaseOk ? 'connected' : 'not configured (using in-memory)'}`);
  if (supabaseOk && !isPromptPersisted()) {
    console.warn('');
    console.warn('  ╔══════════════════════════════════════════════════════════════╗');
    console.warn('  ║  ⚠️  CRITICAL: tasks.prompt column missing in Supabase!     ║');
    console.warn('  ║  Agent prompts will be LOST on restart.                     ║');
    console.warn('  ║  Run migrations/001_add_task_prompt_column.sql              ║');
    console.warn('  ║  in Supabase Dashboard → SQL Editor                        ║');
    console.warn('  ╚══════════════════════════════════════════════════════════════╝');
    console.warn('');
  }

  // OpenClaw
  const openclawOk = await isOpenClawAvailable();
  if (openclawOk) {
    const status = await getOpenClawStatus();
    console.log(`  OpenClaw:      gateway ${status.gatewayReachable ? 'reachable' : 'unreachable'}, ${status.agents.length} agents`);
  } else {
    console.log('  OpenClaw:      not installed');
  }

  // Optional services
  console.log(`  fal.ai:        ${config.FAL_KEY ? 'configured' : 'not configured'}`);
  console.log(`  OpenAI:        ${config.OPENAI_API_KEY ? 'configured' : 'not configured'}`);
  console.log(`  ElevenLabs:    ${config.ELEVENLABS_API_KEY ? 'configured' : 'not configured'}`);
  console.log('');

  // 3. Initialize Orchestrator
  const orchestrator = new Orchestrator();

  // 3b. Recover persisted state from Supabase (crash recovery)
  await orchestrator.loadPersistedState();

  // 4. Start health monitor
  const healthMonitor = new AgentHealthMonitor(orchestrator.eventBus, orchestrator.agentRegistry);
  healthMonitor.start();

  // 5. Start Fastify API server
  const server = await createServer(orchestrator);
  await server.listen({ port: config.PORT, host: '0.0.0.0' });
  console.log(`  Dashboard API: http://localhost:${config.PORT}`);

  // 6. Start Orchestrator event loop
  orchestrator.start();

  console.log('');
  console.log('EVE Orchestrator ready.');
  console.log('');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down...');
    orchestrator.stop();
    healthMonitor.stop();
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

boot().catch((err) => {
  console.error('Boot failed:', err);
  process.exit(1);
});
