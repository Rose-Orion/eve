/**
 * Self-Improvement Engine — bounded learning system.
 *
 * Tracks agent performance, proposes prompt/template improvements,
 * requires human approval before applying changes.
 *
 * What it tracks:
 * - First-try approval rates per agent per task type
 * - Common revision reasons
 * - Anti-slop violation frequency
 * - Cost per task type over time
 *
 * What it proposes:
 * - Voice sample updates based on approved copy patterns
 * - Prompt template adjustments based on rejection patterns
 * - Gold standard example additions from approved outputs
 * - Model tier changes based on quality/cost tradeoffs
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentId, ModelTier } from '../config/types.js';
import type { EventBus } from './event-bus.js';

// Stop words excluded from similarity comparison
const STOP_WORDS = new Set(['the','a','an','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','shall','can','need','dare','ought','used','to','of','in','for','on','with','at','by','from','as','into','through','during','before','after','above','below','between','out','off','over','under','again','further','then','once','and','but','or','nor','not','so','very','just','that','this','these','those','it','its']);

/** Extract significant words (>3 chars, not stopwords) from a message. */
function extractSignificantWords(msg: string): Set<string> {
  return new Set(
    msg.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w))
  );
}

/** Calculate word overlap ratio between two word sets (Jaccard-like). */
function wordOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) { if (b.has(w)) shared++; }
  return shared / Math.min(a.size, b.size);
}

/**
 * Theme fingerprints — extract high-signal keywords that identify
 * the core topic so the FM can't bypass dedup by rewording.
 */
const THEME_KEYWORDS: Array<{ theme: string; markers: string[] }> = [
  { theme: 'budget-low', markers: ['budget', 'spent', 'utilization', 'efficiency', 'underspend', 'underutiliz'] },
  { theme: 'analytics-phase9', markers: ['analytics', 'phase', 'performance-review', 'ad-optimization', 'growth-report'] },
  { theme: 'phase1-stall', markers: ['phase', 'brand-details', 'budget-plan', 'stall', 'blocked', 'event handler'] },
  { theme: 'copy-retry', markers: ['copy-agent', 'retry', 'voice-guide', 'brand-voice'] },
  { theme: 'dispatch-verify', markers: ['dispatch_backend_agent', 'verification', 'status', 'readiness'] },
  { theme: 'perf-metrics', markers: ['performance', 'metric', 'logging', 'baseline', 'tracking'] },
];

function detectTheme(msg: string): string | null {
  const lower = msg.toLowerCase();
  for (const { theme, markers } of THEME_KEYWORDS) {
    const hits = markers.filter(m => lower.includes(m)).length;
    if (hits >= 2) return theme;
  }
  return null;
}

export type ProposalStatus = 'pending' | 'approved' | 'applied' | 'confirmed' | 'rolled_back' | 'rejected' | 'auto-applied';
export type ProposalType = 'voice-sample-update' | 'template-adjustment' | 'gold-standard-add' | 'model-tier-change' | 'agent-feedback';

export interface AgentFeedback {
  id: string;
  floorId: string;
  agentId: AgentId;
  message: string;
  category: 'bug' | 'improvement' | 'request' | 'observation';
  eveAnalysis: string;
  eveDecision: 'auto-apply' | 'needs-approval' | 'deferred' | 'rejected';
  eveReasoning: string;
  actionTaken: string | null;
  status: 'pending' | 'analyzed' | 'applied' | 'owner-approved' | 'owner-rejected';
  createdAt: Date;
  analyzedAt: Date | null;
  resolvedAt: Date | null;
}

export interface ImprovementProposal {
  id: string;
  floorId: string;
  agentId: AgentId;
  type: ProposalType;
  description: string;
  currentValue: string;
  proposedValue: string;
  evidence: string;
  rollbackPlan: string;
  riskLevel: 'low' | 'medium' | 'high';
  status: ProposalStatus;
  createdAt: Date;
  resolvedAt: Date | null;
  appliedAt: Date | null;
  impactMeasuredAt: Date | null;
  impactResult: { improved: boolean; metricBefore: number; metricAfter: number } | null;
}

