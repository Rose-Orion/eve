/**
 * Supabase client — database persistence and realtime.
 *
 * Tables (from supplementary spec):
 * - floors, agents, phases
 * - tasks, cost_events, agent_performance
 * - content_queue, content_performance
 * - products, orders
 * - ad_campaigns, ad_daily_performance
 * - improvement_proposals, preference_patterns, playbook_entries, ab_tests
 * - approval_queue, notifications
 * - email_subscribers
 * - command_log, security_events
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from '../config/index.js';
import type { Floor, Task } from '../config/types.js';

let client: SupabaseClient | null = null;
let hasExtendedColumns = true; // optimistic — set false on first schema error
let hasTaskPromptColumn = true; // optimistic — set false if tasks.prompt column missing

/**
 * Retry wrapper for Supabase operations. Retries transient failures with exponential backoff.
 * Use instead of .catch(() => {}) for critical persistence operations.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = 3,
): Promise<T | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = (err as Error).message;
      if (attempt < maxRetries) {
        const delay = attempt * 1000; // 1s, 2s, 3s
        console.warn(`[Supabase] ${label} attempt ${attempt}/${maxRetries} failed: ${msg}. Retrying in ${delay}ms.`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        console.error(`[Supabase] ${label} FAILED after ${maxRetries} attempts: ${msg}`);
      }
    }
  }
  return null;
}

/**
 * Persist with retry — fire-and-forget but with retries and error logging.
 * Drop-in replacement for `.catch(() => {})` pattern.
 */
export function persistWithRetry(fn: () => Promise<boolean>, label: string): void {
  withRetry(async () => {
    const ok = await fn();
    if (!ok) throw new Error('returned false');
    return ok;
  }, label, 3).catch(() => {
    // Final fallback — already logged by withRetry
  });
}

export function getSupabase(): SupabaseClient | null {
  if (client) return client;
  const config = getConfig();
  if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) return null;
  client = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  return client;
}

export async function checkConnection(): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { error } = await sb.from('floors').select('id').limit(1);
    if (error) return false;
    // Detect if extended columns exist
    const { data: colCheck, error: colError } = await sb
      .from('floors')
      .select('id, selected_brand, theme_config, growth_cycle')
      .limit(1);
    if (colCheck === null || colError) {
      hasExtendedColumns = false;
      console.log('[Supabase] Note: floors table missing extended columns (selected_brand/theme_config/growth_cycle) — data stored in-memory only.');
    }
    // Detect if tasks.prompt column exists — auto-create if missing
    const { error: promptColErr } = await sb
      .from('tasks')
      .select('prompt')
      .limit(1);
    if (promptColErr) {
      console.log('[Supabase] tasks.prompt column missing — attempting auto-migration...');
      const { error: migErr } = await sb.rpc('exec_sql', {
        query: 'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS prompt text;'
      });
      if (migErr) {
        // RPC may not exist — try via raw insert trick (insert+rollback won't work, so just flag)
        hasTaskPromptColumn = false;
        console.warn('[Supabase] Auto-migration failed:', migErr.message);
        console.warn('[Supabase] ⚠️  CRITICAL: Run this SQL in Supabase Dashboard → SQL Editor:');
        console.warn('[Supabase]   ALTER TABLE tasks ADD COLUMN IF NOT EXISTS prompt text;');
        console.warn('[Supabase]   ALTER TABLE tasks ADD COLUMN IF NOT EXISTS output_files text[];');
        console.warn('[Supabase] Without this, task prompts are lost on restart and agents get empty instructions.');
      } else {
        console.log('[Supabase] ✅ Auto-migrated: tasks.prompt column created.');
        hasTaskPromptColumn = true;
      }
    }
    return true;
  } catch { return false; }
}

/** Returns true if task prompts are being persisted to DB. */
export function isPromptPersisted(): boolean {
  return hasTaskPromptColumn;
}

// --- Floor Persistence ---

export async function saveFloor(floor: Floor): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) {
    console.warn('[Supabase] saveFloor: client is null — skipping persist for', floor.name);
    return false;
  }

  // Defensive: ensure createdAt is a Date (may be a string after JSON round-trip)
  const createdAtDate = floor.createdAt instanceof Date
    ? floor.createdAt
    : new Date(floor.createdAt as unknown as string);

  const basePayload: Record<string, unknown> = {
    id: floor.id,
    name: floor.name,
    slug: floor.slug,
    goal: floor.goal,
    status: floor.status,
    brand_state: floor.brandState,
    budget_ceiling_cents: Math.round(floor.budgetCeilingCents),
    spent_cents: Math.round(floor.spentCents ?? 0),
    current_phase: floor.currentPhase,
    config: floor.config,
    created_at: createdAtDate.toISOString(),
  };

  console.log(`[Supabase] saveFloor: attempting upsert for "${floor.name}" (${floor.id.slice(0, 8)}) phase=${floor.currentPhase} status=${floor.status}`);

  // Include extended columns only if they exist in the schema
  if (hasExtendedColumns) {
    basePayload.selected_brand = floor.selectedBrand ?? null;
    basePayload.theme_config = floor.themeConfig ?? null;
    basePayload.growth_cycle = floor.growthCycle ?? 0;
  }

  const { error } = await sb.from('floors').upsert(basePayload);

  if (!error) {
    console.log(`[Supabase] saveFloor: SUCCESS for "${floor.name}" (${floor.id.slice(0, 8)})`);
  }

  if (error) {
    // Detect missing column errors and retry without extended columns
    if (error.message.includes('selected_brand') || error.message.includes('theme_config') || error.message.includes('growth_cycle')) {
      if (hasExtendedColumns) {
        hasExtendedColumns = false;
        console.warn('[Supabase] Extended columns not found — saving without selected_brand/theme_config/growth_cycle. Run migration to add them.');
        // Retry without extended columns
        delete basePayload.selected_brand;
        delete basePayload.theme_config;
        delete basePayload.growth_cycle;
        const retry = await sb.from('floors').upsert(basePayload);
        if (retry.error) console.warn('[Supabase] saveFloor retry error:', retry.error.message);
        return !retry.error;
      }
    }
    console.warn('[Supabase] saveFloor error:', error.message);
  }
  return !error;
}

