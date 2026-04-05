/**
 * Template Loader — reads agent prompt templates from prompt-templates/ directory.
 * Templates define the static parts of each agent's system prompt.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentId, AgentTemplate } from '../config/types.js';

const TEMPLATES_DIR = join(import.meta.dirname, '../../prompt-templates');

const templateCache = new Map<AgentId, AgentTemplate>();

export async function loadTemplate(agentId: AgentId): Promise<AgentTemplate> {
  const cached = templateCache.get(agentId);
  if (cached) return cached;

  const filePath = join(TEMPLATES_DIR, `${agentId}.json`);
  const raw = await readFile(filePath, 'utf-8');
  const data = JSON.parse(raw) as AgentTemplate;

  // Ensure agentId matches file
  data.agentId = agentId;
  templateCache.set(agentId, data);
  return data;
}

export function clearTemplateCache(): void {
  templateCache.clear();
}

/** Get all loadable agent IDs by scanning the templates directory. */
export async function listTemplates(): Promise<AgentId[]> {
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(TEMPLATES_DIR);
  return files
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', '') as AgentId);
}
