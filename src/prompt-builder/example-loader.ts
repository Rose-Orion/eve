/**
 * Example Loader — loads Gold Standard approved examples for few-shot prompting.
 * Examples accumulate over time as outputs get approved.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentId, GoldStandardExample } from '../config/types.js';
import { countTokens, truncateToTokens } from './token-counter.js';

const PROJECTS_DIR = join(process.env['HOME'] ?? '/Users/automation', 'orion-projects');

const MAX_EXAMPLES = 3;
const MAX_TOTAL_TOKENS = 1000;

/**
 * Load gold standard examples for a specific agent and task type.
 * Returns 2-3 most recent approved examples, trimmed to fit token budget.
 */
export async function loadGoldStandards(
  floorSlug: string,
  agentId: AgentId,
  taskType: string,
): Promise<GoldStandardExample[]> {
  const examplesDir = join(
    PROJECTS_DIR, floorSlug, '.orion', 'gold-standards', agentId, taskType,
  );

  let files: string[];
  try {
    files = await readdir(examplesDir);
  } catch {
    return []; // No examples yet — this is normal for new floors
  }

  // Filter to .md files and sort by modification time (most recent first)
  const mdFiles = files.filter(f => f.endsWith('.md'));
  const withStats = await Promise.all(
    mdFiles.map(async f => {
      const filePath = join(examplesDir, f);
      const s = await stat(filePath);
      return { file: f, path: filePath, mtime: s.mtime };
    }),
  );

  withStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  // Take the 2-3 most recent
  const selected = withStats.slice(0, MAX_EXAMPLES);

  const examples: GoldStandardExample[] = [];
  let totalTokens = 0;

  for (const entry of selected) {
    const content = await readFile(entry.path, 'utf-8');
    let tokens = await countTokens(content);

    // Trim if adding this would exceed budget
    let finalContent = content;
    if (totalTokens + tokens > MAX_TOTAL_TOKENS) {
      const remaining = MAX_TOTAL_TOKENS - totalTokens;
      if (remaining < 100) break; // Not enough space for a meaningful example
      finalContent = await truncateToTokens(content, remaining);
      tokens = remaining;
    }

    examples.push({
      taskType,
      content: finalContent,
      approvedAt: entry.mtime,
      tokenCount: tokens,
    });

    totalTokens += tokens;
    if (totalTokens >= MAX_TOTAL_TOKENS) break;
  }

  return examples;
}

/**
 * Save a completed task output as a Gold Standard example.
 * Caps at MAX_EXAMPLES per agent/taskType combo (deletes oldest).
 */
export async function saveGoldStandard(
  floorSlug: string,
  agentId: AgentId,
  taskType: string,
  output: string,
  floorName?: string,
): Promise<void> {
  const { mkdir, writeFile: fsWriteFile, readdir: fsReaddir, unlink, stat: fsStat } = await import('node:fs/promises');

  const examplesDir = join(
    PROJECTS_DIR, floorSlug, '.orion', 'gold-standards', agentId, taskType,
  );

  await mkdir(examplesDir, { recursive: true });

  // Write the new example with metadata header
  const timestamp = Date.now();
  const filename = `${taskType}-${timestamp}.md`;
  const floorLabel = floorName ? ` | Floor: ${floorName}` : '';
  const header = `<!-- Gold Standard | Agent: ${agentId} | Task: ${taskType}${floorLabel} | Saved: ${new Date().toISOString()} -->\n\n`;
  await fsWriteFile(join(examplesDir, filename), header + output, 'utf-8');

  // Enforce cap — keep only MAX_EXAMPLES (5) most recent, delete oldest
  try {
    const files = (await fsReaddir(examplesDir)).filter(f => f.endsWith('.md'));
    if (files.length > MAX_EXAMPLES) {
      const withStats = await Promise.all(
        files.map(async f => {
          const s = await fsStat(join(examplesDir, f));
          return { file: f, mtime: s.mtime.getTime() };
        }),
      );
      withStats.sort((a, b) => b.mtime - a.mtime); // newest first
      const toDelete = withStats.slice(MAX_EXAMPLES);
      for (const entry of toDelete) {
        await unlink(join(examplesDir, entry.file));
      }
    }
  } catch {
    // Non-critical — cap enforcement failure doesn't block
  }

  console.log(`[GoldStandard] Saved example for ${agentId}/${taskType} in ${floorSlug}`);
}

/**
 * Format examples as XML for the system prompt.
 */
export function formatExamplesXml(examples: GoldStandardExample[]): string {
  if (examples.length === 0) return '';

  const inner = examples.map((ex, i) =>
    `<example index="${i + 1}" task_type="${ex.taskType}">\n${ex.content}\n</example>`
  ).join('\n\n');

  return `<examples>\n${inner}\n</examples>`;
}