interface AgentPerformance {
  agentId: AgentId;
  floorId: string;
  taskType: string;
  totalTasks: number;
  firstTryApprovals: number;
  revisions: number;
  rejections: number;
  slopViolations: number;
  totalCostCents: number;
  revisionReasons: Map<string, number>;
}

let proposalCounter = 0;
let feedbackCounter = 0;

export class ImprovementEngine {
  private performance = new Map<string, AgentPerformance>();
  private proposals = new Map<string, ImprovementProposal>();
  private agentFeedbacks = new Map<string, AgentFeedback>();
  private systemLearnings: Array<{ id: string; sourceFloorId: string; learning: string; reason: string; appliedAt: Date }> = [];
  private dataDir = join(process.cwd(), 'data', 'improvements');

  constructor(private eventBus: EventBus) {
    this.setupListeners();
    // Auto-expire stale needs-approval feedback every hour
    setInterval(() => this.expireStaleFeedback(), 60 * 60 * 1000);
  }

  /** Reject needs-approval feedback older than 48h that the owner never acted on. */
  private expireStaleFeedback(): void {
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    let expired = 0;
    for (const fb of this.agentFeedbacks.values()) {
      if (fb.status !== 'analyzed' || fb.eveDecision !== 'needs-approval') continue;
      if (fb.agentId === 'owner') continue; // Never auto-expire owner feedback
      if (fb.analyzedAt && fb.analyzedAt.getTime() < cutoff) {
        fb.status = 'owner-rejected';
        fb.resolvedAt = new Date();
        expired++;
      }
    }
    if (expired > 0) {
      console.log(`[EVE] Auto-expired ${expired} stale needs-approval feedback items (>48h)`);
      this.persist().catch(() => {});
    }
  }

  // --- Persistence ---

  /** Save feedback, proposals, and learnings to disk so they survive restarts. */
  async persist(): Promise<void> {
    try {
      await mkdir(this.dataDir, { recursive: true });
      const state = {
        feedbacks: [...this.agentFeedbacks.values()],
        proposals: [...this.proposals.values()],
        systemLearnings: this.systemLearnings,
        feedbackCounter,
        proposalCounter,
      };
      await writeFile(join(this.dataDir, 'state.json'), JSON.stringify(state, null, 2), 'utf-8');
    } catch { /* non-critical */ }
  }

  /** Restore persisted state on boot. */
  async loadPersistedState(): Promise<void> {
    try {
      const data = await readFile(join(this.dataDir, 'state.json'), 'utf-8');
      const state = JSON.parse(data);
      if (Array.isArray(state.feedbacks)) {
        for (const fb of state.feedbacks) {
          fb.createdAt = new Date(fb.createdAt);
          if (fb.analyzedAt) fb.analyzedAt = new Date(fb.analyzedAt);
          if (fb.resolvedAt) fb.resolvedAt = new Date(fb.resolvedAt);
          this.agentFeedbacks.set(fb.id, fb);
        }
      }
      if (Array.isArray(state.proposals)) {
        for (const p of state.proposals) {
          p.createdAt = new Date(p.createdAt);
          if (p.resolvedAt) p.resolvedAt = new Date(p.resolvedAt);
          if (p.appliedAt) p.appliedAt = new Date(p.appliedAt);
          if (p.impactMeasuredAt) p.impactMeasuredAt = new Date(p.impactMeasuredAt);
          this.proposals.set(p.id, p);
        }
      }
      if (Array.isArray(state.systemLearnings)) {
        this.systemLearnings = state.systemLearnings.map((l: { id: string; sourceFloorId: string; learning: string; reason: string; appliedAt: string }) => ({
          ...l,
          appliedAt: new Date(l.appliedAt),
        }));
      }
      if (state.feedbackCounter) feedbackCounter = state.feedbackCounter;
      if (state.proposalCounter) proposalCounter = state.proposalCounter;
      console.log(`[EVE] Restored ${this.agentFeedbacks.size} feedbacks, ${this.proposals.size} proposals, ${this.systemLearnings.length} learnings`);
      // Clean up stale feedback on boot
      this.expireStaleFeedback();
    } catch { /* file doesn't exist yet */ }
  }