export async function deleteFloor(floorId: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  // Delete in dependency order: tasks → phases → floor
  await sb.from('tasks').delete().eq('floor_id', floorId);
  await sb.from('phases').delete().eq('floor_id', floorId);
  const { error } = await sb.from('floors').delete().eq('id', floorId);
  return !error;
}

/** Soft-delete: mark floor as archived instead of destroying data.
 *  Also renames the slug to free it up for reuse (floors_slug_key unique constraint). */
export async function archiveFloor(floorId: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('floors').update({
    status: 'archived',
    slug: `archived-${floorId.slice(0, 8)}-${Date.now()}`,
    archived_at: new Date().toISOString(),
  }).eq('id', floorId);
  if (error) {
    // Fallback: if archived_at column doesn't exist, just set status + slug rename
    const { error: e2 } = await sb.from('floors').update({
      status: 'archived',
      slug: `archived-${floorId.slice(0, 8)}-${Date.now()}`,
    }).eq('id', floorId);
    return !e2;
  }
  return true;
}

export async function loadFloors(): Promise<Floor[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.from('floors').select('*').neq('status', 'archived');
  if (error || !data) {
    if (error) console.warn('[Supabase] loadFloors error:', error.message);
    return [];
  }
  return data.map((row: Record<string, unknown>) => {
    const rawCeiling = row['budget_ceiling_cents'];
    // Defensively coerce — the column is INTEGER in Postgres but Supabase JS
    // client could theoretically return a string if the column type changed.
    const budgetCeilingCents: number = typeof rawCeiling === 'number'
      ? rawCeiling
      : typeof rawCeiling === 'string'
        ? parseInt(rawCeiling, 10) || 0
        : 0;

    if (budgetCeilingCents === 0 && rawCeiling !== 0) {
      console.warn(
        `[loadFloors] budget_ceiling_cents could not be parsed for floor "${row['name'] as string}": ` +
        `raw value = ${JSON.stringify(rawCeiling)} (type: ${typeof rawCeiling})`
      );
    }

    return {
      id: row['id'] as string,
      name: row['name'] as string,
      slug: row['slug'] as string,
      goal: (row['goal'] as string) ?? '',
      status: (row['status'] as Floor['status']) ?? 'planning',
      brandState: (row['brand_state'] as Floor['brandState']) ?? 'pre-foundation',
      selectedBrand: (row['selected_brand'] as Floor['selectedBrand']) ?? null,
      themeConfig: (row['theme_config'] as Floor['themeConfig']) ?? null,
      budgetCeilingCents,
      spentCents: (row['spent_cents'] as number) ?? 0,
      currentPhase: (row['current_phase'] as number) ?? 1,
      growthCycle: (row['growth_cycle'] as number) ?? 0,
      config: (row['config'] as Floor['config']) ?? {
        businessType: 'ecommerce',
        activeAgents: [],
        modelRouting: {},
      },
      createdAt: new Date(row['created_at'] as string),
    };
  });
}

// --- Phase Persistence ---

export interface PhaseRecord {
  id?: string;
  floorId: string;
  phaseNumber: number;
  name: string;
  status: 'pending' | 'active' | 'gate-waiting' | 'completed' | 'skipped';
  startedAt?: Date | null;
  completedAt?: Date | null;
  gateApproved?: boolean;
  gateApprovedAt?: Date | null;
}

export async function savePhase(phase: PhaseRecord): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;

  const payload = {
    name: phase.name,
    status: phase.status,
    started_at: phase.startedAt?.toISOString() ?? null,
    completed_at: phase.completedAt?.toISOString() ?? null,
    gate_approved: phase.gateApproved ?? false,
    gate_approved_at: phase.gateApprovedAt?.toISOString() ?? null,
  };

  // Try update first (row likely already exists)
  const { data: existing } = await sb.from('phases')
    .select('id')
    .eq('floor_id', phase.floorId)
    .eq('phase_number', phase.phaseNumber)
    .maybeSingle();

  if (existing) {
    const { error } = await sb.from('phases').update(payload).eq('id', existing.id);
    if (error) console.warn('[Supabase] savePhase update error:', error.message);
    return !error;
  } else {
    const { error } = await sb.from('phases').insert({
      floor_id: phase.floorId,
      phase_number: phase.phaseNumber,
      ...payload,
    });
    if (error) console.warn('[Supabase] savePhase insert error:', error.message);
    return !error;
  }
}

