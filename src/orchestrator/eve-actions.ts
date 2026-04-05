/**
 * EVE Actions — executes concrete operations when EVE decides to fix something.
 * This is the bridge between EVE's analysis and actual system changes.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentId, Floor, Task } from '../config/types.js';
import type { TaskManager } from './task-manager.js';
import type { Workspace } from '../floors/workspace.js';
import type { EventBus } from './event-bus.js';
import type { ModelRouter } from '../agents/model-router.js';
import {
  appendToTemplateField,
  replaceInTemplateField,
  addBrandContextField,
  setTemplateFlag,
  type EditableField,
  type ToggleableFlag,
} from '../prompt-builder/template-editor.js';
import { listTemplates } from '../prompt-builder/template-loader.js';
import { saveFloor } from '../integrations/supabase.js';
import { send as sendNotification } from '../integrations/notifications.js';

/** Incremented every time apply_dashboard_patch succeeds. Exposed via /api/dashboard/version. */
let _dashboardVersion = 0;
export function getDashboardVersion() { return _dashboardVersion; }

/** Pending patches awaiting owner approval (dashboard + backend). */
interface PendingPatch {
  patchId: number;
  patches: Array<{ file: string; find: string; replace: string }>;
  rawMarkdown: string;
  floorId: string;
  issueDescription: string;
  createdAt: Date;
}
const _pendingDashboardPatches = new Map<string, PendingPatch>();
const _pendingBackendPatches = new Map<string, PendingPatch>();

/** Get all pending dashboard patches for review. */
export function getPendingDashboardPatches(): PendingPatch[] {
  return [..._pendingDashboardPatches.values()];
}

/** Get all pending backend patches for review. */
export function getPendingBackendPatches(): PendingPatch[] {
  return [..._pendingBackendPatches.values()];
}

/** Apply a pending dashboard patch after owner approval. */
export async function applyApprovedDashboardPatch(patchKey: string): Promise<{ applied: number; failed: number; error?: string }> {
  const pending = _pendingDashboardPatches.get(patchKey);
  if (!pending) return { applied: 0, failed: 0, error: 'Patch not found or already applied' };

  let applied = 0;
  let failed = 0;
  for (const patch of pending.patches) {
    const targetFile = patch.file.includes('styles') ? 'public/styles.css' : 'public/app.js';
    const filePath = join(process.cwd(), targetFile);
    try {
      const backupDir = join(process.cwd(), 'data', 'dashboard-backups');
      await mkdir(backupDir, { recursive: true });
      const current = await readFile(filePath, 'utf-8');
      await writeFile(join(backupDir, `${targetFile.replace(/\//g, '-')}.${pending.patchId}.bak`), current, 'utf-8');

      if (!current.includes(patch.find)) {
        failed++;
        console.log(`[Dashboard Patch] ✗ Search string not found in ${targetFile}`);
        continue;
      }
      await writeFile(filePath, current.replace(patch.find, patch.replace), 'utf-8');
      applied++;
      console.log(`[Dashboard Patch] ✓ Applied change ${applied} to ${targetFile}`);
    } catch (err) {
      failed++;
      console.log(`[Dashboard Patch] ✗ Error applying to ${targetFile}: ${(err as Error).message}`);
    }
  }

  if (applied > 0) _dashboardVersion++;
  _pendingDashboardPatches.delete(patchKey);
  console.log(`[Dashboard Patch] Owner approved patch ${pending.patchId}: ${applied} applied, ${failed} failed`);
  return { applied, failed };
}

/** Reject a pending dashboard patch. */
export function rejectDashboardPatch(patchKey: string): boolean {
  const deleted = _pendingDashboardPatches.delete(patchKey);
  if (deleted) console.log(`[Dashboard Patch] Owner rejected patch: ${patchKey}`);
  return deleted;
}

