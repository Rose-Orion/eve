/**
 * Model Router — selects the appropriate model tier (Opus/Sonnet/Haiku)
 * per agent and task category.
 */

import type { AgentId, ModelRoutingConfig, ModelTier, TaskCategory } from '../config/types.js';

/** Default routing table per agent. Configurable via floor config overrides. */
const DEFAULT_ROUTING: Record<AgentId, ModelRoutingConfig> = {
  // Real agents
  'floor-manager':   { foundation: 'opus',   routine: 'opus',   review: 'opus',   escalation: 'opus' },
  'web-agent':       { foundation: 'sonnet', routine: 'sonnet', review: 'sonnet', escalation: 'opus' },
  'launch-agent':    { foundation: 'sonnet', routine: 'sonnet', review: 'sonnet', escalation: 'opus' },
  'ceo-mode':        { foundation: 'opus',   routine: 'opus',   review: 'opus',   escalation: 'opus' },

  // Virtual agents
  'brand-agent':         { foundation: 'opus',   routine: 'sonnet', review: 'sonnet', escalation: 'opus' },
  'strategy-agent':      { foundation: 'opus',   routine: 'sonnet', review: 'sonnet', escalation: 'opus' },
  'finance-agent':       { foundation: 'opus',   routine: 'sonnet', review: 'sonnet', escalation: 'opus' },
  'copy-agent':          { foundation: 'opus',   routine: 'sonnet', review: 'sonnet', escalation: 'opus' },
  'design-agent':        { foundation: 'opus',   routine: 'sonnet', review: 'opus',   escalation: 'opus' },
  'video-agent':         { foundation: 'opus',   routine: 'sonnet', review: 'opus',   escalation: 'opus' },
  'commerce-agent':      { foundation: 'sonnet', routine: 'sonnet', review: 'sonnet', escalation: 'opus' },
  'social-media-agent':  { foundation: 'sonnet', routine: 'sonnet', review: 'sonnet', escalation: 'sonnet' },
  'ads-agent':           { foundation: 'sonnet', routine: 'sonnet', review: 'sonnet', escalation: 'opus' },
  'analytics-agent':     { foundation: 'sonnet', routine: 'sonnet', review: 'haiku',  escalation: 'sonnet' },

  // System agents
  'dashboard-agent':     { foundation: 'sonnet', routine: 'sonnet', review: 'sonnet', escalation: 'sonnet' },
  'backend-agent':       { foundation: 'sonnet', routine: 'sonnet', review: 'sonnet', escalation: 'opus' },
  // 'owner' is a pseudo-agent representing the human owner in the AgentId union.
  // It's not dispatchable — this entry exists only so getModelTier() doesn't throw
  // when the orchestrator resolves model tiers for owner-assigned review tasks.
  'owner':               { foundation: 'opus',   routine: 'opus',   review: 'opus',   escalation: 'opus' },
};

export class ModelRouter {
  private overrides: Partial<Record<AgentId, Partial<ModelRoutingConfig>>> = {};

  /** Apply floor-level routing overrides. */
  setOverrides(overrides: Partial<Record<AgentId, Partial<ModelRoutingConfig>>>): void {
    this.overrides = overrides;
  }

  /** Get the model tier for a specific agent and task category. */
  getModelTier(agentId: AgentId, category: TaskCategory): ModelTier {
    const agentOverride = this.overrides[agentId];
    if (agentOverride?.[category]) {
      return agentOverride[category];
    }

    const defaults = DEFAULT_ROUTING[agentId];
    return defaults[category];
  }

  /** Get the full routing config for an agent (with overrides applied). */
  getRoutingConfig(agentId: AgentId): ModelRoutingConfig {
    const defaults = DEFAULT_ROUTING[agentId];
    const overrides = this.overrides[agentId] ?? {};
    return { ...defaults, ...overrides };
  }
}