export async function loadPhases(floorId: string): Promise<PhaseRecord[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.from('phases').select('*').eq('floor_id', floorId).order('phase_number');
  if (error || !data) return [];
  return data.map((row: Record<string, unknown>) => ({
    id: row['id'] as string,
    floorId: row['floor_id'] as string,
    phaseNumber: row['phase_number'] as number,
    name: row['name'] as string,
    status: row['status'] as PhaseRecord['status'],
    startedAt: row['started_at'] ? new Date(row['started_at'] as string) : null,
    completedAt: row['completed_at'] ? new Date(row['completed_at'] as string) : null,
    gateApproved: row['gate_approved'] as boolean,
    gateApprovedAt: row['gate_approved_at'] ? new Date(row['gate_approved_at'] as string) : null,
  }));
}

// --- Agent DB Persistence ---

export interface AgentRecord {
  id?: string;
  floorId: string;
  role: string;
  modelTier: string;
  status: 'idle' | 'working' | 'blocked' | 'paused';
  currentTask?: string | null;
  openclawAgentId?: string | null;
  config?: Record<string, unknown>;
}

export async function saveAgentRecord(agent: AgentRecord): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const payload: Record<string, unknown> = {
    floor_id: agent.floorId,
    role: agent.role,
    model_tier: agent.modelTier,
    status: agent.status,
    current_task: agent.currentTask ?? null,
    openclaw_agent_id: agent.openclawAgentId ?? null,
    config: agent.config ?? {},
  };
  if (agent.id) payload['id'] = agent.id;
  const { error } = await sb.from('agents').upsert(payload);
  return !error;
}

export async function updateAgentStatus(
  floorId: string,
  role: string,
  status: AgentRecord['status'],
  currentTask?: string | null,
): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('agents')
    .update({ status, current_task: currentTask ?? null })
    .eq('floor_id', floorId)
    .eq('role', role);
  return !error;
}

// --- Task Persistence ---

const PRIORITY_TO_INT: Record<string, number> = { low: 1, normal: 2, high: 3, critical: 4 };
const INT_TO_PRIORITY: Record<number, Task['priority']> = { 1: 'low', 2: 'normal', 3: 'high', 4: 'critical' };

export async function saveTask(task: Task): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const payload: Record<string, unknown> = {
    id: task.id,
    floor_id: task.floorId,
    phase_number: task.phaseNumber,
    assigned_agent: task.assignedAgent,
    model_tier: task.modelTier,
    task_type: task.taskType,
    description: task.description,
    status: task.status,
    priority: PRIORITY_TO_INT[task.priority] ?? 2,
    attempts: task.attempts,
    estimated_cost_cents: Math.round(task.estimatedCostCents),
    actual_cost_cents: Math.round(task.actualCostCents),
    result: task.result,
    review_status: task.reviewStatus,
    review_feedback: task.reviewFeedback,
    created_at: task.createdAt.toISOString(),
    dispatched_at: task.dispatchedAt?.toISOString() ?? null,
    completed_at: task.completedAt?.toISOString() ?? null,
  };
  if (hasTaskPromptColumn) {
    payload.prompt = task.prompt || null;
  }
  const { error } = await sb.from('tasks').upsert(payload);
  if (error) console.warn('[Supabase] saveTask error:', error.message);
  return !error;
}

/** Count tasks for a given phase (any status) — used to detect if a phase already ran. */
export async function countPhaseTasks(floorId: string, phaseNumber: number): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 0;
  const { count, error } = await sb
    .from('tasks')
    .select('*', { count: 'exact', head: true })
    .eq('floor_id', floorId)
    .eq('phase_number', phaseNumber);
  if (error) return 0;
  return count ?? 0;
}

export async function loadTasks(floorId: string): Promise<Task[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('tasks')
    .select('*')
    .eq('floor_id', floorId)
    .not('status', 'in', '("completed","escalated")')
    .order('created_at');
  if (error || !data) return [];
  return data.map((row: Record<string, unknown>) => ({
    id: row['id'] as string,
    floorId: row['floor_id'] as string,
    phaseNumber: row['phase_number'] as number,
    assignedAgent: row['assigned_agent'] as Task['assignedAgent'],
    modelTier: row['model_tier'] as Task['modelTier'],
    taskType: row['task_type'] as string,
    description: row['description'] as string,
    prompt: hasTaskPromptColumn ? ((row['prompt'] as string | null) ?? '') : '',
    inputFiles: (row['input_files'] as string[]) ?? [],
    outputFiles: (row['output_files'] as string[]) ?? [],
    dependsOn: (row['depends_on'] as string[]) ?? [],
    blockedBy: [],
    status: 'queued' as Task['status'], // re-queue in-progress tasks on recovery
    priority: INT_TO_PRIORITY[row['priority'] as number] ?? 'normal',
    attempts: (row['attempts'] as number) ?? 0,
    maxAttempts: 3,
    estimatedCostCents: (row['estimated_cost_cents'] as number) ?? 0,
    actualCostCents: (row['actual_cost_cents'] as number) ?? 0,
    createdAt: new Date(row['created_at'] as string),
    dispatchedAt: row['dispatched_at'] ? new Date(row['dispatched_at'] as string) : null,
    completedAt: null,
    result: null,
    reviewStatus: ((row['review_status'] as Task['reviewStatus']) ?? 'pending') as Task['reviewStatus'],
    reviewFeedback: (row['review_feedback'] as string | null) ?? null,
    revisionNote: null,
    approvalToken: (row['approval_token'] as string | null) ?? null,
  }));
}