/** Apply a pending backend patch after owner approval — with TypeScript validation. */
export async function applyApprovedBackendPatch(patchKey: string): Promise<{ applied: number; failed: number; error?: string }> {
  const pending = _pendingBackendPatches.get(patchKey);
  if (!pending) return { applied: 0, failed: 0, error: 'Patch not found or already applied' };

  let applied = 0;
  let failed = 0;
  for (const patch of pending.patches) {
    const filePath = join(process.cwd(), patch.file);
    try {
      // Backup before editing
      const backupDir = join(process.cwd(), 'data', 'backend-backups');
      await mkdir(backupDir, { recursive: true });
      const current = await readFile(filePath, 'utf-8');
      const backupName = patch.file.replace(/\//g, '-').replace(/\./g, '-');
      await writeFile(join(backupDir, `${backupName}.${pending.patchId}.bak`), current, 'utf-8');

      if (!current.includes(patch.find)) {
        failed++;
        console.log(`[Backend Patch] ✗ Search string not found in ${patch.file}`);
        continue;
      }

      const updated = current.replace(patch.find, patch.replace);

      // TypeScript syntax validation: write to temp file and run tsc --noEmit
      const validated = await validateTypeScript(filePath, updated);
      if (!validated.ok) {
        failed++;
        console.log(`[Backend Patch] ✗ TypeScript validation failed for ${patch.file}: ${validated.error}`);
        continue;
      }

      await writeFile(filePath, updated, 'utf-8');
      applied++;
      console.log(`[Backend Patch] ✓ Applied change ${applied} to ${patch.file}`);
    } catch (err) {
      failed++;
      console.log(`[Backend Patch] ✗ Error applying to ${patch.file}: ${(err as Error).message}`);
    }
  }

  _pendingBackendPatches.delete(patchKey);
  console.log(`[Backend Patch] Owner approved patch ${pending.patchId}: ${applied} applied, ${failed} failed`);
  return { applied, failed };
}

/** Reject a pending backend patch. */
export function rejectBackendPatch(patchKey: string): boolean {
  const deleted = _pendingBackendPatches.delete(patchKey);
  if (deleted) console.log(`[Backend Patch] Owner rejected patch: ${patchKey}`);
  return deleted;
}

/** Validate TypeScript by writing patched content to a temp file and running tsc. */
async function validateTypeScript(filePath: string, content: string): Promise<{ ok: boolean; error?: string }> {
  const { execSync } = await import('node:child_process');
  const tmpPath = filePath + '.patch-check.ts';
  try {
    await writeFile(tmpPath, content, 'utf-8');
    execSync(`npx tsc --noEmit --pretty false "${tmpPath}" 2>&1`, {
      cwd: process.cwd(),
      timeout: 30000,
      encoding: 'utf-8',
    });
    return { ok: true };
  } catch (err) {
    const msg = (err as { stdout?: string; message?: string }).stdout || (err as Error).message || 'Unknown error';
    // Only fail on real errors in the patched file, not unrelated noise
    const relevantErrors = msg.split('\n').filter((l: string) => l.includes('.patch-check.ts'));
    if (relevantErrors.length === 0) {
      // No errors in our file — tsc may have failed on other files
      return { ok: true };
    }
    return { ok: false, error: relevantErrors.slice(0, 3).join('; ') };
  } finally {
    try { const { unlinkSync } = await import('node:fs'); unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

/** Rate-limit backend agent dispatches: max 1 per 30 minutes per issue topic. */
const _backendAgentCooldowns = new Map<string, number>();
const BACKEND_AGENT_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours — prevents FM feedback loops from flooding dispatches

export interface EVEOperation {
  type: string;
  agentId?: string;
  field?: string;
  action?: string;
  text?: string;
  search?: string;
  taskType?: string;
  note?: string;
  correction?: string;
  newAgent?: string;
  changes?: Record<string, unknown>;
  learning?: string;
  affectedAgents?: string[] | 'all';
  flag?: string;
  value?: boolean;
  fieldName?: string;
  file?: string;
  replacement?: string;
}

export interface OperationResult {
  success: boolean;
  type: string;
  details: string;
}

export interface ExecutionContext {
  floor: Floor;
  taskManager: TaskManager;
  workspace: Workspace;
  eventBus: EventBus;
  modelRouter: ModelRouter;
}

/**
 * Parse FIND/REPLACE code blocks from dashboard-agent patch markdown.
 * Looks for paired ```...``` blocks under "Find:" and "Replace with:" headings.
 */
function parsePatchMarkdown(md: string): Array<{ file: 'app' | 'styles'; find: string; replace: string }> {
  const patches: Array<{ file: 'app' | 'styles'; find: string; replace: string }> = [];

  // Split by change sections (### Change N)
  const sections = md.split(/###\s+Change\s+\d+/i);

  for (const section of sections) {
    // Determine target file — handles **File:**, File:, *File:*, **File:** etc.
    const fileMatch = section.match(/\*?\*?File:?\*?\*?:?\s*`?public\/(app\.js|styles\.css)`?/i);
    const file: 'app' | 'styles' = fileMatch?.[1]?.includes('styles') ? 'styles' : 'app';

    // Extract Find and Replace code blocks
    // Handles: Find:, **Find:**, **Find:***, FIND:, etc. + Replace with:, **Replace with:**
    const findReplacePattern = /\*?\*?Find:?\*?\*?:?\s*\n```[^\n]*\n([\s\S]*?)```[\s\S]*?\*?\*?Replace[^:\n]*:?\*?\*?:?\s*\n```[^\n]*\n([\s\S]*?)```/i;
    const match = section.match(findReplacePattern);

    if (match) {
      const find = match[1]!.trimEnd();
      const replace = match[2]!.trimEnd();
      // Skip if find === replace (no-op)
      if (find !== replace) {
        patches.push({ file, find, replace });
      }
    } else if (section.match(/\*?\*?Find:?\*?\*?:?\s*\n```/i)) {
      // Has a Find block but no complete Replace — likely truncated output
      console.warn(`[Dashboard Agent] Patch section truncated — agent output exceeded max_tokens. Skipping this change.`);
    }
  }

  return patches;
}

/**
 * Parse FIND/REPLACE code blocks from backend-agent patch markdown.
 * Similar to parsePatchMarkdown but handles src/ file paths.
 */
function parseBackendPatchMarkdown(md: string): Array<{ file: string; find: string; replace: string }> {
  const patches: Array<{ file: string; find: string; replace: string }> = [];
  const ALLOWED_PREFIXES = ['src/server/', 'src/orchestrator/', 'src/integrations/', 'src/floors/', 'src/agents/', 'src/prompt-builder/', 'src/config/'];

  const sections = md.split(/###\s+Change\s+\d+/i);

  for (const section of sections) {
    // Extract file path — handles: File: `src/path/file.ts`, **File:** `src/path/file.ts`
    const fileMatch = section.match(/\*?\*?File:?\*?\*?:?\s*`?(src\/[^`\s]+\.ts)`?/i);
    if (!fileMatch) continue;
    const file = fileMatch[1]!;

    // Security: only allow patching approved directories
    if (!ALLOWED_PREFIXES.some(p => file.startsWith(p))) continue;

    const findReplacePattern = /\*?\*?Find:?\*?\*?:?\s*\n```[^\n]*\n([\s\S]*?)```[\s\S]*?\*?\*?Replace[^:\n]*:?\*?\*?:?\s*\n```[^\n]*\n([\s\S]*?)```/i;
    const match = section.match(findReplacePattern);

    if (match) {
      const find = match[1]!.trimEnd();
      const replace = match[2]!.trimEnd();
      if (find !== replace) {
        patches.push({ file, find, replace });
      }
    }
  }

  return patches;
}

export async function executeOperation(
  op: EVEOperation,
  ctx: ExecutionContext,
): Promise<OperationResult> {
  try {
    switch (op.type) {
      case 'update_prompt_template': {
        const agentId = op.agentId as AgentId;
        const field = op.field as EditableField;
        if (!agentId || !field || !op.text) {
          return { success: false, type: op.type, details: 'Missing agentId, field, or text' };
        }
        let result;
        if (op.action === 'replace' && op.search) {
          result = await replaceInTemplateField(agentId, field, op.search, op.text);
        } else {
          result = await appendToTemplateField(agentId, field, op.text);
        }
        // Don't emit feedback:applied here — that would create an execution loop
        return { success: result.success, type: op.type, details: result.error || `Updated ${agentId}.${field} (+${op.text.length} chars)` };
      }

      case 'add_brand_context_field': {
        const agentId = op.agentId as AgentId;
        if (!agentId || !op.fieldName) {
          return { success: false, type: op.type, details: 'Missing agentId or fieldName' };
        }
        const result = await addBrandContextField(agentId, op.fieldName);
        return { success: result.success, type: op.type, details: result.error || `Added "${op.fieldName}" to ${agentId} brand context` };
      }

      case 'set_template_flag': {
        const agentId = op.agentId as AgentId;
        if (!agentId || !op.flag || op.value === undefined) {
          return { success: false, type: op.type, details: 'Missing agentId, flag, or value' };
        }
        const result = await setTemplateFlag(agentId, op.flag as ToggleableFlag, op.value);
        return { success: result.success, type: op.type, details: result.error || `Set ${agentId}.${op.flag} = ${op.value}` };
      }

      case 'requeue_task': {
        if (!op.taskType) {
          return { success: false, type: op.type, details: 'Missing taskType' };
        }
        const existing = ctx.taskManager.getFloorTasks(ctx.floor.id).find(t => t.taskType === op.taskType);
        if (!existing) {
          return { success: false, type: op.type, details: `Task ${op.taskType} not found` };
        }
        const enhancedDesc = op.note
          ? `${existing.description}\n\n[EVE improvement note]: ${op.note}`
          : existing.description;
        ctx.taskManager.create({
          floorId: ctx.floor.id,
          phaseNumber: existing.phaseNumber,
          assignedAgent: existing.assignedAgent,
          modelTier: existing.modelTier,
          taskType: existing.taskType + '-redo',
          description: enhancedDesc,
          prompt: existing.prompt,
          inputFiles: existing.inputFiles,
          outputFiles: existing.outputFiles,
          dependsOn: [],
          priority: 'high',
          estimatedCostCents: existing.estimatedCostCents,
        });
        return { success: true, type: op.type, details: `Requeued ${op.taskType} with improvements` };
      }

      case 'update_prompt_note': {
        let currentState: Record<string, unknown> = {};
        try { currentState = JSON.parse(ctx.floor.brandState as unknown as string || '{}'); } catch { currentState = {}; }
        if (!(currentState as any).eveNotes) (currentState as any).eveNotes = [];
        ((currentState as any).eveNotes as unknown[]).push({
          agent: op.agentId || 'all',
          note: op.note || op.text || '',
          addedAt: new Date().toISOString(),
        });
        ctx.floor.brandState = JSON.stringify(currentState) as any;
        await saveFloor(ctx.floor);
        return { success: true, type: op.type, details: `Added prompt note for ${op.agentId || 'all'}` };
      }

      case 'update_floor_config': {
        if (!op.changes) {
          return { success: false, type: op.type, details: 'Missing changes' };
        }
        if (op.changes.name && typeof op.changes.name === 'string') {
          ctx.floor.name = op.changes.name;
        }
        if (op.changes.goal && typeof op.changes.goal === 'string') {
          ctx.floor.goal = op.changes.goal;
        }
        if (op.changes.budgetCeilingCents && typeof op.changes.budgetCeilingCents === 'number') {
          // Cap: can only increase by max 20%
          const max = Math.round(ctx.floor.budgetCeilingCents * 1.2);
          ctx.floor.budgetCeilingCents = Math.min(op.changes.budgetCeilingCents as number, max);
        }
        await saveFloor(ctx.floor);
        return { success: true, type: op.type, details: `Updated floor config: ${Object.keys(op.changes).join(', ')}` };
      }

      case 'apply_system_learning': {
        if (!op.learning || !op.field) {
          return { success: false, type: op.type, details: 'Missing learning or field' };
        }
        const targets = op.affectedAgents === 'all'
          ? await listTemplates()
          : (op.affectedAgents || []) as AgentId[];

        let applied = 0;
        for (const agentId of targets) {
          try {
            const result = await appendToTemplateField(agentId, op.field as EditableField, op.learning);
            if (result.success) applied++;
          } catch { /* skip agents where it fails */ }
        }
        return { success: applied > 0, type: op.type, details: `Applied learning to ${applied}/${targets.length} agents` };
      }

      case 'notify_owner': {
        sendNotification({
          title: `EVE Update: ${ctx.floor.name}`,
          body: op.note || op.text || 'EVE has an update for you.',
          floorId: ctx.floor.id,
          type: 'info',
        });
        return { success: true, type: op.type, details: `Notified owner` };
      }

      case 'dispatch_dashboard_agent': {
        if (!op.text) {
          return { success: false, type: op.type, details: 'Missing issue description' };
        }

        try {
          const appJsPath = join(process.cwd(), 'public/app.js');
          const cssPath = join(process.cwd(), 'public/styles.css');
          const appJs = await readFile(appJsPath, 'utf-8');
          const stylesCss = await readFile(cssPath, 'utf-8');

          // Load dashboard-agent template
          const templatePath = join(process.cwd(), 'prompt-templates/dashboard-agent.json');
          const template = JSON.parse(await readFile(templatePath, 'utf-8'));

          const { callAnthropic } = await import('../clients/anthropic.js');
          const systemPrompt = `${template.role}\n\nEXPERTISE:\n${template.expertise}\n\nRULES:\n${template.rules}\n\nBOUNDARIES:\n${template.boundaries}\n\nOUTPUT FORMAT:\n${template.outputFormat}`;

          const result = await callAnthropic(
            systemPrompt,
            [{ role: 'user', content: `Issue reported by the owner:\n${op.text}\n\n--- Current public/app.js ---\n${appJs}\n\n--- Current public/styles.css ---\n${stylesCss}` }],
            'sonnet',
            8192,
          );

          // Store the patch as a file for audit trail
          const patchDir = join(process.cwd(), 'data', 'dashboard-patches');
          await mkdir(patchDir, { recursive: true });
          const patchId = Date.now();
          await writeFile(join(patchDir, `patch-${patchId}.md`), result.content, 'utf-8');
          console.log(`[Dashboard Agent] Generated patch ${patchId} for: ${op.text.slice(0, 80)}`);

          // Store patch as PROPOSAL — never auto-apply dashboard patches.
          // Owner must review the diff and explicitly approve before changes go live.
          const patches = parsePatchMarkdown(result.content);

          _pendingDashboardPatches.set(`dashboard-patch-${patchId}`, {
            patchId,
            patches,
            rawMarkdown: result.content,
            floorId: ctx.floor.id,
            issueDescription: op.text,
            createdAt: new Date(),
          });

          ctx.eventBus.emit('approval:needed', {
            floorId: ctx.floor.id,
            taskId: `dashboard-patch-${patchId}`,
            type: 'dashboard-patch',
            summary: patches.length === 0
              ? `Dashboard Agent generated a response but no patches extracted. Review patch-${patchId}.md`
              : `Dashboard Agent proposed ${patches.length} change${patches.length > 1 ? 's' : ''}: ${op.text.slice(0, 100)}`,
          });

          console.log(`[Dashboard Agent] Patch ${patchId} stored as proposal (${patches.length} changes). Awaiting owner approval.`);

          sendNotification({
            title: 'Dashboard Patch Ready',
            body: `Review ${patches.length} proposed change${patches.length > 1 ? 's' : ''} before applying.`,
            floorId: ctx.floor.id,
            type: 'info',
          });

          return {
            success: true,
            type: op.type,
            details: `Dashboard agent generated patch-${patchId} with ${patches.length} changes. Awaiting owner approval.`,
          };
        } catch (err) {
          return { success: false, type: op.type, details: `Dashboard agent error: ${(err as Error).message}` };
        }
      }

      case 'apply_dashboard_patch': {
        const targetFile = op.file === 'styles' ? 'public/styles.css' : 'public/app.js';
        const filePath = join(process.cwd(), targetFile);

        if (!op.search || !op.replacement) {
          return { success: false, type: op.type, details: 'Missing search or replacement' };
        }

        try {
          // Backup before editing
          const backupDir = join(process.cwd(), 'data', 'dashboard-backups');
          await mkdir(backupDir, { recursive: true });
          const current = await readFile(filePath, 'utf-8');
          const backupName = targetFile.replace('/', '-').replace('.', '-');
          await writeFile(join(backupDir, `${backupName}.${Date.now()}.bak`), current, 'utf-8');

          if (!current.includes(op.search)) {
            return { success: false, type: op.type, details: `Search string not found in ${targetFile}` };
          }

          const updated = current.replace(op.search, op.replacement);
          await writeFile(filePath, updated, 'utf-8');
          _dashboardVersion++;
          console.log(`[Dashboard Agent] Patched ${targetFile} (version ${_dashboardVersion})`);
          return { success: true, type: op.type, details: `Patched ${targetFile}` };
        } catch (err) {
          return { success: false, type: op.type, details: `Patch failed: ${(err as Error).message}` };
        }
      }

      case 'dispatch_backend_agent': {
        if (!op.text) {
          return { success: false, type: op.type, details: 'Missing issue description' };
        }

        // Rate-limit: use keyword-based topic detection to catch rephrased duplicates.
        // Extract top keywords and sort them to create a stable topic fingerprint.
        const issueWords = op.text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
          .filter(w => w.length > 3)
          .sort();
        // Use the 5 most common significant words as the topic key
        const wordFreq = new Map<string, number>();
        for (const w of issueWords) wordFreq.set(w, (wordFreq.get(w) || 0) + 1);
        const topWords = [...wordFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w);
        const topicKey = topWords.join('-') || op.text.slice(0, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-');

        // Check ALL existing cooldown keys for overlap (not just exact match)
        let rateLimited = false;
        for (const [existingKey, ts] of _backendAgentCooldowns.entries()) {
          if (Date.now() - ts >= BACKEND_AGENT_COOLDOWN_MS) continue;
          // Check if >50% of top words overlap with an existing cooldown
          const existingWords = new Set(existingKey.split('-'));
          const overlap = topWords.filter(w => existingWords.has(w)).length;
          if (overlap >= Math.ceil(topWords.length * 0.5)) {
            const minsLeft = Math.ceil((BACKEND_AGENT_COOLDOWN_MS - (Date.now() - ts)) / 60000);
            console.log(`[Backend Agent] RATE LIMITED: "${topicKey}" overlaps with "${existingKey}" — ${minsLeft}m cooldown remaining`);
            rateLimited = true;
            break;
          }
        }
        if (rateLimited) {
          return { success: false, type: op.type, details: `Rate limited — backend agent dispatched for similar issue recently.` };
        }
        _backendAgentCooldowns.set(topicKey, Date.now());

        try {
          // Determine relevant source files based on the issue description
          const keywords = op.text.toLowerCase();
          const filesToRead: string[] = [];

          // Always include the main orchestrator and types
          filesToRead.push('src/orchestrator/index.ts', 'src/config/types.ts');

          // Add contextual files based on keywords
          if (keywords.includes('route') || keywords.includes('api') || keywords.includes('endpoint'))
            filesToRead.push('src/server/routes/floors.ts', 'src/server/routes/feedback.ts', 'src/server/index.ts');
          if (keywords.includes('task') || keywords.includes('dispatch') || keywords.includes('queue'))
            filesToRead.push('src/orchestrator/task-manager.ts', 'src/orchestrator/virtual-dispatcher.ts');
          if (keywords.includes('phase') || keywords.includes('gate') || keywords.includes('approval'))
            filesToRead.push('src/orchestrator/phase-manager.ts');
          if (keywords.includes('brand') || keywords.includes('prompt') || keywords.includes('template'))
            filesToRead.push('src/prompt-builder/index.ts', 'src/prompt-builder/template-loader.ts');
          if (keywords.includes('event') || keywords.includes('broadcast') || keywords.includes('realtime'))
            filesToRead.push('src/orchestrator/event-bus.ts');
          if (keywords.includes('save') || keywords.includes('persist') || keywords.includes('database') || keywords.includes('supabase'))
            filesToRead.push('src/integrations/supabase.ts');
          if (keywords.includes('floor') || keywords.includes('creat'))
            filesToRead.push('src/floors/creator.ts', 'src/floors/lifecycle.ts');

          // Read the files (deduplicated, max 6)
          const uniqueFiles = [...new Set(filesToRead)].slice(0, 6);
          const fileContents: string[] = [];
          for (const f of uniqueFiles) {
            try {
              const content = await readFile(join(process.cwd(), f), 'utf-8');
              fileContents.push(`--- ${f} ---\n${content}`);
            } catch { /* file may not exist */ }
          }

          // Load backend-agent template
          const templatePath = join(process.cwd(), 'prompt-templates/backend-agent.json');
          const template = JSON.parse(await readFile(templatePath, 'utf-8'));

          const { callAnthropic } = await import('../clients/anthropic.js');
          const systemPrompt = `${template.role}\n\nEXPERTISE:\n${template.expertise}\n\nRULES:\n${template.rules}\n\nBOUNDARIES:\n${template.boundaries}\n\nOUTPUT FORMAT:\n${template.outputFormat}`;

          const result = await callAnthropic(
            systemPrompt,
            [{ role: 'user', content: `Issue reported:\n${op.text}\n\n${fileContents.join('\n\n')}` }],
            'sonnet',
            8192,
          );

          // Store the patch for audit trail
          const patchDir = join(process.cwd(), 'data', 'backend-patches');
          await mkdir(patchDir, { recursive: true });
          const patchId = Date.now();
          await writeFile(join(patchDir, `patch-${patchId}.md`), result.content, 'utf-8');
          console.log(`[Backend Agent] Generated patch ${patchId} for: ${op.text.slice(0, 80)}`);

          // NEVER auto-apply backend patches. Store as proposals for owner review.
          // This matches the dashboard-agent pattern: propose → review → approve.
          const BLOCKED_PATTERNS = [
            'improvementEngine.submitAgentFeedback',
            'broadcastWithRetry',
            'verifySubscriberRegistration',
            'subscriber-registration-probe',
          ];

          const patches = parseBackendPatchMarkdown(result.content);

          // Filter out patches with forbidden patterns before storing
          const safePatchList = patches.filter(patch => {
            const blocked = BLOCKED_PATTERNS.some(p => patch.replace.includes(p));
            if (blocked) {
              console.warn(`[Backend Agent] ✗ Filtered out patch to ${patch.file} — contains forbidden pattern`);
              return false;
            }
            return true;
          });

          // Store as proposal — owner must approve before anything is applied
          const patchKeyName = `backend-patch-${patchId}`;
          _pendingBackendPatches.set(patchKeyName, {
            patchId,
            patches: safePatchList,
            rawMarkdown: result.content,
            floorId: ctx.floor.id,
            issueDescription: op.text,
            createdAt: new Date(),
          });

          ctx.eventBus.emit('approval:needed', {
            floorId: ctx.floor.id,
            taskId: patchKeyName,
            type: 'backend-patch',
            summary: safePatchList.length === 0
              ? `Backend Agent generated a response but no valid patches extracted. Review data/backend-patches/patch-${patchId}.md`
              : `Backend Agent proposed ${safePatchList.length} code change${safePatchList.length > 1 ? 's' : ''}: ${op.text.slice(0, 100)}`,
          });

          console.log(`[Backend Agent] Patch ${patchId} stored as proposal (${safePatchList.length} changes). Awaiting owner approval.`);

          sendNotification({
            title: 'Backend Patch Ready for Review',
            body: `Review ${safePatchList.length} proposed code change${safePatchList.length > 1 ? 's' : ''} before applying. Patches will be TypeScript-validated on approval.`,
            floorId: ctx.floor.id,
            type: 'info',
          });

          return {
            success: true,
            type: op.type,
            details: `Backend agent generated patch-${patchId} with ${safePatchList.length} changes. Awaiting owner approval.`,
          };
        } catch (err) {
          return { success: false, type: op.type, details: `Backend agent error: ${(err as Error).message}` };
        }
      }

      case 'no_op':
        return { success: true, type: op.type, details: 'No action needed' };

      default:
        return { success: false, type: op.type, details: `Unknown operation type: ${op.type}` };
    }
  } catch (err) {
    return { success: false, type: op.type, details: `Error: ${(err as Error).message}` };
  }
}

/** The system prompt fragment that tells Claude what operations are available. */
export const AVAILABLE_OPERATIONS = `Available operations (return as JSON array):

1. update_prompt_template — Modify an agent's prompt template file. This ACTUALLY changes how the agent behaves.
   { "type": "update_prompt_template", "agentId": "copy-agent", "field": "rules", "action": "append", "text": "NEW RULE: Always include brand voice examples..." }
   Fields: "rules", "expertise", "boundaries", "outputFormat", "role"
   Actions: "append" (add to end) or "replace" (requires "search" field with text to find)

2. requeue_task — Re-run a task with improvement notes.
   { "type": "requeue_task", "taskType": "brand-voice-guide", "note": "Include 3 concrete tone examples" }

3. update_prompt_note — Add a note to the floor's brand state (loaded into future prompts).
   { "type": "update_prompt_note", "agentId": "copy-agent", "note": "Prioritize conversational tone over formal" }

4. update_floor_config — Update floor-level settings (name, goal, budget).
   { "type": "update_floor_config", "changes": { "name": "New Brand Name", "goal": "Updated goal" } }

5. apply_system_learning — Apply a rule to ALL agent templates (system-wide improvement).
   { "type": "apply_system_learning", "field": "rules", "learning": "Always verify brand voice match before submitting", "affectedAgents": "all" }
   Or target specific agents: "affectedAgents": ["copy-agent", "social-media-agent"]

6. notify_owner — Send a notification to the owner.
   { "type": "notify_owner", "note": "EVE detected and fixed a copy-agent brief issue" }

7. dispatch_dashboard_agent — Route a UI/dashboard issue to the Dashboard Agent for diagnosis and patch generation.
   { "type": "dispatch_dashboard_agent", "text": "Review button on content production routes to brand info instead of content review" }
   Use this for: routing bugs, display issues, wrong screens, broken layouts, missing UI elements, UX improvements.

8. apply_dashboard_patch — Apply a specific find-and-replace patch to a dashboard file (requires prior approval).
   { "type": "apply_dashboard_patch", "file": "app" | "styles", "search": "old code", "replacement": "new code" }

9. dispatch_backend_agent — Route a backend/data/API issue to the Backend Agent for diagnosis and patch generation.
   { "type": "dispatch_backend_agent", "text": "Brand selection not saving to database after approval" }
   Use this for: data not persisting, API errors, broken server logic, event broadcasting failures, task lifecycle bugs, database sync issues.

10. no_op — No action needed.
   { "type": "no_op" }

IMPORTANT: For agent/prompt issues, use update_prompt_template. For UI/dashboard issues, use dispatch_dashboard_agent. For backend/data/API issues, use dispatch_backend_agent.
Return an array of operations to execute in sequence, e.g.: [{ "type": "update_prompt_template", ... }, { "type": "notify_owner", ... }]`;
