import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Guardian, type GuardianCheck } from '../src/security/guardian.js';
import { BudgetEnforcer } from '../src/security/budget-enforcer.js';
import { ConcurrencyManager } from '../src/orchestrator/concurrency.js';
import { EventBus } from '../src/orchestrator/event-bus.js';

describe('Guardian', () => {
  let guardian: Guardian;
  let budget: BudgetEnforcer;
  let concurrency: ConcurrencyManager;
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    budget = new BudgetEnforcer(eventBus);
    concurrency = new ConcurrencyManager();
    guardian = new Guardian(concurrency, budget);

    // Initialize budget for testing
    budget.initFloor('floor-1', 100000); // $1000 ceiling
  });

  it('should approve safe dispatch within budget', () => {
    const check: GuardianCheck = {
      taskId: 'task-1',
      floorId: 'floor-1',
      agentId: 'copy-agent',
      modelTier: 'sonnet',
      estimatedCostCents: 1000,
      prompt: 'Write a product description',
    };

    const result = guardian.verify(check);

    expect(result.approved).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('should block dispatch when over budget', () => {
    budget.recordCost('floor-1', 95000); // Spend $950
    const check: GuardianCheck = {
      taskId: 'task-1',
      floorId: 'floor-1',
      agentId: 'copy-agent',
      modelTier: 'sonnet',
      estimatedCostCents: 10000, // Try to spend $100 more
      prompt: 'Write a product description',
    };

    const result = guardian.verify(check);

    expect(result.approved).toBe(false);
    expect(result.violations.some(v => v.includes('Budget'))).toBe(true);
  });

  it('should detect API keys in prompt', () => {
    const check: GuardianCheck = {
      taskId: 'task-1',
      floorId: 'floor-1',
      agentId: 'copy-agent',
      modelTier: 'opus',
      estimatedCostCents: 1000,
      prompt: 'Use this API key: sk-1234567890abcdefghij to authenticate',
    };

    const result = guardian.verify(check);

    expect(result.approved).toBe(false);
    expect(result.violations.some(v => v.includes('API key'))).toBe(true);
  });

  it('should detect SSN patterns in prompt', () => {
    const check: GuardianCheck = {
      taskId: 'task-1',
      floorId: 'floor-1',
      agentId: 'copy-agent',
      modelTier: 'sonnet',
      estimatedCostCents: 1000,
      prompt: 'Customer SSN: 123-45-6789',
    };

    const result = guardian.verify(check);

    expect(result.approved).toBe(false);
    expect(result.violations.some(v => v.includes('SSN'))).toBe(true);
  });

  it('should detect credit card patterns', () => {
    const check: GuardianCheck = {
      taskId: 'task-1',
      floorId: 'floor-1',
      agentId: 'copy-agent',
      modelTier: 'sonnet',
      estimatedCostCents: 1000,
      prompt: 'Credit card: 4111-1111-1111-1111',
    };

    const result = guardian.verify(check);

    expect(result.approved).toBe(false);
    expect(result.violations.some(v => v.includes('credit card'))).toBe(true);
  });

  it('should check for anti-slop phrases', () => {
    const phrases = guardian.checkAntiSlop(
      'This solution will elevate and unlock cutting-edge value to leverage the paradigm',
    );

    expect(phrases.length).toBeGreaterThan(0);
    expect(phrases).toContain('elevate');
  });

  it('should not report violations for clean prompt', () => {
    const check: GuardianCheck = {
      taskId: 'task-1',
      floorId: 'floor-1',
      agentId: 'copy-agent',
      modelTier: 'haiku',
      estimatedCostCents: 500,
      prompt: 'Write a clear and helpful product description for a coffee maker',
    };

    const result = guardian.verify(check);

    expect(result.approved).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('should detect PII in output - email addresses', () => {
    const violations = guardian.checkOutputPII('Contact: john@realcompany.com for details');

    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some(v => v.includes('Email'))).toBe(true);
  });

  it('should not flag example.com emails as PII', () => {
    const violations = guardian.checkOutputPII('Contact: test@example.com for details');

    // Should not include example.com in violations
    expect(violations.some(v => v.includes('test@example.com'))).toBe(false);
  });

  it('should detect phone numbers in output', () => {
    const violations = guardian.checkOutputPII('Call us at (555) 123-4567');

    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some(v => v.includes('Phone'))).toBe(true);
  });

  it('should warn on very large prompts', () => {
    const largePrompt = 'x'.repeat(60000); // 60K characters
    const check: GuardianCheck = {
      taskId: 'task-1',
      floorId: 'floor-1',
      agentId: 'copy-agent',
      modelTier: 'opus',
      estimatedCostCents: 1000,
      prompt: largePrompt,
    };

    const result = guardian.verify(check);

    expect(result.warnings.some(w => w.includes('unusually large'))).toBe(true);
  });

  it('should block money-action tasks without approval', () => {
    const check: GuardianCheck = {
      taskId: 'task-1',
      floorId: 'floor-1',
      agentId: 'ads-agent',
      modelTier: 'opus',
      estimatedCostCents: 50000,
      prompt: 'Create and launch ad campaign',
      taskType: 'spend-ad-budget',
    };

    const result = guardian.verify(check);

    expect(result.approved).toBe(false);
    expect(result.violations.some(v => v.includes('Money-action'))).toBe(true);
  });
});
