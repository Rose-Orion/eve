/**
 * Template Editor — safe, atomic modifications to agent prompt template JSON files.
 * EVE uses this to actually execute improvements (add rules, update expertise, etc).
 * Every write creates a backup and validates the result before saving.
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentId, AgentTemplate } from '../config/types.js';
import { clearTemplateCache } from './template-loader.js';

const TEMPLATES_DIR = join(import.meta.dirname, '../../prompt-templates');
const BACKUPS_DIR = join(process.cwd(), 'data', 'template-backups');

const MAX_APPEND_LENGTH = 500;

export type EditableField = 'rules' | 'expertise' | 'boundaries' | 'outputFormat' | 'role';
export type ToggleableFlag = 'antiSlopEnabled' | 'usesGeneratedKnowledge' | 'usesVoiceSample';

export interface TemplateEditResult {
  success: boolean;
  agentId: AgentId;
  field: string;
  diff: { before: string; after: string };
  backupPath: string;
  error?: string;
}

/** Read a template fresh from disk (bypassing cache). */
async function readTemplate(agentId: AgentId): Promise<AgentTemplate> {
  const filePath = join(TEMPLATES_DIR, `${agentId}.json`);
  const raw = await readFile(filePath, 'utf-8');
  return JSON.parse(raw) as AgentTemplate;
}

/** Create a timestamped backup before modifying a template. */
async function createBackup(agentId: AgentId): Promise<string> {
  await mkdir(BACKUPS_DIR, { recursive: true });
  const source = join(TEMPLATES_DIR, `${agentId}.json`);
  const raw = await readFile(source, 'utf-8');
  const backupPath = join(BACKUPS_DIR, `${agentId}.${Date.now()}.json`);
  await writeFile(backupPath, raw, 'utf-8');
  return backupPath;
}

/** Validate that the template still has the required shape. */
function validateTemplate(t: AgentTemplate): string | null {
  const required: (keyof AgentTemplate)[] = ['agentId', 'role', 'expertise', 'rules', 'boundaries', 'outputFormat', 'brandContextFields'];
  for (const key of required) {
    if (t[key] === undefined || t[key] === null) return `Missing required field: ${key}`;
  }
  if (typeof t.role !== 'string' || t.role.length < 10) return 'Role field too short or invalid';
  if (!Array.isArray(t.brandContextFields)) return 'brandContextFields must be an array';
  return null;
}

/** Save a validated template and clear the cache. */
async function saveTemplate(agentId: AgentId, template: AgentTemplate): Promise<void> {
  const filePath = join(TEMPLATES_DIR, `${agentId}.json`);
  await writeFile(filePath, JSON.stringify(template, null, 2) + '\n', 'utf-8');
  clearTemplateCache();
}

/** Append text to a template field (rules, expertise, boundaries, outputFormat, role). */
export async function appendToTemplateField(
  agentId: AgentId,
  field: EditableField,
  text: string,
): Promise<TemplateEditResult> {
  const backupPath = await createBackup(agentId);
  const template = await readTemplate(agentId);
  const before = template[field];

  // Safety: limit append size
  const safeText = text.slice(0, MAX_APPEND_LENGTH);

  // Size guard: don't let any field grow past 3000 chars
  if (before.length > 3000) {
    console.log(`[EVE] Field ${agentId}.${field} is already ${before.length} chars — skipping append`);
    return { success: true, agentId, field, diff: { before, after: before }, backupPath };
  }

  // Dedup guard: don't append if the first 60 chars of the text already exist in the field
  const fingerprint = safeText.slice(0, 60).toLowerCase();
  if (before.toLowerCase().includes(fingerprint)) {
    console.log(`[EVE] Skipping duplicate append to ${agentId}.${field}: "${fingerprint.slice(0, 40)}..."`);
    return { success: true, agentId, field, diff: { before, after: before }, backupPath };
  }

  template[field] = before + '\n' + safeText;

  const error = validateTemplate(template);
  if (error) {
    return { success: false, agentId, field, diff: { before, after: before }, backupPath, error };
  }

  await saveTemplate(agentId, template);
  console.log(`[EVE] Template updated: ${agentId}.${field} (+${safeText.length} chars)`);

  // Auto-consolidate if field is getting bloated (>2500 chars after append)
  if (template[field].length > 2500) {
    console.log(`[EVE] ${agentId}.${field} is ${template[field].length} chars — triggering consolidation`);
    consolidateTemplateRules(agentId, field).catch(err =>
      console.warn(`[EVE] Background consolidation failed: ${(err as Error).message}`)
    );
  }

  return { success: true, agentId, field, diff: { before, after: template[field] }, backupPath };
}

/** Replace a specific substring within a template field. */
export async function replaceInTemplateField(
  agentId: AgentId,
  field: EditableField,
  search: string,
  replacement: string,
): Promise<TemplateEditResult> {
  const backupPath = await createBackup(agentId);
  const template = await readTemplate(agentId);
  const before = template[field];

  if (!before.includes(search)) {
    return { success: false, agentId, field, diff: { before, after: before }, backupPath, error: `Search string not found in ${field}` };
  }

  // Safety: replacement can't be more than 500 chars longer than what it replaces
  if (replacement.length - search.length > MAX_APPEND_LENGTH) {
    return { success: false, agentId, field, diff: { before, after: before }, backupPath, error: 'Replacement too large' };
  }

  template[field] = before.replace(search, replacement);

  const error = validateTemplate(template);
  if (error) {
    return { success: false, agentId, field, diff: { before, after: before }, backupPath, error };
  }

  await saveTemplate(agentId, template);
  console.log(`[EVE] Template replaced: ${agentId}.${field} ("${search.slice(0, 30)}..." → "${replacement.slice(0, 30)}...")`);
  return { success: true, agentId, field, diff: { before, after: template[field] }, backupPath };
}

