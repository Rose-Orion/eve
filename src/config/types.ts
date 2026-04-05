/** Core type definitions for the EVE Orchestrator */

// --- Agent Types ---

export type AgentId =
  | 'floor-manager'
  | 'web-agent'
  | 'launch-agent'
  | 'ceo-mode'
  | 'brand-agent'
  | 'strategy-agent'
  | 'finance-agent'
  | 'copy-agent'
  | 'design-agent'
  | 'video-agent'
  | 'commerce-agent'
  | 'social-media-agent'
  | 'ads-agent'
  | 'analytics-agent'
  | 'dashboard-agent'
  | 'backend-agent'
  | 'owner';

export type RealAgentId = 'floor-manager' | 'web-agent' | 'launch-agent' | 'ceo-mode';
export type VirtualAgentId = Exclude<AgentId, RealAgentId>;

export const REAL_AGENTS: readonly RealAgentId[] = ['floor-manager', 'web-agent', 'launch-agent', 'ceo-mode'];
export const VIRTUAL_AGENTS: readonly VirtualAgentId[] = [
  'brand-agent', 'strategy-agent', 'finance-agent', 'copy-agent',
  'design-agent', 'video-agent', 'commerce-agent', 'social-media-agent',
  'ads-agent', 'analytics-agent', 'dashboard-agent', 'backend-agent',
];

export function isRealAgent(id: AgentId): id is RealAgentId {
  return (REAL_AGENTS as readonly string[]).includes(id);
}

export function isVirtualAgent(id: AgentId): id is VirtualAgentId {
  return (VIRTUAL_AGENTS as readonly string[]).includes(id);
}

// --- Model Tiers ---

export type ModelTier = 'opus' | 'sonnet' | 'haiku';

export const MODEL_IDS: Record<ModelTier, string> = {
  opus: 'claude-opus-4-6',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
};

export type TaskCategory = 'foundation' | 'routine' | 'review' | 'escalation';

export interface ModelRoutingConfig {
  foundation: ModelTier;
  routine: ModelTier;
  review: ModelTier;
  escalation: ModelTier;
}

// --- Task Types ---

export type TaskStatus =
  | 'created'
  | 'queued'
  | 'dispatched'
  | 'working'
  | 'review'
  | 'completed'
  | 'failed'
  | 'retry'
  | 'escalated';

export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';

export type ReviewStatus = 'pending' | 'approved' | 'revision-requested' | 'rejected';

export interface Task {
  id: string;
  floorId: string;
  phaseNumber: number;
  assignedAgent: AgentId;
  modelTier: ModelTier;
  taskType: string;
  description: string;
  prompt: string;
  inputFiles: string[];
  outputFiles: string[];
  dependsOn: string[];
  blockedBy: string[];
  status: TaskStatus;
  priority: TaskPriority;
  attempts: number;
  maxAttempts: number;
  estimatedCostCents: number;
  actualCostCents: number;
  createdAt: Date;
  dispatchedAt: Date | null;
  completedAt: Date | null;
  result: string | null;
  reviewStatus: ReviewStatus;
  reviewFeedback: string | null;
  /** Revision note appended on anti-slop or format retry. Kept separate so the original prompt is preserved. */
  revisionNote: string | null;
  /** Cryptographic approval token (HMAC). Set when owner approves a high-risk task. Verified by immutable rules. */
  approvalToken: string | null;
}

// --- Floor Types ---

export type FloorStatus = 'planning' | 'review' | 'building' | 'staging' | 'launched' | 'operating' | 'paused' | 'archived';

export type BrandState = 'pre-foundation' | 'foundation-review' | 'foundation-approved' | 'brand-revision';

export interface SelectedBrand {
  index: number;
  name: string;
  tagline: string;
  personality: string;
  voiceAttributes: string[];
}

/**
 * FloorTheme — extracted from brand-visual-system deliverable.
 * Injected into floor config so the Dashboard and floor UI can apply
 * CSS variables, font choices, and palette from the brand system.
 */
export interface FloorTheme {
  primaryColor: string;       // e.g. "#6C3BE2"
  secondaryColor: string;     // e.g. "#FF6B35"
  accentColor?: string;
  backgroundColor?: string;
  textColor?: string;
  headingFont: string;        // e.g. "Space Grotesk"
  bodyFont: string;           // e.g. "Inter"
  palette: Array<{ name: string; hex: string }>;
  logoDescription?: string;
  tagline?: string;
  voicePrinciples?: string;
  extractedAt: string;        // ISO timestamp
}

