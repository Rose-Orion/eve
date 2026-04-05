/**
 * ImmutableRules — 10 safety rules that NEVER change.
 * These are hard-coded and cannot be overridden by any configuration.
 */

import type { GuardianCheck } from './guardian.js';
import { verifyApprovalToken } from './approval-token.js';

export interface ImmutableRule {
  name: string;
  description: string;
  check: (context: GuardianCheck) => { pass: boolean; reason: string };
}

// Agents allowed to communicate directly with the owner
const OWNER_CONTACT_AGENTS = new Set(['floor-manager', 'ceo-mode']);

// Financial transaction keywords that require explicit owner approval marker.
// NOTE: Only match imperative transaction phrases — NOT descriptive/marketing uses
// of words like "purchase". The MONEY_TASK_TYPES check in Guardian.verify() already
// blocks actual money-movement task types (spend-ad-budget, make-purchase, etc.).
const TRANSACTION_KEYWORDS = /\b(buy now|execute payment|transfer funds|withdraw funds|place order|submit order|charge card|process payment)\b/i;

export const IMMUTABLE_RULES: ImmutableRule[] = [
  {
    name: 'no-pii-in-prompts',
    description: 'Never include customer PII in agent prompts',
    check: (ctx) => {
      const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(ctx.prompt);
      const hasPhone = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/.test(ctx.prompt);
      const hasSsn = /\b\d{3}-\d{2}-\d{4}\b/.test(ctx.prompt);
      if (hasEmail || hasPhone || hasSsn) {
        return { pass: false, reason: 'Prompt contains customer PII (email, phone, or SSN)' };
      }
      return { pass: true, reason: '' };
    },
  },
  {
    name: 'no-cross-floor-access',
    description: 'Agents can only access data within their assigned floor',
    check: (ctx) => {
      // Detect UUID patterns in the prompt that don't match the current floor
      const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
      const foundUuids = ctx.prompt.match(uuidPattern) ?? [];
      const foreignUuids = foundUuids.filter(id => id.toLowerCase() !== ctx.floorId.toLowerCase());
      if (foreignUuids.length > 0) {
        return { pass: false, reason: `Prompt references ${foreignUuids.length} foreign floor ID(s)` };
      }
      return { pass: true, reason: '' };
    },
  },
  {
    name: 'budget-ceiling-enforced',
    description: 'Never exceed floor budget ceiling without human approval',
    check: (_ctx) => {
      // Enforced by BudgetEnforcer.canAfford() before dispatch reaches this rule.
      // Guardian.verify() calls budget.canAfford() before checkImmutableRules().
      return { pass: true, reason: '' };
    },
  },
  {
    name: 'no-unapproved-transactions',
    description: 'No financial transactions without human approval',
    check: (ctx) => {
      // Block prompts that instruct execution of financial transactions
      // without a valid cryptographic approval token
      if (TRANSACTION_KEYWORDS.test(ctx.prompt) && !verifyApprovalToken(ctx.approvalToken ?? '')) {
        return { pass: false, reason: 'Prompt instructs financial transaction without valid approval token' };
      }
      return { pass: true, reason: '' };
    },
  },
  {
    name: 'no-external-commands',
    description: 'Agents cannot execute commands outside their project directory',
    check: (ctx) => {
      // Path traversal detection
      if (ctx.prompt.includes('../../') || ctx.prompt.includes('/etc/') || ctx.prompt.includes('/usr/')) {
        return { pass: false, reason: 'Prompt references paths outside project directory' };
      }
      // Dangerous shell patterns
      if (/\b(rm\s+-rf|sudo\s+|chmod\s+777|curl\s+.*\|\s*sh)\b/.test(ctx.prompt)) {
        return { pass: false, reason: 'Prompt contains dangerous shell command pattern' };
      }
      return { pass: true, reason: '' };
    },
  },
  {
    name: 'human-approval-gates',
    description: 'Gate 1 (Foundation), Gate 2 (Launch), Gate 3 (Ads) always require human approval',
    check: (_ctx) => {
      // Enforced at PhaseManager.completePhase() — phases with requiresGate=true
      // transition to 'gate-waiting' and emit approval:needed before allowing progression.
      // This rule cannot be further verified from prompt content alone.
      return { pass: true, reason: '' };
    },
  },
  {
    name: 'no-credential-exposure',
    description: 'Never expose API keys, tokens, or credentials in agent outputs',
    check: (ctx) => {
      if (/sk-[a-zA-Z0-9]{20,}/.test(ctx.prompt)) {
        return { pass: false, reason: 'Prompt contains what appears to be an Anthropic API key' };
      }
      if (/Bearer\s+[a-zA-Z0-9._-]{20,}/.test(ctx.prompt)) {
        return { pass: false, reason: 'Prompt contains a Bearer token' };
      }
      if (/\b[A-Za-z0-9+/]{40,}={0,2}\b/.test(ctx.prompt) && ctx.prompt.toLowerCase().includes('secret')) {
        return { pass: false, reason: 'Prompt may contain a base64-encoded secret' };
      }
      return { pass: true, reason: '' };
    },
  },
  {
    name: 'escalate-when-uncertain',
    description: 'Agents must escalate to Floor Manager when uncertain about a task',
    check: (ctx) => {
      // Detect if the TASK INSTRUCTION (not brand context) signals the task is unclear.
      // Only match explicit task-level uncertainty phrases — NOT brand copy that merely
      // discusses uncertainty as a concept (e.g. "When we don't know something, we say so"
      // is brand voice, not task uncertainty).
      // FIX: Restrict to task-instruction-level phrases. Brand context often contains words
      // like "don't know" in marketing/voice copy, causing false positives that permanently
      // block dispatch.
      const uncertaintySignals = /\b(task is unclear|instructions are ambiguous|conflicting instructions|i don't know how to|not sure how to proceed|unable to determine the task)\b/i;
      if (uncertaintySignals.test(ctx.prompt) && !OWNER_CONTACT_AGENTS.has(ctx.agentId)) {
        return { pass: false, reason: 'Task signals uncertainty — route to Floor Manager first' };
      }
      return { pass: true, reason: '' };
    },
  },
  {
    name: 'no-direct-owner-contact',
    description: 'Only Floor Manager and CEO Mode communicate directly with the owner',
    check: (ctx) => {
      if (OWNER_CONTACT_AGENTS.has(ctx.agentId)) return { pass: true, reason: '' };

      // Detect prompts that instruct a non-FM agent to address the owner directly
      const ownerAddressPattern = /\b(dear owner|hi owner|hello owner|message the owner|notify the owner|send to owner|tell the owner|contact the user|email the user)\b/i;
      if (ownerAddressPattern.test(ctx.prompt)) {
        return { pass: false, reason: `${ctx.agentId} cannot contact owner directly — route through Floor Manager` };
      }
      return { pass: true, reason: '' };
    },
  },
  {
    name: 'immutable-rules-cannot-change',
    description: 'These 10 rules are hard-coded and cannot be overridden',
    check: (_ctx) => {
      // Self-check: verify this array has the expected number of rules
      if (IMMUTABLE_RULES.length !== 10) {
        return { pass: false, reason: `Rule count is ${IMMUTABLE_RULES.length}, expected 10 — rules may have been tampered with` };
      }
      return { pass: true, reason: '' };
    },
  },
];