  private perfKey(floorId: string, agentId: AgentId, taskType: string): string {
    return `${floorId}:${agentId}:${taskType}`;
  }

  private getOrCreatePerf(floorId: string, agentId: AgentId, taskType: string): AgentPerformance {
    const key = this.perfKey(floorId, agentId, taskType);
    if (!this.performance.has(key)) {
      this.performance.set(key, {
        agentId, floorId, taskType,
        totalTasks: 0, firstTryApprovals: 0, revisions: 0,
        rejections: 0, slopViolations: 0, totalCostCents: 0,
        revisionReasons: new Map(),
      });
    }
    return this.performance.get(key)!;
  }

  // --- Tracking ---

  recordTaskCompletion(
    floorId: string,
    agentId: AgentId,
    taskType: string,
    firstTry: boolean,
    costCents: number,
  ): void {
    const perf = this.getOrCreatePerf(floorId, agentId, taskType);
    perf.totalTasks++;
    if (firstTry) perf.firstTryApprovals++;
    perf.totalCostCents += costCents;

    this.checkForImprovements(perf);
  }

  recordRevision(
    floorId: string,
    agentId: AgentId,
    taskType: string,
    reason: string,
  ): void {
    const perf = this.getOrCreatePerf(floorId, agentId, taskType);
    perf.revisions++;
    const count = perf.revisionReasons.get(reason) ?? 0;
    perf.revisionReasons.set(reason, count + 1);
  }

  recordSlopViolation(floorId: string, agentId: AgentId, taskType: string): void {
    const perf = this.getOrCreatePerf(floorId, agentId, taskType);
    perf.slopViolations++;
  }

  // --- Proposals ---

  private checkForImprovements(perf: AgentPerformance): void {
    // Only analyze after enough data
    if (perf.totalTasks < 5) return;

    const approvalRate = perf.firstTryApprovals / perf.totalTasks;

    // Low approval rate → suggest template adjustment
    if (approvalRate < 0.6 && perf.totalTasks >= 10) {
      const topReason = [...perf.revisionReasons.entries()]
        .sort((a, b) => b[1] - a[1])[0];

      if (topReason) {
        this.createProposal({
          floorId: perf.floorId,
          agentId: perf.agentId,
          type: 'template-adjustment',
          description: `${perf.agentId} has ${Math.round(approvalRate * 100)}% first-try approval rate for ${perf.taskType}`,
          currentValue: `Current template`,
          proposedValue: `Adjust template to address: "${topReason[0]}" (${topReason[1]} occurrences)`,
          evidence: `${perf.revisions} revisions in ${perf.totalTasks} tasks. Top reason: "${topReason[0]}"`,
        });
      }
    }

    // High slop rate → suggest stronger anti-slop rules
    if (perf.slopViolations > 3 && perf.slopViolations / perf.totalTasks > 0.2) {
      this.createProposal({
        floorId: perf.floorId,
        agentId: perf.agentId,
        type: 'template-adjustment',
        description: `${perf.agentId} has high anti-slop violation rate for ${perf.taskType}`,
        currentValue: `Current anti-slop rules`,
        proposedValue: `Strengthen anti-slop enforcement in template. ${perf.slopViolations} violations in ${perf.totalTasks} tasks.`,
        evidence: `${Math.round((perf.slopViolations / perf.totalTasks) * 100)}% slop rate`,
      });
    }
  }

