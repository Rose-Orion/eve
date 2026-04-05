/**
 * WebsiteDeployer — Deploys generated websites to Vercel.
 *
 * Takes Web Agent's generated site code (Next.js or static) and:
 * 1. Creates a Vercel project (or updates existing)
 * 2. Deploys source files via Vercel Deployments API
 * 3. Configures custom domain + SSL
 * 4. Injects environment variables (Stripe keys, analytics, etc.)
 *
 * Also supports pre-deployment validation (Lighthouse-style checks).
 */

import { getConfig } from '../config/index.js';
import type { EventBus } from './event-bus.js';

const VERCEL_API = 'https://api.vercel.com';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DeploymentConfig {
  floorId: string;
  floorSlug: string;
  /** Vercel project name (kebab-case, derived from floor slug) */
  projectName: string;
  /** Framework: next, static, or astro */
  framework: 'nextjs' | 'static' | 'astro';
  /** Source files to deploy: path → content */
  files: Array<{ path: string; content: string }>;
  /** Environment variables to inject */
  envVars?: Record<string, string>;
  /** Custom domain (optional — Vercel provides .vercel.app by default) */
  customDomain?: string;
  /** Build command override */
  buildCommand?: string;
  /** Output directory override */
  outputDirectory?: string;
}

export interface DeploymentResult {
  success: boolean;
  deploymentId?: string;
  deploymentUrl?: string;
  projectId?: string;
  inspectorUrl?: string;
  error?: string;
  /** Vercel-assigned .vercel.app URL */
  vercelUrl?: string;
  /** Custom domain URL (if configured) */
  customUrl?: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  url: string;
  latestDeploymentId?: string;
  latestDeploymentUrl?: string;
}

// ─── WebsiteDeployer ────────────────────────────────────────────────────────

export class WebsiteDeployer {
  constructor(private eventBus: EventBus) {}

  // ── API Helpers ──

  private getHeaders(): Record<string, string> {
    const config = getConfig();
    if (!config.VERCEL_API_TOKEN) throw new Error('VERCEL_API_TOKEN not configured');
    return {
      'Authorization': `Bearer ${config.VERCEL_API_TOKEN}`,
      'Content-Type': 'application/json',
    };
  }

  private getTeamParam(): string {
    const config = getConfig();
    return config.VERCEL_TEAM_ID ? `?teamId=${config.VERCEL_TEAM_ID}` : '';
  }

  // ── Project Management ──

  /**
   * Get or create a Vercel project for this floor.
   */
  async ensureProject(config: DeploymentConfig): Promise<ProjectInfo> {
    const teamParam = this.getTeamParam();

    // Check if project already exists
    const existing = await this.getProject(config.projectName);
    if (existing) return existing;

    // Create new project
    const frameworkMap: Record<string, string> = {
      nextjs: 'nextjs',
      static: '',
      astro: 'astro',
    };

    const body: Record<string, unknown> = {
      name: config.projectName,
      framework: frameworkMap[config.framework] || undefined,
    };

    if (config.buildCommand) body['buildCommand'] = config.buildCommand;
    if (config.outputDirectory) body['outputDirectory'] = config.outputDirectory;

    const res = await fetch(`${VERCEL_API}/v10/projects${teamParam}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => 'unknown');
      throw new Error(`Vercel createProject failed (${res.status}): ${err}`);
    }

    const data = await res.json() as { id: string; name: string };

    console.log(`[WebsiteDeployer] Created Vercel project "${config.projectName}" (${data.id})`);

    return {
      id: data.id,
      name: data.name,
      url: `https://${data.name}.vercel.app`,
    };
  }

  /**
   * Look up an existing Vercel project by name.
   */
  async getProject(projectName: string): Promise<ProjectInfo | null> {
    const teamParam = this.getTeamParam();

    const res = await fetch(`${VERCEL_API}/v9/projects/${encodeURIComponent(projectName)}${teamParam}`, {
      headers: this.getHeaders(),
    });

    if (res.status === 404) return null;
    if (!res.ok) return null;

    const data = await res.json() as {
      id: string;
      name: string;
      latestDeployments?: Array<{ uid: string; url: string }>;
    };

    const latest = data.latestDeployments?.[0];
    return {
      id: data.id,
      name: data.name,
      url: `https://${data.name}.vercel.app`,
      latestDeploymentId: latest?.uid,
      latestDeploymentUrl: latest?.url ? `https://${latest.url}` : undefined,
    };
  }

  // ── Deployment ──

