/**
 * Knowledge Library loader — loads on-demand reference files for deep domain knowledge.
 * Located at ~/.openclaw/knowledge/ with categories:
 * business/, brand/, pricing/, marketing/, ecommerce/, playbooks/
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { countTokens, truncateToTokens } from './token-counter.js';

const KNOWLEDGE_DIR = join(process.env['HOME'] ?? '/Users/automation', '.openclaw', 'knowledge');
const MAX_FILES_PER_TASK = 2;
const MAX_TOKENS_PER_FILE = 2000;

export interface KnowledgeFile {
  category: string;
  name: string;
  content: string;
  tokenCount: number;
}

/**
 * Load specific knowledge files by path (e.g. "marketing/hook-formulas.md").
 */
export async function loadKnowledgeFiles(filePaths: string[]): Promise<KnowledgeFile[]> {
  const files: KnowledgeFile[] = [];
  const selected = filePaths.slice(0, MAX_FILES_PER_TASK);

  for (const relPath of selected) {
    const fullPath = join(KNOWLEDGE_DIR, relPath);
    try {
      let content = await readFile(fullPath, 'utf-8');
      let tokens = await countTokens(content);

      if (tokens > MAX_TOKENS_PER_FILE) {
        content = await truncateToTokens(content, MAX_TOKENS_PER_FILE);
        tokens = MAX_TOKENS_PER_FILE;
      }

      const parts = relPath.split('/');
      files.push({
        category: parts[0] ?? 'unknown',
        name: parts.slice(1).join('/') || relPath,
        content,
        tokenCount: tokens,
      });
    } catch {
      // File not found — skip silently
    }
  }

  return files;
}

/**
 * List available knowledge files by category.
 */
export async function listKnowledgeFiles(category?: string): Promise<string[]> {
  const searchDir = category ? join(KNOWLEDGE_DIR, category) : KNOWLEDGE_DIR;
  const results: string[] = [];

  try {
    const entries = await readdir(searchDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(category ? `${category}/${entry.name}` : entry.name);
      } else if (entry.isDirectory() && !category) {
        // Recurse one level into category dirs
        try {
          const subEntries = await readdir(join(searchDir, entry.name));
          for (const sub of subEntries) {
            if (sub.endsWith('.md')) {
              results.push(`${entry.name}/${sub}`);
            }
          }
        } catch { /* skip */ }
      }
    }
  } catch {
    // Knowledge directory doesn't exist yet
  }

  return results;
}

/**
 * Format knowledge files as XML for the system prompt.
 */
export function formatKnowledgeXml(files: KnowledgeFile[]): string {
  if (files.length === 0) return '';

  const inner = files.map(f =>
    `<knowledge_file category="${f.category}" name="${f.name}">\n${f.content}\n</knowledge_file>`
  ).join('\n\n');

  return `<knowledge>\n${inner}\n</knowledge>`;
}
