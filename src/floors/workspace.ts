/**
 * Workspace — manages the file system for each floor's project directory.
 * Each floor gets a Git-versioned workspace under ~/eve-projects/{slug}/.
 */

import { mkdir, readdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getConfig } from '../config/index.js';

const execFileAsync = promisify(execFile);

const WORKSPACE_SUBDIRS = [
  'brand',
  'copy',
  'design',
  'product',
  'website',
  'content',
  'ads',
  'analytics',
  'media',
  'deliverables',
  '.eve',
  '.eve/agents',
  '.eve/gold-standards',
];

export class Workspace {
  private projectsDir: string;

  constructor() {
    this.projectsDir = getConfig().PROJECTS_DIR;
  }

  /** Create the full workspace directory structure for a floor. */
  async create(slug: string): Promise<string> {
    const floorDir = join(this.projectsDir, slug);

    // Create all subdirectories
    for (const subdir of WORKSPACE_SUBDIRS) {
      await mkdir(join(floorDir, subdir), { recursive: true });
    }

    // Initialize Git repo
    await execFileAsync('git', ['init'], { cwd: floorDir });
    await writeFile(
      join(floorDir, '.gitignore'),
      'node_modules/\n.env\n*.log\n',
    );

    return floorDir;
  }

  /** Write a file to the workspace. */
  async writeFile(slug: string, relativePath: string, content: string): Promise<string> {
    const fullPath = join(this.projectsDir, slug, relativePath);
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, content, 'utf-8');
    return fullPath;
  }

  /** Read a file from the workspace. */
  async readFile(slug: string, relativePath: string): Promise<string> {
    const fullPath = join(this.projectsDir, slug, relativePath);
    return readFile(fullPath, 'utf-8');
  }

  /** List files in a workspace subdirectory. */
  async listFiles(slug: string, relativePath: string = ''): Promise<string[]> {
    const dirPath = join(this.projectsDir, slug, relativePath);
    try {
      return await readdir(dirPath);
    } catch {
      return [];
    }
  }

  /** Check if a file exists in the workspace. */
  async fileExists(slug: string, relativePath: string): Promise<boolean> {
    try {
      await access(join(this.projectsDir, slug, relativePath));
      return true;
    } catch {
      return false;
    }
  }

  /** Commit all changes in the workspace. */
  async commit(slug: string, message: string): Promise<void> {
    const cwd = join(this.projectsDir, slug);
    await execFileAsync('git', ['add', '-A'], { cwd });
    try {
      await execFileAsync('git', ['commit', '-m', message], { cwd });
    } catch {
      // No changes to commit — not an error
    }
  }

  /** Get workspace path for a floor. */
  getPath(slug: string): string {
    return join(this.projectsDir, slug);
  }

  /** Create agent directory structure within .eve/agents/. */
  async createAgentDir(slug: string, agentRole: string): Promise<string> {
    const agentDir = join(this.projectsDir, slug, '.eve', 'agents', agentRole);
    await mkdir(agentDir, { recursive: true });
    return agentDir;
  }

  /** Create gold standard directory for an agent task type. */
  async createGoldStandardDir(slug: string, agentId: string, taskType: string): Promise<string> {
    const dir = join(this.projectsDir, slug, '.eve', 'gold-standards', agentId, taskType);
    await mkdir(dir, { recursive: true });
    return dir;
  }
}