export interface Floor {
  id: string;
  name: string;
  slug: string;
  goal: string;
  status: FloorStatus;
  brandState: BrandState;
  selectedBrand: SelectedBrand | null;
  /**
   * themeConfig — populated after brand-visual-system task completes.
   * Contains extracted colors, fonts, and palette for UI injection.
   * Stored as JSONB in the floors table under `theme_config` column.
   */
  themeConfig: FloorTheme | null;
  budgetCeilingCents: number;
  spentCents: number;
  currentPhase: number;
  growthCycle: number;
  config: FloorConfig;
  createdAt: Date;
}

export interface FloorConfig {
  businessType: 'ecommerce' | 'service' | 'content' | 'personal-brand';
  activeAgents: AgentId[];
  modelRouting: Partial<Record<AgentId, Partial<ModelRoutingConfig>>>;
}

// --- PromptBuilder Types ---

export interface PromptSection {
  tag: string;
  content: string;
  tokenCount: number;
  priority: number; // lower = higher priority (kept when trimming)
}

export interface AssembledPrompt {
  systemPrompt: string;
  sections: PromptSection[];
  totalTokens: number;
  model: string;
  maxTokens: number;
  metadata: PromptMetadata;
}

export interface PromptMetadata {
  agentId: AgentId;
  floorId: string;
  taskId: string;
  modelTier: ModelTier;
  brandStateAtBuild: BrandState;
  voiceSampleLoaded: boolean;
  examplesLoaded: number;
  trimmedSections: string[];
}

export interface AgentTemplate {
  agentId: AgentId;
  role: string;
  expertise: string;
  rules: string;
  boundaries: string;
  outputFormat: string;
  brandContextFields: string[];
  usesVoiceSample: boolean;
  usesGeneratedKnowledge: boolean;
  antiSlopEnabled: boolean;
  /** When true, agent can emit <eve_actions> blocks for real-world execution */
  actionsEnabled?: boolean;
  /** Instructions injected into agent prompt explaining available action specs */
  actionInstructions?: string;
}

export interface BrandContext {
  foundationPackage: string;
  voiceSample: string | null;
  version: number;
}

export interface GoldStandardExample {
  taskType: string;
  content: string;
  approvedAt: Date;
  tokenCount: number;
}

// --- Agent Output Status ---

export interface AgentOutputStatus {
  status: 'working' | 'complete' | 'blocked' | 'needs_review' | 'error';
  outputFiles: string[];
  needsReviewBy: AgentId | null;
  blockedBy: string | null;
  blockedReason: string | null;
  nextAction: string | null;
  estimatedTurnsRemaining: number | null;
}

// --- Concurrency ---

export interface ConcurrencyLimits {
  maxConcurrentAgents: number;
  maxConcurrentOpus: number;
  maxConcurrentSonnet: number;
  maxConcurrentHaiku: number;
  maxAgentsPerFloor: number;
  minDelayBetweenDispatchMs: number;
}

export const DEFAULT_CONCURRENCY: ConcurrencyLimits = {
  maxConcurrentAgents: 4,
  maxConcurrentOpus: 2,
  maxConcurrentSonnet: 3,
  maxConcurrentHaiku: 5,
  maxAgentsPerFloor: 3,
  minDelayBetweenDispatchMs: 2000,
};

// --- Budget ---

export interface BudgetAlert {
  floorId: string;
  threshold: number; // 0.5, 0.75, 0.9
  spentCents: number;
  ceilingCents: number;
  timestamp: Date;
}

// --- Token Budget ---

export const TOKEN_BUDGET = {
  ceiling: 8000,
  sections: {
    role: { min: 300, max: 700, priority: 1 },
    rules: { min: 200, max: 400, priority: 1 },
    outputFormat: { min: 100, max: 200, priority: 1 },
    task: { min: 800, max: 2000, priority: 1 },
    brandContext: { min: 300, max: 800, priority: 3 },
    expertise: { min: 400, max: 1200, priority: 4 },
    examples: { min: 0, max: 1000, priority: 5 },
    workspace: { min: 0, max: 500, priority: 6 },
    boundaries: { min: 50, max: 200, priority: 1 },
  },
} as const;

// --- Anti-Slop ---

export const ANTI_SLOP_PHRASES = [
  'elevate', 'unlock', 'leverage', 'delve', 'game-changer',
  'streamline', 'cutting-edge', 'revolutionize', 'unleash',
  'empower', 'synergy', 'holistic', 'paradigm shift',
  "in today's fast-paced world", 'dive deep', 'take it to the next level',
  'seamlessly', 'supercharge', 'disrupt', 'next-level',
] as const;