  private createProposal(input: Omit<ImprovementProposal, 'id' | 'status' | 'createdAt' | 'resolvedAt' | 'appliedAt' | 'impactMeasuredAt' | 'impactResult' | 'rollbackPlan' | 'riskLevel'> & { rollbackPlan?: string; riskLevel?: 'low' | 'medium' | 'high' }): void {
    const id = `imp-${++proposalCounter}`;
    const proposal: ImprovementProposal = {
      ...input,
      id,
      rollbackPlan: input.rollbackPlan ?? 'Revert template to previous version',
      riskLevel: input.riskLevel ?? 'low',
      status: 'pending',
      createdAt: new Date(),
      resolvedAt: null,
      appliedAt: null,
      impactMeasuredAt: null,
      impactResult: null,
    };
    this.proposals.set(id, proposal);
    this.persist().catch(() => {});
    this.eventBus.emit('approval:needed', {
      floorId: input.floorId,
      taskId: id,
      type: 'improvement-proposal',
    });
  }

  /** Approve a proposal — moves to 'applied' state and starts 7-day impact tracking. */
  approveProposal(proposalId: string): boolean {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== 'pending') return false;

    // Snapshot current metrics for before/after comparison
    this.snapshotForProposal(proposalId);

    proposal.status = 'applied';
    proposal.resolvedAt = new Date();
    proposal.appliedAt = new Date();
    this.persist().catch(() => {});