/** Load ALL tasks for a floor (including completed/escalated) for display/memory purposes. */
export async function loadAllTasks(floorId: string): Promise<Task[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('tasks')
    .select('*')
    .eq('floor_id', floorId)
    .order('created_at');
  if (error || !data) return [];
  return data.map((row: Record<string, unknown>) => ({
    id: row['id'] as string,
    floorId: row['floor_id'] as string,
    phaseNumber: row['phase_number'] as number,
    assignedAgent: row['assigned_agent'] as Task['assignedAgent'],
    modelTier: row['model_tier'] as Task['modelTier'],
    taskType: row['task_type'] as string,
    description: row['description'] as string,
    prompt: hasTaskPromptColumn ? ((row['prompt'] as string | null) ?? '') : '',
    inputFiles: [],
    outputFiles: [],
    dependsOn: [],
    blockedBy: [],
    status: (row['status'] as Task['status']) ?? 'completed',
    priority: INT_TO_PRIORITY[row['priority'] as number] ?? 'normal',
    attempts: (row['attempts'] as number) ?? 0,
    maxAttempts: 3,
    estimatedCostCents: (row['estimated_cost_cents'] as number) ?? 0,
    actualCostCents: (row['actual_cost_cents'] as number) ?? 0,
    createdAt: new Date(row['created_at'] as string),
    dispatchedAt: row['dispatched_at'] ? new Date(row['dispatched_at'] as string) : null,
    completedAt: row['completed_at'] ? new Date(row['completed_at'] as string) : null,
    result: (row['result'] as string) ?? null,
    reviewStatus: ((row['review_status'] as Task['reviewStatus']) ?? 'pending') as Task['reviewStatus'],
    reviewFeedback: (row['review_feedback'] as string | null) ?? null,
    revisionNote: null,
    approvalToken: (row['approval_token'] as string | null) ?? null,
  }));
}

// --- Cost Events ---

export async function saveCostEvent(
  floorId: string,
  taskId: string,
  costCents: number,
  source: string,
  extras?: {
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    taskDescription?: string;
    eventType?: string;
  },
): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('cost_events').insert({
    floor_id: floorId,
    event_type: extras?.eventType ?? source,
    model: extras?.model ?? null,
    input_tokens: extras?.inputTokens ?? null,
    output_tokens: extras?.outputTokens ?? null,
    cost_cents: Math.round(costCents),
    task_description: extras?.taskDescription ?? taskId,
    created_at: new Date().toISOString(),
  });
  return !error;
}

export async function loadFloorSpend(floorId: string): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 0;
  const { data, error } = await sb
    .from('cost_events')
    .select('cost_cents')
    .eq('floor_id', floorId);
  if (error || !data) return 0;
  const total = (data as Array<{ cost_cents: number }>).reduce((sum, row) => sum + (row.cost_cents ?? 0), 0);
  return Math.round(total);
}

// --- Agent Performance ---

export interface AgentPerformanceRecord {
  agentRole: string;
  floorId: string;
  periodStart: Date;
  periodEnd: Date;
  tasksCompleted: number;
  approvalRate: number;
  avgRevisionCount: number;
  avgTimeSeconds: number;
  avgCostCents: number;
  avgTurns: number;
  qualityTrend: 'improving' | 'stable' | 'declining';
}

export async function saveAgentPerformance(record: AgentPerformanceRecord): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('agent_performance').insert({
    floor_id: record.floorId,
    agent_role: record.agentRole,
    period_start: record.periodStart.toISOString().split('T')[0],
    period_end: record.periodEnd.toISOString().split('T')[0],
    tasks_completed: record.tasksCompleted,
    approval_rate: record.approvalRate,
    avg_revision_count: record.avgRevisionCount,
    avg_time_seconds: record.avgTimeSeconds,
    avg_cost_cents: record.avgCostCents,
    avg_turns: record.avgTurns,
    quality_trend: record.qualityTrend,
  });
  return !error;
}

// --- Content Queue ---

export interface ContentItem {
  id?: string;
  floorId: string;
  contentType: string;
  platform: string;
  status: 'draft' | 'review' | 'approved' | 'scheduled' | 'published' | 'rejected';
  mediaUrl?: string | null;
  caption?: string | null;
  hashtags?: string[];
  scheduledAt?: Date | null;
  publishedAt?: Date | null;
  postId?: string | null;
  createdBy?: string | null;
  approvedBy?: string | null;
}

