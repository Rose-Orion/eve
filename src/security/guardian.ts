/**
 * Guardian — Pre-execution verification for every dispatch.
 * Checks: agent allowed, action permitted, budget available, safety rules.
 */

import type { AgentId, ModelTier } from '../config/types.js';
import { ANTI_SLOP_PHRASES } from '../config/types.js';
import type { ConcurrencyManager } from '../orchestrator/concurrency.js';
import type { BudgetEnforcer } from './budget-enforcer.js';
import { IMMUTABLE_RULES } from './immutable-rules.js';

// Task types that involve real money movement — require owner approval before dispatch
const MONEY_TASK_TYPES = ['spend-ad-budget', 'make-purchase', 'charge-customer', 'place-order', 'transfer-funds'];

export interface GuardianCheck {
  taskId: string;
  floorId: string;
  agentId: AgentId;
  modelTier: ModelTier;
  estimatedCostCents: number;
  prompt: string;
  taskType?: string; // optional — used for money-action check
  approvalToken?: string; // optional — cryptographic approval token for high-risk actions
}

export interface GuardianResult {
  approved: boolean;
  violations: string[];
  warnings: string[];
}

export class Guardian {
  constructor(
    private concurrency: ConcurrencyManager,
    private budget: BudgetEnforcer,
  ) {}

  /** Run all pre-execution checks. */
  verify(check: GuardianCheck): GuardianResult {
    const violations: string[] = [];
    const warnings: string[] = [];

    // 1. Money-action safety check — block task types that move real money without owner approval
    if (check.taskType && MONEY_TASK_TYPES.includes(check.taskType)) {
      violations.push(`Money-action task "${check.taskType}" requires explicit owner approval before dispatch`);
    }

    // 2. Concurrency check
    const canDispatch = this.concurrency.canDispatch(check.floorId, check.modelTier);
    if (!canDispatch.allowed) {
      violations.push(`Concurrency: ${canDispatch.reason}`);
    }

    // 3. Budget check
    const canAfford = this.budget.canAfford(check.floorId, check.estimatedCostCents);
    if (!canAfford.allowed) {
      violations.push(`Budget: ${canAfford.reason}`);
    }

    // 4. Prompt safety checks
    const safetyResult = this.checkPromptSafety(check.prompt);
    violations.push(...safetyResult.violations);
    warnings.push(...safetyResult.warnings);

    // 5. Immutable rules check
    const rulesResult = this.checkImmutableRules(check);
    violations.push(...rulesResult);

    return {
      approved: violations.length === 0,
      violations,
      warnings,
    };
  }

  /** Check output for anti-slop phrases. Returns found violations. */
  checkAntiSlop(content: string): string[] {
    const lower = content.toLowerCase();
    return ANTI_SLOP_PHRASES.filter(phrase => lower.includes(phrase));
  }

  private checkPromptSafety(prompt: string): { violations: string[]; warnings: string[] } {
    const violations: string[] = [];
    const warnings: string[] = [];

    // Check for API keys
    if (/sk-[a-zA-Z0-9]{20,}/.test(prompt)) {
      violations.push('Prompt contains what appears to be an API key');
    }

    // Check for common PII patterns
    if (/\b\d{3}-\d{2}-\d{4}\b/.test(prompt)) {
      violations.push('Prompt contains what appears to be a SSN');
    }

    // Check for credit card patterns
    if (/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/.test(prompt)) {
      violations.push('Prompt contains what appears to be a credit card number');
    }

    // Warn if prompt is very large
    if (prompt.length > 50_000) {
      warnings.push('Prompt is unusually large (>50K chars)');
    }

    return { violations, warnings };
  }

  private checkImmutableRules(check: GuardianCheck): string[] {
    const violations: string[] = [];

    // Verify against each immutable rule
    for (const rule of IMMUTABLE_RULES) {
      const result = rule.check(check);
      if (!result.pass) {
        violations.push(`Immutable rule "${rule.name}": ${result.reason}`);
      }
    }

    return violations;
  }

  /**
   * Check agent output for PII patterns. Returns list of violations found.
   * Called after task completion to redact PII before persistence.
   */
  checkOutputPII(content: string): string[] {
    const violations: string[] = [];

    // Email addresses
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = content.match(emailPattern) ?? [];
    // Filter out common non-PII emails (example.com, brand domains)
    const realEmails = emails.filter(e => !e.endsWith('@example.com') && !e.endsWith('@brand.com'));
    if (realEmails.length > 0) violations.push(`Email addresses found: ${realEmails.length}`);

    // Phone numbers (US format)
    if (/(\+1|1)?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(content)) {
      violations.push('Phone number pattern detected');
    }

    // SSN
    if (/\b\d{3}-\d{2}-\d{4}\b/.test(content)) {
      violations.push('SSN pattern detected');
    }

    // Credit card numbers (basic Luhn-compatible patterns)
    if (/\b(?:\d{4}[-\s]?){3}\d{4}\b/.test(content)) {
      violations.push('Credit card number pattern detected');
    }

    // API keys (common patterns)
    if (/(?:sk|pk)[-_](?:live|test)[-_][a-zA-Z0-9]{20,}/.test(content)) {
      violations.push('API key pattern detected');
    }

    return violations;
  }
}