    // Schedule 7-day impact measurement
    setTimeout(() => this.measureImpact(proposalId), 7 * 24 * 60 * 60 * 1000);
    return true;
  }

  rejectProposal(proposalId: string): boolean {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== 'pending') return false;
    proposal.status = 'rejected';
    proposal.resolvedAt = new Date();
    this.persist().catch(() => {});
    return true;
  }

  /** Rollback a proposal — reverts to currentValue. */
  rollbackProposal(proposalId: string): boolean {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || (proposal.status !== 'applied' && proposal.status !== 'confirmed')) return false;
    proposal.status = 'rolled_back';
    proposal.resolvedAt = new Date();
    this.persist().catch(() => {});
    // The Orchestrator is responsible for actually reverting the template/config
    return true;
  }

  /** Snapshot performance at time of proposal creation for before/after comparison. */
  private snapshotBeforeApply = new Map<string, number>();

  /** Record the pre-apply metric snapshot when a proposal is approved. */
  snapshotForProposal(proposalId: string): void {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return;
    const perf = this.getOrCreatePerf(proposal.floorId, proposal.agentId, '');
    const rate = perf.totalTasks > 0 ? perf.firstTryApprovals / perf.totalTasks : 0;
    this.snapshotBeforeApply.set(proposalId, rate);
  }

  /** Measure impact of an applied proposal after 7 days. */
  private measureImpact(proposalId: string): void {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== 'applied') return;

    const perf = this.getOrCreatePerf(proposal.floorId, proposal.agentId, '');
    const currentRate = perf.totalTasks > 0 ? perf.firstTryApprovals / perf.totalTasks : 0;
    const beforeRate = this.snapshotBeforeApply.get(proposalId) ?? 0;

    proposal.impactMeasuredAt = new Date();
    proposal.impactResult = {
      improved: currentRate > beforeRate,
      metricBefore: beforeRate,
      metricAfter: currentRate,
    };

    if (currentRate >= beforeRate) {
      proposal.status = 'confirmed';
      console.log(`[Improvement] ${proposalId} CONFIRMED: ${Math.round(beforeRate * 100)}% → ${Math.round(currentRate * 100)}%`);
    } else {
      // Regression — auto-propose rollback
      console.warn(`[Improvement] ${proposalId} REGRESSED: ${Math.round(beforeRate * 100)}% → ${Math.round(currentRate * 100)}%`);
      this.eventBus.emit('approval:needed', {
        floorId: proposal.floorId,
        taskId: proposal.id,
        type: 'improvement-rollback',
      });
    }

    this.snapshotBeforeApply.delete(proposalId);
  }

  /**
   * Fetch gold-standard examples from Supabase for a given agent + task type.
   * These are loaded into agent prompts as few-shot examples.
   * Returns a formatted string ready to inject into a PromptBuilder context.
   */
  async getGoldStandards(agentId: AgentId, taskType: string): Promise<string> {
    try {
      const { getSupabase } = await import('../integrations/supabase.js');
      const sb = getSupabase();
      if (!sb) return 'No gold standards yet.';
      const { data } = await sb
        .from('gold_standards')
        .select('example, approved_at, task_type')
        .eq('agent_id', agentId)
        .eq('task_type', taskType)
        .order('approved_at', { ascending: false })
        .limit(2);
      if (!data || data.length === 0) return 'No gold standards yet.';
      return (data as Array<{ example: string }>).map(d => d.example).join('\n\n---\n\n');
    } catch {
      return 'No gold standards yet.';
    }
  }

  /**
   * Promote an approved task result to a gold standard.
   * Called by the orchestrator when an owner approves an output.
   */
  async addGoldStandard(agentId: AgentId, taskType: string, floorId: string, content: string): Promise<void> {
    try {
      const { getSupabase } = await import('../integrations/supabase.js');
      const sb = getSupabase();
      if (!sb) return;
      await sb.from('gold_standards').insert({
        agent_id: agentId,
        task_type: taskType,
        floor_id: floorId,
        example: content,
        approved_at: new Date().toISOString(),
      });
    } catch {
      // Non-critical
    }
  }

  /**
   * Run the weekly improvement analysis for a floor and return pending proposals.
   * Triggered by the improvement cycle cron or manually from the dashboard.
   */
  async generateProposals(floorId: string): Promise<ImprovementProposal[]> {
    // Re-run analysis for all tracked agents on this floor
    for (const perf of this.performance.values()) {
      if (perf.floorId === floorId) {
        this.checkForImprovements(perf);
      }
    }
    return this.getPendingProposals(floorId);
  }

  getPendingProposals(floorId?: string): ImprovementProposal[] {
    return [...this.proposals.values()].filter(
      p => p.status === 'pending' && (!floorId || p.floorId === floorId),
    );
  }

  getAllProposals(floorId?: string): ImprovementProposal[] {
    return [...this.proposals.values()].filter(
      p => !floorId || p.floorId === floorId,
    );
  }

  getPerformance(floorId: string, agentId?: AgentId): AgentPerformance[] {
    return [...this.performance.values()].filter(
      p => p.floorId === floorId && (!agentId || p.agentId === agentId),
    );
  }

  // --- Agent Feedback System ---

  /**
   * Submit feedback from a Floor Manager or agent to EVE for analysis.
   * EVE uses Claude to evaluate the feedback, classify risk, and decide
   * whether to auto-apply or escalate to the owner.
   */
  async submitAgentFeedback(
    floorId: string,
    agentId: AgentId,
    message: string,
    floorContext: { name: string; phase: number; status: string; goal?: string },
  ): Promise<AgentFeedback> {
    // Dedup guard: reject feedback that repeats existing concerns.
    // Uses two strategies: (1) word-overlap at 40% threshold, (2) theme-based blocking.
    // Skip dedup for owner feedback — owner may report same issue with new context.
    if (agentId !== 'owner') {
      const twoDaysAgo = Date.now() - 48 * 60 * 60 * 1000;
      const msgWords = extractSignificantWords(message);
      const msgTheme = detectTheme(message);

      for (const existing of this.agentFeedbacks.values()) {
        if (existing.floorId !== floorId) continue;
        if (existing.createdAt.getTime() < twoDaysAgo) continue;

        // Strategy 1: Word overlap (tightened from 0.6 to 0.4)
        const existingWords = extractSignificantWords(existing.message);
        const overlap = wordOverlap(msgWords, existingWords);
        if (overlap > 0.4) {
          console.log(`[EVE] Skipping duplicate feedback: "${message.slice(0, 40)}..." (${Math.round(overlap * 100)}% overlap with ${existing.id})`);
          return existing;
        }

        // Strategy 2: Same theme detected — block unless the existing one was rejected
        // and this one has genuinely new evidence (checked by word overlap being < 0.2)
        if (msgTheme && msgTheme === detectTheme(existing.message)) {
          if (existing.eveDecision !== 'rejected' || overlap > 0.2) {
            console.log(`[EVE] Skipping same-theme feedback: "${message.slice(0, 40)}..." (theme: ${msgTheme}, matches ${existing.id})`);
            return existing;
          }
        }
      }
    }

    const id = `fb-${++feedbackCounter}`;
    const feedback: AgentFeedback = {
      id,
      floorId,
      agentId,
      message,
      category: 'observation',
      eveAnalysis: '',
      eveDecision: 'deferred',
      eveReasoning: '',
      actionTaken: null,
      status: 'pending',
      createdAt: new Date(),
      analyzedAt: null,
      resolvedAt: null,
    };
    this.agentFeedbacks.set(id, feedback);

    // Analyze with Claude
    try {
      const { callAnthropic } = await import('../clients/anthropic.js');

      const systemPrompt = `You are EVE — the central intelligence of an autonomous business-building system.

${agentId === 'owner' ? 'The BUSINESS OWNER has reported an issue directly' : 'A Floor Manager agent has submitted feedback'} about "${floorContext.name}" (Phase ${floorContext.phase}, Status: ${floorContext.status}).
FLOOR GOAL: ${floorContext.goal || 'Build and grow a business'}

YOUR ANALYSIS FRAMEWORK — evaluate every piece of feedback through these lenses:

1. RELEVANCE TO GOAL: Does this feedback relate to achieving "${floorContext.goal}"? If the feedback is about a generic observation that doesn't impact the floor's ability to reach its goal, it's probably not worth acting on.

2. SEVERITY CHECK: Is this an actual problem or just an observation?
   - A single retry is normal. Agents retry — that's by design.
   - Budget being "only 1% spent" in early phases is expected, not a problem.
   - Vague recommendations ("establish metrics", "define criteria") are not actionable problems.

3. EVIDENCE REQUIRED: Is there concrete evidence of a problem, or is the FM speculating?
   - "Agent failed 3 times on the same task" = evidence → worth acting on
   - "Agent might struggle with future tasks" = speculation → reject or defer
   - "Recommend establishing baseline metrics" = process suggestion, not a bug → reject unless there's a real quality issue

4. DECIDE what to do:
   - "auto-apply": ONLY for fixing a demonstrated, concrete problem that blocks or degrades goal progress. Must have clear evidence (repeated failures, quality issues in actual output, broken workflows). Template changes should be minimal and targeted.
   - "needs-approval": Changes that affect budget, branding, business strategy, or external services.
   - "deferred": Valid concern but no evidence yet — wait and see if it becomes a real problem.
   - "rejected": Speculative, vague, noise, or not relevant to the floor's goal. This is the RIGHT answer for most observations and generic recommendations. Be aggressive about rejecting noise.

BIAS: Default to "rejected" or "deferred" unless there's clear evidence of a real problem. The system works. Don't fix what isn't broken. One retry is not a crisis. A healthy budget isn't a problem to solve.

ALWAYS REJECT these — they are known non-issues:
- Budget underutilization / low spend / efficiency concerns — API costs are pennies per task, this is normal
- "credit balance" / "billing" / "rate_limit" task failures — external API credit issue, not a bug
- Requests for status updates on dispatch_backend_agent actions — they're async
- "establish baseline metrics" / "define success criteria" — process theater, not actionable
- Copy-agent needing 1 retry — single retries are normal operation
- Asking to "verify" or "confirm" a previous dispatch — the system handles this

When you DO auto-apply, the "action" field must describe a CONCRETE change:
Good: "Append to copy-agent rules: Always cross-reference brand voice guide before submitting copy"
Bad: "Implement pre-validation checklist" (too vague)

ROUTING GUIDANCE for "action" field:
- For UI/dashboard issues: "dispatch_dashboard_agent: <description>"
- For backend/data/API issues (data not saving, sync failures, API errors, event broadcasting bugs): "dispatch_backend_agent: <description>"
- For agent behavior/quality issues: use update_prompt_template, requeue_task, etc.

${agentId === 'owner' ? `OWNER FEEDBACK RULES (this feedback comes directly from the business owner):
- NEVER reject or defer owner feedback — the owner is telling you something they personally experienced.
- Owner-reported bugs: ALWAYS set decision to "needs-approval" so the owner sees your proposed fix.
- For UI/dashboard issues (routing bugs, display problems, wrong screens): set action to "dispatch_dashboard_agent: <description of the issue>" — this routes it to the specialized Dashboard Agent.
- For backend/data/API issues (data not saving, sync failures, API errors, broken server logic, event broadcasting): set action to "dispatch_backend_agent: <description of the issue>" — this routes it to the specialized Backend Agent.
- For agent/prompt issues: use normal operations (template edits, task requeues).
- For business/strategy issues: "needs-approval" with a clear recommendation.` : ''}

Respond in JSON:
{
  "category": "bug" | "improvement" | "request" | "observation",
  "analysis": "2-3 sentences. Start with: does this feedback relate to achieving the floor's goal?",
  "decision": "auto-apply" | "needs-approval" | "deferred" | "rejected",
  "reasoning": "Why this decision. If rejecting, explain what evidence would change your mind.",
  "action": "Specific action to take. REQUIRED for auto-apply AND needs-approval (this is what gets executed when the owner approves). Only null for deferred/rejected.",
  "ownerSummary": "1 sentence for the owner dashboard",
  "systemWide": true | false,
  "systemWideReason": "Only if systemWide is true — explain why"
}`;

      const result = await callAnthropic(
        systemPrompt,
        [{ role: 'user', content: `Agent feedback from ${agentId}:\n\n${message}` }],
        'sonnet',
        512,
      );

      // Parse EVE's analysis
      let analysis: {
        category: string;
        analysis: string;
        decision: string;
        reasoning: string;
        action: string | null;
        ownerSummary: string;
        systemWide?: boolean;
        systemWideReason?: string;
      };

      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        analysis = JSON.parse(jsonMatch?.[0] || result.content);
      } catch {
        analysis = {
          category: 'observation',
          analysis: result.content,
          decision: 'needs-approval',
          reasoning: 'Could not parse structured response — escalating to owner.',
          action: null,
          ownerSummary: message.slice(0, 120),
        };
      }

      feedback.category = (analysis.category as AgentFeedback['category']) || 'observation';
      feedback.eveAnalysis = analysis.analysis;
      feedback.eveDecision = (analysis.decision as AgentFeedback['eveDecision']) || 'needs-approval';
      feedback.eveReasoning = analysis.reasoning;
      feedback.actionTaken = analysis.action;
      feedback.status = 'analyzed';
      feedback.analyzedAt = new Date();

      // Tag system-wide issues
      if (analysis.systemWide) {
        feedback.eveAnalysis += `\n\n🌐 SYSTEM-WIDE: ${analysis.systemWideReason || 'This improvement applies to all floors.'}`;
        // Record as a system learning so it persists across floors
        this.systemLearnings.push({
          id,
          sourceFloorId: floorId,
          learning: analysis.action || analysis.analysis,
          reason: analysis.systemWideReason || '',
          appliedAt: new Date(),
        });
        console.log(`[EVE] System-wide learning recorded from ${floorId}: ${analysis.action}`);
      }

      // Owner or FM feedback with agent dispatch: auto-execute (trusted sources)
      const trustedSource = agentId === 'owner' || agentId === 'floor-manager';
      const hasDispatch = analysis.action?.includes('dispatch_dashboard_agent') || analysis.action?.includes('dispatch_backend_agent');
      if (trustedSource && hasDispatch) {
        const agentType = analysis.action!.includes('dispatch_backend_agent') ? 'backend' : 'dashboard';
        feedback.eveDecision = 'auto-apply';
        feedback.status = 'applied';
        feedback.resolvedAt = new Date();
        console.log(`[EVE] ${agentId} report → auto-dispatching ${agentType} agent for ${id}`);
        this.eventBus.emit('feedback:applied', {
          floorId,
          feedbackId: id,
          action: analysis.action,
          systemWide: false,
        });
      }
      // Auto-apply low-risk changes
      else if (feedback.eveDecision === 'auto-apply') {
        feedback.status = 'applied';
        feedback.resolvedAt = new Date();
        console.log(`[EVE] Auto-applied feedback ${id}: ${analysis.action}`);
        this.eventBus.emit('feedback:applied', {
          floorId,
          feedbackId: id,
          action: analysis.action,
          systemWide: analysis.systemWide || false,
        });
      }
      // Escalate to owner
      else if (feedback.eveDecision === 'needs-approval') {
        this.eventBus.emit('approval:needed', {
          floorId,
          taskId: id,
          type: 'agent-feedback',
          summary: analysis.ownerSummary || analysis.analysis,
          systemWide: analysis.systemWide || false,
        });
      }

    } catch (err) {
      feedback.eveAnalysis = 'Analysis failed — escalating to owner for review.';
      feedback.eveDecision = 'needs-approval';
      feedback.eveReasoning = `Error: ${(err as Error).message}`;
      feedback.status = 'analyzed';
      feedback.analyzedAt = new Date();
      this.eventBus.emit('approval:needed', {
        floorId,
        taskId: id,
        type: 'agent-feedback',
        summary: message.slice(0, 120),
      });
    }

    this.persist().catch(() => {});
    return feedback;
  }

  approveFeedback(feedbackId: string): boolean {
    const fb = this.agentFeedbacks.get(feedbackId);
    if (!fb || fb.status !== 'analyzed') return false;
    fb.status = 'owner-approved';
    fb.resolvedAt = new Date();
    // Use actionTaken if available, fall back to analysis + message for context
    const action = fb.actionTaken || `Investigate and fix: ${fb.message.slice(0, 300)}`;
    this.eventBus.emit('feedback:applied', {
      floorId: fb.floorId,
      feedbackId,
      action,
    });
    this.persist().catch(() => {});
    return true;
  }

  rejectFeedback(feedbackId: string): boolean {
    const fb = this.agentFeedbacks.get(feedbackId);
    if (!fb || fb.status !== 'analyzed') return false;
    fb.status = 'owner-rejected';
    fb.resolvedAt = new Date();
    this.persist().catch(() => {});
    return true;
  }

  getAllFeedback(floorId?: string): AgentFeedback[] {
    return [...this.agentFeedbacks.values()].filter(
      fb => !floorId || fb.floorId === floorId,
    );
  }

  getPendingFeedback(floorId?: string): AgentFeedback[] {
    return [...this.agentFeedbacks.values()].filter(
      fb => fb.eveDecision === 'needs-approval' && fb.status === 'analyzed' && (!floorId || fb.floorId === floorId),
    );
  }

  getSystemLearnings() {
    return this.systemLearnings;
  }

  private setupListeners(): void {
    // Listen for task failures to track revision patterns
    this.eventBus.on('task:failed', (data) => {
      const perf = this.getOrCreatePerf(data.floorId, data.agentId, '');
      perf.revisions++;
      const reason = data.error.slice(0, 100);
      const count = perf.revisionReasons.get(reason) ?? 0;
      perf.revisionReasons.set(reason, count + 1);
    });

    // Listen for cost events to track efficiency
    this.eventBus.on('cost:recorded', (data) => {
      // Walk all performance entries for this floor and update cost
      for (const perf of this.performance.values()) {
        if (perf.floorId === data.floorId) {
          perf.totalCostCents += data.costCents;
        }
      }
    });
  }
}