export async function saveContentItem(item: ContentItem): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const payload: Record<string, unknown> = {
    floor_id: item.floorId,
    content_type: item.contentType,
    platform: item.platform,
    status: item.status,
    media_url: item.mediaUrl ?? null,
    caption: item.caption ?? null,
    hashtags: item.hashtags ?? [],
    scheduled_at: item.scheduledAt?.toISOString() ?? null,
    published_at: item.publishedAt?.toISOString() ?? null,
    post_id: item.postId ?? null,
    created_by: item.createdBy ?? null,
    approved_by: item.approvedBy ?? null,
  };
  if (item.id) payload['id'] = item.id;
  const { data, error } = await sb.from('content_queue').upsert(payload).select('id').single();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

export async function updateContentStatus(
  contentId: string,
  status: ContentItem['status'],
  extras?: { postId?: string; publishedAt?: Date },
): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const update: Record<string, unknown> = { status };
  if (extras?.postId) update['post_id'] = extras.postId;
  if (extras?.publishedAt) update['published_at'] = extras.publishedAt.toISOString();
  const { error } = await sb.from('content_queue').update(update).eq('id', contentId);
  return !error;
}

export async function saveContentPerformance(
  contentId: string,
  platform: string,
  metrics: {
    views?: number; likes?: number; comments?: number; shares?: number; saves?: number;
    reach?: number; engagementRate?: number; clicks?: number; revenueAttributedCents?: number;
    measurementWindow: string;
  },
): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('content_performance').insert({
    content_id: contentId,
    platform,
    views: metrics.views ?? 0,
    likes: metrics.likes ?? 0,
    comments: metrics.comments ?? 0,
    shares: metrics.shares ?? 0,
    saves: metrics.saves ?? 0,
    reach: metrics.reach ?? 0,
    engagement_rate: metrics.engagementRate ?? 0,
    clicks: metrics.clicks ?? 0,
    revenue_attributed_cents: metrics.revenueAttributedCents ?? 0,
    measurement_window: metrics.measurementWindow,
    measured_at: new Date().toISOString(),
  });
  return !error;
}

// --- Products ---

export interface ProductRecord {
  id?: string;
  floorId: string;
  name: string;
  slug: string;
  description?: string;
  baseCostCents: number;
  priceCents: number;
  marginPercent?: number;
  images?: string[];
  variants?: unknown[];
  podProductId?: string | null;
  status: 'draft' | 'active' | 'paused' | 'archived';
}

export async function saveProduct(product: ProductRecord): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const payload: Record<string, unknown> = {
    floor_id: product.floorId,
    name: product.name,
    slug: product.slug,
    description: product.description ?? null,
    base_cost_cents: product.baseCostCents,
    price_cents: product.priceCents,
    margin_percent: product.marginPercent ?? null,
    images: product.images ?? [],
    variants: product.variants ?? [],
    pod_product_id: product.podProductId ?? null,
    status: product.status,
  };
  if (product.id) payload['id'] = product.id;
  const { data, error } = await sb.from('products').upsert(payload).select('id').single();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

// --- Orders ---

export interface OrderRecord {
  floorId: string;
  stripeSessionId: string;
  stripePaymentIntent?: string;
  customerEmailHash: string;
  items: unknown[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  status: 'paid' | 'fulfilling' | 'shipped' | 'delivered' | 'refunded';
  fulfillmentId?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
}

export async function saveOrder(order: OrderRecord): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('orders').upsert({
    floor_id: order.floorId,
    stripe_session_id: order.stripeSessionId,
    stripe_payment_intent: order.stripePaymentIntent ?? null,
    customer_email_hash: order.customerEmailHash,
    items: order.items,
    subtotal_cents: order.subtotalCents,
    shipping_cents: order.shippingCents,
    total_cents: order.totalCents,
    status: order.status,
    fulfillment_id: order.fulfillmentId ?? null,
    tracking_number: order.trackingNumber ?? null,
    tracking_url: order.trackingUrl ?? null,
    utm_source: order.utmSource ?? null,
    utm_medium: order.utmMedium ?? null,
    utm_campaign: order.utmCampaign ?? null,
    utm_content: order.utmContent ?? null,
  });
  return !error;
}

export async function updateOrderStatus(
  stripeSessionId: string,
  status: OrderRecord['status'],
  extras?: { fulfillmentId?: string; trackingNumber?: string; trackingUrl?: string; shippedAt?: Date; deliveredAt?: Date },
): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const update: Record<string, unknown> = { status };
  if (extras?.fulfillmentId) update['fulfillment_id'] = extras.fulfillmentId;
  if (extras?.trackingNumber) update['tracking_number'] = extras.trackingNumber;
  if (extras?.trackingUrl) update['tracking_url'] = extras.trackingUrl;
  if (extras?.shippedAt) update['shipped_at'] = extras.shippedAt.toISOString();
  if (extras?.deliveredAt) update['delivered_at'] = extras.deliveredAt.toISOString();
  const { error } = await sb.from('orders').update(update).eq('stripe_session_id', stripeSessionId);
  return !error;
}