/** Add a brand context field to a template. */
export async function addBrandContextField(
  agentId: AgentId,
  fieldName: string,
): Promise<TemplateEditResult> {
  const backupPath = await createBackup(agentId);
  const template = await readTemplate(agentId);
  const before = JSON.stringify(template.brandContextFields);

  if (template.brandContextFields.includes(fieldName)) {
    return { success: true, agentId, field: 'brandContextFields', diff: { before, after: before }, backupPath };
  }

  template.brandContextFields.push(fieldName);
  await saveTemplate(agentId, template);
  console.log(`[EVE] Added brand context field "${fieldName}" to ${agentId}`);
  return { success: true, agentId, field: 'brandContextFields', diff: { before, after: JSON.stringify(template.brandContextFields) }, backupPath };
}

/** Toggle a boolean flag on a template. */
export async function setTemplateFlag(
  agentId: AgentId,
  flag: ToggleableFlag,
  value: boolean,
): Promise<TemplateEditResult> {
  const backupPath = await createBackup(agentId);
  const template = await readTemplate(agentId);
  const before = String(template[flag]);
  template[flag] = value;
  await saveTemplate(agentId, template);
  console.log(`[EVE] Template flag: ${agentId}.${flag} = ${value}`);
  return { success: true, agentId, field: flag, diff: { before, after: String(value) }, backupPath };
}

/** Rollback a template to a specific backup. */
export async function rollbackTemplate(
  agentId: AgentId,
  backupTimestamp: number,
): Promise<TemplateEditResult> {
  const backupPath = join(BACKUPS_DIR, `${agentId}.${backupTimestamp}.json`);
  const raw = await readFile(backupPath, 'utf-8');
  const template = JSON.parse(raw) as AgentTemplate;

  const error = validateTemplate(template);
  if (error) {
    return { success: false, agentId, field: 'all', diff: { before: '', after: '' }, backupPath, error };
  }

  // Backup current before rolling back
  const currentBackup = await createBackup(agentId);
  await saveTemplate(agentId, template);
  console.log(`[EVE] Template rolled back: ${agentId} → backup ${backupTimestamp}`);
  return { success: true, agentId, field: 'all', diff: { before: 'current', after: `backup-${backupTimestamp}` }, backupPath: currentBackup };
}

/** Consolidate bloated template rules using Claude Haiku (cheap). */
export async function consolidateTemplateRules(
  agentId: AgentId,
  field: EditableField = 'rules',
): Promise<TemplateEditResult> {
  const template = await readTemplate(agentId);
  const current = template[field];

  // Only consolidate if the field has grown past 2000 chars
  if (current.length < 2000) {
    return { success: true, agentId, field, diff: { before: current, after: current }, backupPath: '', error: 'Field too short to consolidate' };
  }

  const backupPath = await createBackup(agentId);

  try {
    const { callAnthropic } = await import('../clients/anthropic.js');
    const result = await callAnthropic(
      'You consolidate prompt template rules into concise, non-redundant sets. Merge similar rules, remove contradictions, keep the intent. Output ONLY the consolidated rules text, nothing else.',
      [{ role: 'user', content: `Consolidate these ${field} into a concise set (max 1500 chars):\n\n${current}` }],
      'haiku',
      2048,
    );

    const consolidated = result.content.slice(0, 1500);

    // Sanity check: consolidated should be shorter
    if (consolidated.length >= current.length) {
      console.log(`[EVE] Consolidation of ${agentId}.${field} produced no savings — skipping`);
      return { success: true, agentId, field, diff: { before: current, after: current }, backupPath };
    }

    template[field] = consolidated;
    const error = validateTemplate(template);
    if (error) {
      return { success: false, agentId, field, diff: { before: current, after: current }, backupPath, error };
    }

    await saveTemplate(agentId, template);
    console.log(`[EVE] Consolidated ${agentId}.${field}: ${current.length} → ${consolidated.length} chars (saved ${current.length - consolidated.length})`);
    return { success: true, agentId, field, diff: { before: current, after: consolidated }, backupPath };
  } catch (err) {
    console.warn(`[EVE] Consolidation failed for ${agentId}.${field}: ${(err as Error).message}`);
    return { success: false, agentId, field, diff: { before: current, after: current }, backupPath, error: (err as Error).message };
  }
}

/** List available backups for a template. */
export async function listBackups(agentId: AgentId): Promise<Array<{ timestamp: number; path: string }>> {
  try {
    await mkdir(BACKUPS_DIR, { recursive: true });
    const files = await readdir(BACKUPS_DIR);
    return files
      .filter(f => f.startsWith(`${agentId}.`) && f.endsWith('.json'))
      .map(f => {
        const ts = parseInt(f.replace(`${agentId}.`, '').replace('.json', ''), 10);
        return { timestamp: ts, path: join(BACKUPS_DIR, f) };
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return [];
  }
}