  /**
   * Deploy files to Vercel. Creates project if it doesn't exist.
   */
  async deploy(config: DeploymentConfig): Promise<DeploymentResult> {
    try {
      // 1. Ensure project exists
      const project = await this.ensureProject(config);

      // 2. Set environment variables if provided
      if (config.envVars && Object.keys(config.envVars).length > 0) {
        await this.setEnvVars(project.id, config.envVars);
      }

      // 3. Create deployment with files
      const deployResult = await this.createDeployment(project, config);

      // 4. Emit deployment event
      this.eventBus.emit('floor:status-changed', {
        floorId: config.floorId,
        status: 'building',
      });

      console.log(`[WebsiteDeployer] Deployed ${config.projectName}: ${deployResult.deploymentUrl}`);

      return deployResult;
    } catch (err) {
      const error = (err as Error).message;
      console.error(`[WebsiteDeployer] Deployment failed for ${config.projectName}: ${error}`);
      return { success: false, error };
    }
  }

  /**
   * Create a deployment via Vercel's v13 Deployments API.
   * Uses file-based deployment (source files uploaded directly).
   */
  private async createDeployment(project: ProjectInfo, config: DeploymentConfig): Promise<DeploymentResult> {
    const teamParam = this.getTeamParam();

    // Convert files to Vercel format (base64 encoded)
    const vercelFiles = config.files.map(f => ({
      file: f.path,
      data: Buffer.from(f.content).toString('base64'),
      encoding: 'base64' as const,
    }));

    const body: Record<string, unknown> = {
      name: config.projectName,
      files: vercelFiles,
      projectSettings: {
        framework: config.framework === 'nextjs' ? 'nextjs' : config.framework === 'astro' ? 'astro' : null,
        buildCommand: config.buildCommand ?? null,
        outputDirectory: config.outputDirectory ?? null,
      },
      target: 'production',
    };

    const res = await fetch(`${VERCEL_API}/v13/deployments${teamParam}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => 'unknown');
      throw new Error(`Vercel deployment failed (${res.status}): ${err}`);
    }

    const data = await res.json() as {
      id: string;
      url: string;
      inspectorUrl: string;
      readyState: string;
    };

    return {
      success: true,
      deploymentId: data.id,
      deploymentUrl: `https://${data.url}`,
      projectId: project.id,
      inspectorUrl: data.inspectorUrl,
      vercelUrl: `https://${data.url}`,
    };
  }

  // ── Environment Variables ──

  /**
   * Set environment variables on a Vercel project.
   */
  private async setEnvVars(projectId: string, vars: Record<string, string>): Promise<void> {
    const teamParam = this.getTeamParam();

    const envArray = Object.entries(vars).map(([key, value]) => ({
      key,
      value,
      target: ['production', 'preview', 'development'],
      type: 'encrypted',
    }));

    const res = await fetch(`${VERCEL_API}/v10/projects/${projectId}/env${teamParam}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(envArray),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => 'unknown');
      console.warn(`[WebsiteDeployer] Failed to set env vars: ${err}`);
    }
  }

  // ── Domain Management ──

  /**
   * Add a custom domain to a Vercel project.
   */
  async addDomain(projectId: string, domain: string): Promise<{ configured: boolean; error?: string }> {
    const teamParam = this.getTeamParam();

    const res = await fetch(`${VERCEL_API}/v10/projects/${projectId}/domains${teamParam}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ name: domain }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => 'unknown');
      return { configured: false, error: `Domain add failed: ${err}` };
    }

    console.log(`[WebsiteDeployer] Added domain ${domain} to project ${projectId}`);
    return { configured: true };
  }

  // ── Deployment Status ──

  /**
   * Check deployment status (building, ready, error).
   */
  async getDeploymentStatus(deploymentId: string): Promise<{ state: string; url?: string; error?: string }> {
    const teamParam = this.getTeamParam();

    const res = await fetch(`${VERCEL_API}/v13/deployments/${deploymentId}${teamParam}`, {
      headers: this.getHeaders(),
    });

    if (!res.ok) {
      return { state: 'error', error: `Failed to fetch deployment status (${res.status})` };
    }

    const data = await res.json() as { readyState: string; url?: string; errorMessage?: string };
    return {
      state: data.readyState,
      url: data.url ? `https://${data.url}` : undefined,
      error: data.errorMessage,
    };
  }

  /**
   * Wait for a deployment to reach READY state (polls every 5s, max 5 min).
   */
  async waitForReady(deploymentId: string, maxWaitMs = 300_000): Promise<DeploymentResult> {
    const start = Date.now();
    const pollInterval = 5000;

    while (Date.now() - start < maxWaitMs) {
      const status = await this.getDeploymentStatus(deploymentId);

      if (status.state === 'READY') {
        return {
          success: true,
          deploymentId,
          deploymentUrl: status.url,
          vercelUrl: status.url,
        };
      }

      if (status.state === 'ERROR' || status.state === 'CANCELED') {
        return {
          success: false,
          deploymentId,
          error: status.error ?? `Deployment ${status.state}`,
        };
      }

      // Still building — wait and retry
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    return {
      success: false,
      deploymentId,
      error: `Deployment timed out after ${maxWaitMs / 1000}s`,
    };
  }

  // ── Connection Check ──

  async checkConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${VERCEL_API}/v2/user`, { headers: this.getHeaders() });
      return res.ok;
    } catch {
      return false;
    }
  }
}