// --- Ad Campaigns ---

export interface AdCampaignRecord {
  id?: string;
  floorId: string;
  platform: 'meta' | 'tiktok';
  platformCampaignId?: string | null;
  name: string;
  objective?: string;
  dailyBudgetCents?: number;
  status: 'paused' | 'active' | 'completed';
}

export async function saveAdCampaign(campaign: AdCampaignRecord): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const payload: Record<string, unknown> = {
    floor_id: campaign.floorId,
    platform: campaign.platform,
    platform_campaign_id: campaign.platformCampaignId ?? null,
    name: campaign.name,
    objective: campaign.objective ?? null,
    daily_budget_cents: campaign.dailyBudgetCents ?? 0,
    status: campaign.status,
  };
  if (campaign.id) payload['id'] = campaign.id;
  const { data, error } = await sb.from('ad_campaigns').upsert(payload).select('id').single();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

export async function saveAdDailyPerformance(
  campaignId: string,
  date: Date,
  metrics: {
    spendCents: number; impressions: number; clicks: number;
    conversions: number; revenueCents: number; roas?: number;
    cpaCents?: number; ctr?: number; frequency?: number;
  },
): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('ad_daily_performance').upsert({
    campaign_id: campaignId,
    date: date.toISOString().split('T')[0],
    spend_cents: metrics.spendCents,
    impressions: metrics.impressions,
    clicks: metrics.clicks,
    conversions: metrics.conversions,
    revenue_cents: metrics.revenueCents,
    roas: metrics.roas ?? null,
    cpa_cents: metrics.cpaCents ?? null,
    ctr: metrics.ctr ?? null,
    frequency: metrics.frequency ?? null,
  });
  return !error;
}

// --- Improvement Proposals ---

export interface ImprovementProposalDb {
  id?: string;
  floorId?: string | null;
  type: string;
  targetAgent?: string | null;
  priority?: 'high' | 'medium' | 'low';
  whatChanges: string;
  currentState?: string | null;
  proposedState: string;
  evidence: Record<string, unknown>;
  expectedImpact?: string | null;
  riskLevel?: 'low' | 'medium' | 'high';
  rollbackPlan?: string | null;
  status: string;
  reviewedAt?: Date | null;
  appliedAt?: Date | null;
  impactMeasuredAt?: Date | null;
  impactResult?: Record<string, unknown> | null;
}

export async function saveImprovementProposal(proposal: ImprovementProposalDb): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const payload: Record<string, unknown> = {
    floor_id: proposal.floorId ?? null,
    type: proposal.type,
    target_agent: proposal.targetAgent ?? null,
    priority: proposal.priority ?? 'medium',
    what_changes: proposal.whatChanges,
    current_state: proposal.currentState ?? null,
    proposed_state: proposal.proposedState,
    evidence: proposal.evidence,
    expected_impact: proposal.expectedImpact ?? null,
    risk_level: proposal.riskLevel ?? 'low',
    rollback_plan: proposal.rollbackPlan ?? null,
    status: proposal.status,
    reviewed_at: proposal.reviewedAt?.toISOString() ?? null,
    applied_at: proposal.appliedAt?.toISOString() ?? null,
    impact_measured_at: proposal.impactMeasuredAt?.toISOString() ?? null,
    impact_result: proposal.impactResult ?? null,
  };
  if (proposal.id) payload['id'] = proposal.id;
  const { data, error } = await sb.from('improvement_proposals').upsert(payload).select('id').single();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

export async function updateImprovementProposal(
  id: string,
  updates: Partial<Pick<ImprovementProposalDb, 'status' | 'reviewedAt' | 'appliedAt' | 'impactMeasuredAt' | 'impactResult'>>,
): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const update: Record<string, unknown> = {};
  if (updates.status !== undefined) update['status'] = updates.status;
  if (updates.reviewedAt !== undefined) update['reviewed_at'] = updates.reviewedAt?.toISOString() ?? null;
  if (updates.appliedAt !== undefined) update['applied_at'] = updates.appliedAt?.toISOString() ?? null;
  if (updates.impactMeasuredAt !== undefined) update['impact_measured_at'] = updates.impactMeasuredAt?.toISOString() ?? null;
  if (updates.impactResult !== undefined) update['impact_result'] = updates.impactResult;
  const { error } = await sb.from('improvement_proposals').update(update).eq('id', id);
  return !error;
}

// --- Preference Patterns ---

export async function savePreferencePattern(pattern: {
  category: string;
  patternType: string;
  description: string;
  confidenceScore: number;
  evidenceCount: number;
  evidence: unknown[];
  appliedAsDefault?: boolean;
}): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('preference_patterns').upsert({
    category: pattern.category,
    pattern_type: pattern.patternType,
    description: pattern.description,
    confidence_score: pattern.confidenceScore,
    evidence_count: pattern.evidenceCount,
    evidence: pattern.evidence,
    applied_as_default: pattern.appliedAsDefault ?? false,
    updated_at: new Date().toISOString(),
  });
  return !error;
}

