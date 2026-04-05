/**
 * OpenClaw CLI wrapper — dispatches tasks to real agents via the openclaw CLI.
 * Real agents: Floor Manager, Web Agent, Launch Agent, CEO Mode.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const execFileAsync = promisify(execFile);

const OPENCLAW_TIMEOUT_MS = 600_000; // 10 minutes

export interface OpenClawResult {
  success: boolean;
  output: string;
  agentId: string;
  error?: string;
}

export interface OpenClawStatus {
  gatewayReachable: boolean;
  agents: Array<{ id: string; name: string; status: string }>;
}

/**
 * Send a message to a real agent via openclaw chat CLI.
 */
export async function dispatchToAgent(
  agentId: string,
  message: string,
): Promise<OpenClawResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      'openclaw',
      ['chat', '--agent', agentId, '--message', message, '--json', '--no-streaming'],
      { timeout: OPENCLAW_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
    );

    if (stderr && !stdout) {
      return { success: false, output: '', agentId, error: stderr };
    }

    // Parse JSON response from OpenClaw
    try {
      const parsed = JSON.parse(stdout) as { response?: string; error?: string };
      if (parsed.error) {
        return { success: false, output: '', agentId, error: parsed.error };
      }
      return { success: true, output: parsed.response ?? stdout, agentId };
    } catch {
      // Non-JSON output — return raw
      return { success: true, output: stdout.trim(), agentId };
    }
  } catch (err) {
    const message_ = err instanceof Error ? err.message : String(err);
    return { success: false, output: '', agentId, error: message_ };
  }
}

/**
 * Register a new agent with OpenClaw.
 * workspacePath: absolute path to the agent's workspace directory (contains SOUL.md, AGENTS.md, etc.)
 */
export async function registerAgent(
  agentId: string,
  name: string,
  soulPath: string,
  workspacePath?: string,
): Promise<boolean> {
  try {
    const args = [
      'agents', 'add',
      '--id', agentId,
      '--name', name,
      '--soul', soulPath,
    ];
    if (workspacePath) {
      args.push('--workspace', workspacePath);
    }
    await execFileAsync('openclaw', args);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write the openclaw.json master configuration file.
 * Called once during system setup or when config changes.
 */
export async function writeOpenClawConfig(config: {
  anthropicApiKey: string;
  ownerTelegramId?: string;
  timezone?: string;
}): Promise<boolean> {
  const configPath = join(homedir(), '.openclaw', 'openclaw.json');
  const tz = config.timezone ?? 'America/Chicago';
  const telegramId = config.ownerTelegramId ?? '';

  const configJson = {
    identity: {
      name: 'EVE',
      emoji: '🏛️',
    },
    agent: {
      workspace: join(homedir(), '.openclaw', 'agents', 'eve-ceo'),
      model: {
        primary: 'anthropic/claude-opus-4-6',
        fallbacks: ['anthropic/claude-sonnet-4-6'],
      },
    },
    agents: {
      defaults: {
        heartbeat: {
          every: '5m',
          target: 'none',
          lightContext: true,
          isolatedSession: true,
          activeHours: {
            start: '06:00',
            end: '23:00',
            timezone: tz,
          },
        },
        userTimezone: tz,
      },
      list: [
        {
          id: 'eve-ceo',
          default: true,
          workspace: join(homedir(), '.openclaw', 'agents', 'eve-ceo'),
          model: 'anthropic/claude-opus-4-6',
          heartbeat: {
            every: '5m',
            lightContext: true,
            isolatedSession: true,
          },
          tools: {
            allow: ['lobster', 'llm-task'],
          },
          maxChildrenPerAgent: 5,
          maxSpawnDepth: 1,
        },
        // Floor agents are added dynamically via `openclaw agents add` during floor creation
      ],
    },
    channels: {
      telegram: {
        enabled: telegramId !== '',
        dmPolicy: 'pairing',
        allowFrom: telegramId ? [telegramId] : [],
      },
    },
    models: {
      providers: {
        anthropic: {
          apiKey: config.anthropicApiKey,
        },
      },
    },
    auth: {
      profiles: ['owner'],
      order: ['owner'],
    },
    plugins: {
      entries: {
        lobster: { enabled: true },
        'llm-task': { enabled: true },
      },
    },
    session: {
      maintenance: {
        mode: 'summarize',
        pruneAfter: 50,
        maxEntries: 200,
      },
    },
    security: {
      elevated: {
        enabled: false,
      },
    },
  };

  try {
    await mkdir(join(homedir(), '.openclaw'), { recursive: true });
    await writeFile(configPath, JSON.stringify(configJson, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure the CEO Mode agent workspace files exist.
 * Called during system setup.
 */
export async function ensureCeoModeWorkspace(soulContent: string, agentsContent: string): Promise<boolean> {
  const workspaceDir = join(homedir(), '.openclaw', 'agents', 'eve-ceo');
  try {
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(join(workspaceDir, 'memory'), { recursive: true });
    await writeFile(join(workspaceDir, 'SOUL.md'), soulContent, 'utf8');
    await writeFile(join(workspaceDir, 'AGENTS.md'), agentsContent, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Check OpenClaw gateway status and list agents.
 */
export async function getStatus(): Promise<OpenClawStatus> {
  try {
    const { stdout } = await execFileAsync('openclaw', ['status', '--deep', '--json'], {
      timeout: 10_000,
    });
    const parsed = JSON.parse(stdout) as {
      gateway?: { reachable?: boolean };
      agents?: Array<{ id: string; name: string; status: string }>;
    };
    return {
      gatewayReachable: parsed.gateway?.reachable ?? false,
      agents: parsed.agents ?? [],
    };
  } catch {
    return { gatewayReachable: false, agents: [] };
  }
}

/**
 * Check if OpenClaw is available on this system.
 */
export async function isAvailable(): Promise<boolean> {
  try {
    await execFileAsync('which', ['openclaw']);
    return true;
  } catch {
    return false;
  }
}