// --- Playbook Entries ---

export async function savePlaybookEntry(entry: {
  category: string;
  title: string;
  strategy: string;
  results?: Record<string, unknown>;
  sourceFloorId?: string | null;
  applicability?: string;
}): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('playbook_entries').insert({
    category: entry.category,
    title: entry.title,
    strategy: entry.strategy,
    results: entry.results ?? null,
    source_floor_id: entry.sourceFloorId ?? null,
    applicability: entry.applicability ?? null,
  });
  return !error;
}

// --- A/B Tests ---

export async function saveAbTest(test: {
  proposalId: string;
  variantAConfig: Record<string, unknown>;
  variantBConfig: Record<string, unknown>;
  status?: 'running' | 'completed' | 'cancelled';
}): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('ab_tests').insert({
    proposal_id: test.proposalId,
    variant_a_config: test.variantAConfig,
    variant_b_config: test.variantBConfig,
    status: test.status ?? 'running',
  });
  return !error;
}

// --- Approval Queue ---

export interface ApprovalItem {
  id?: string;
  floorId: string;
  type: string;
  priority?: 'critical' | 'normal' | 'low';
  title: string;
  description?: string | null;
  data?: Record<string, unknown> | null;
  status?: 'pending' | 'approved' | 'rejected' | 'deferred';
}

export async function saveApprovalItem(item: ApprovalItem): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const payload: Record<string, unknown> = {
    floor_id: item.floorId,
    type: item.type,
    priority: item.priority ?? 'normal',
    title: item.title,
    description: item.description ?? null,
    data: item.data ?? null,
    status: item.status ?? 'pending',
  };
  if (item.id) payload['id'] = item.id;
  const { data, error } = await sb.from('approval_queue').upsert(payload).select('id').single();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

export async function updateApprovalStatus(
  id: string,
  status: 'approved' | 'rejected' | 'deferred',
): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('approval_queue')
    .update({ status, resolved_at: new Date().toISOString() })
    .eq('id', id);
  return !error;
}

export async function loadPendingApprovals(floorId?: string): Promise<ApprovalItem[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let query = sb.from('approval_queue').select('*').eq('status', 'pending');
  if (floorId) query = query.eq('floor_id', floorId);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error || !data) return [];
  return data.map((row: Record<string, unknown>) => ({
    id: row['id'] as string,
    floorId: row['floor_id'] as string,
    type: row['type'] as string,
    priority: row['priority'] as ApprovalItem['priority'],
    title: row['title'] as string,
    description: row['description'] as string | null,
    data: row['data'] as Record<string, unknown> | null,
    status: row['status'] as ApprovalItem['status'],
  }));
}

// --- Notifications ---

export async function saveNotificationDb(notification: {
  floorId?: string | null;
  tier: 'critical' | 'important' | 'informational';
  title: string;
  body?: string;
  linkTo?: string | null;
}): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('notifications').insert({
    floor_id: notification.floorId ?? null,
    tier: notification.tier,
    title: notification.title,
    body: notification.body ?? null,
    link_to: notification.linkTo ?? null,
    read: false,
    push_sent: false,
  });
  return !error;
}

export async function markNotificationRead(id: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('notifications').update({ read: true }).eq('id', id);
  return !error;
}

// --- Email Subscribers ---

export async function saveEmailSubscriber(subscriber: {
  floorId: string;
  emailHash: string;
  kitSubscriberId?: string | null;
  segment?: string;
  tags?: string[];
}): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('email_subscribers').upsert({
    floor_id: subscriber.floorId,
    email_hash: subscriber.emailHash,
    kit_subscriber_id: subscriber.kitSubscriberId ?? null,
    segment: subscriber.segment ?? 'new-subscriber',
    tags: subscriber.tags ?? [],
  });
  return !error;
}

export async function updateSubscriberStats(
  emailHash: string,
  updates: { totalOrders?: number; totalSpentCents?: number; lastOrderAt?: Date; lastEmailOpenedAt?: Date; clvCents?: number },
): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const update: Record<string, unknown> = {};
  if (updates.totalOrders !== undefined) update['total_orders'] = updates.totalOrders;
  if (updates.totalSpentCents !== undefined) update['total_spent_cents'] = updates.totalSpentCents;
  if (updates.lastOrderAt) update['last_order_at'] = updates.lastOrderAt.toISOString();
  if (updates.lastEmailOpenedAt) update['last_email_opened_at'] = updates.lastEmailOpenedAt.toISOString();
  if (updates.clvCents !== undefined) update['clv_cents'] = updates.clvCents;
  const { error } = await sb.from('email_subscribers').update(update).eq('email_hash', emailHash);
  return !error;
}

// --- Floor Chat Messages ---

export interface ChatMessageRecord {
  id?: string;
  floorId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sender?: string | null; // e.g. 'owner', 'floor-manager', agent id
  timestamp?: Date;
}

/**
 * Append a single chat message to persistent storage.
 * Returns the generated message id, or null on failure.
 */
export async function saveChatMessage(msg: ChatMessageRecord): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.from('floor_chat_messages').insert({
    floor_id: msg.floorId,
    role: msg.role,
    content: msg.content,
    sender: msg.sender ?? null,
    timestamp: (msg.timestamp ?? new Date()).toISOString(),
  }).select('id').single();
  if (error) {
    console.warn('[Supabase] saveChatMessage error:', error.message);
    return null;
  }
  return (data as { id: string }).id;
}

/**
 * Load the full conversation history for a floor, ordered oldest-first.
 * Returns an empty array if Supabase is unavailable or the table doesn't exist yet.
 */
export async function loadChatMessages(floorId: string): Promise<ChatMessageRecord[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('floor_chat_messages')
    .select('*')
    .eq('floor_id', floorId)
    .order('timestamp', { ascending: true });
  if (error || !data) {
    if (error && !error.message.includes('does not exist')) {
      console.warn('[Supabase] loadChatMessages error:', error.message);
    }
    return [];
  }
  return (data as Array<Record<string, unknown>>).map(row => ({
    id: row['id'] as string,
    floorId: row['floor_id'] as string,
    role: row['role'] as ChatMessageRecord['role'],
    content: row['content'] as string,
    sender: (row['sender'] as string | null) ?? null,
    timestamp: row['timestamp'] ? new Date(row['timestamp'] as string) : new Date(),
  }));
}

/**
 * Delete all chat messages for a floor — only called on explicit user action.
 */
export async function clearChatMessages(floorId: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb
    .from('floor_chat_messages')
    .delete()
    .eq('floor_id', floorId);
  if (error) console.warn('[Supabase] clearChatMessages error:', error.message);
  return !error;
}

// --- Command Log ---

export async function saveCommandLog(entry: {
  floorId: string;
  agentRole?: string | null;
  command: string;
  tier: 1 | 2 | 3;
  approved?: boolean | null;
  approvedBy?: string | null;
  output?: string | null;
  error?: string | null;
  exitCode?: number | null;
}): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('command_log').insert({
    floor_id: entry.floorId,
    agent_role: entry.agentRole ?? null,
    command: entry.command,
    tier: entry.tier,
    approved: entry.approved ?? null,
    approved_by: entry.approvedBy ?? null,
    output: entry.output ?? null,
    error: entry.error ?? null,
    exit_code: entry.exitCode ?? null,
  });
  return !error;
}

// --- Security Events ---

export async function saveSecurityEvent(event: {
  floorId: string;
  eventType: string;
  severity: 'info' | 'warning' | 'critical';
  description: string;
}): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('security_events').insert({
    floor_id: event.floorId,
    event_type: event.eventType,
    severity: event.severity,
    description: event.description,
    resolved: false,
  });
  return !error;
}

// --- Trust State Persistence ---

export interface TrustStateRecord {
  floorId: string;
  level: number;
  totalApprovals: number;
  totalRejections: number;
  consecutiveApprovals: number;
  lastLevelChange: string; // ISO date
}

export async function saveTrustState(record: TrustStateRecord): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  // Store trust state in floors table as a JSON column (trust_state)
  const { error } = await sb.from('floors').update({
    trust_state: record,
  }).eq('id', record.floorId);
  if (error) {
    // Fallback: store in a dedicated file if column doesn't exist
    if (error.message.includes('trust_state')) {
      try {
        const { writeFile, mkdir } = await import('node:fs/promises');
        const { join } = await import('node:path');
        const dir = join(process.cwd(), 'data', 'trust-state');
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, `${record.floorId}.json`), JSON.stringify(record), 'utf-8');
        return true;
      } catch { return false; }
    }
    console.warn('[Supabase] saveTrustState error:', error.message);
    return false;
  }
  return true;
}

export async function loadTrustState(floorId: string): Promise<TrustStateRecord | null> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('floors').select('trust_state').eq('id', floorId).maybeSingle();
    if (!error && data && data['trust_state']) {
      return data['trust_state'] as TrustStateRecord;
    }
  }
  // Fallback: try file-based storage
  try {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const content = await readFile(join(process.cwd(), 'data', 'trust-state', `${floorId}.json`), 'utf-8');
    return JSON.parse(content) as TrustStateRecord;
  } catch { return null; }
}

// --- Realtime ---

export async function broadcastFloorEvent(
  floorId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const channel = sb.channel(`floors:${floorId}`);
  await channel.send({ type: 'broadcast', event, payload });
}

/**
 * Subscribe to owner actions from the Dashboard for a specific floor.
 * Receives approval decisions, chat messages, and manual commands.
 */
export function subscribeToFloor(
  floorId: string,
  onMessage: (event: string, payload: Record<string, unknown>) => void,
): { unsubscribe: () => void } {
  const sb = getSupabase();
  if (!sb) return { unsubscribe: () => {} };

  const channel = sb
    .channel(`owner-actions:${floorId}`)
    .on('broadcast', { event: '*' }, (payload: { event: string; payload: Record<string, unknown> }) => {
      onMessage(payload.event, payload.payload);
    })
    .subscribe();

  return {
    unsubscribe: () => {
      sb.removeChannel(channel);
    },
  };
}
