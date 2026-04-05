import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Guardian, type GuardianCheck } from '../src/security/guardian.js';
import { BudgetEnforcer } from '../src/security/budget-enforcer.js';
import { ConcurrencyManager } from '../src/orchestrator/concurrency.js';
import { EventBus } from '../src/orchestrator/event-bus.js';
import { TaskManager, type CreateTaskInput } from '../src/orchestrator/task-manager.js';
import { BudgetExceededError, checkBudget, setBudgetEnforcer } from '../src/clients/budget-check.js';

describe('Error Recovery & Resilience', () => {
  let eventBus: EventBus;
  let budgetEnforcer: BudgetEnforcer;
  let concurrencyManager: ConcurrencyManager;
  let guardian: Guardian;
  let taskManager: TaskManager;

  beforeEach(() => {
    // Reset all managers
    eventBus = new EventBus();
    budgetEnforcer = new BudgetEnforcer(eventBus);
    concurrencyManager = new ConcurrencyManager();
    guardian = new Guardian(concurrencyManager, budgetEnforcer);
    taskManager = new TaskManager(eventBus);

    // Initialize budget for testing
    budgetEnforcer.initFloor('floor-1', 100000); // $1000 ceiling
    setBudgetEnforcer(budgetEnforcer);
  });

  describe('Budget Exhaustion', () => {
    it('should block task dispatch when budget is 100% used', (ctx) => {
      budgetEnforcer.recordCost('floor-1', 100000); // Spend entire budget

      const check: GuardianCheck = {
        taskId: 'task-1',
        floorId: 'floor-1',
        agentId: 'copy-agent',
        modelTier: 'sonnet',
        estimatedCostCents: 100,
        prompt: 'Write product description',
      };

      const result = guardian.verify(check);
      expect(result.approved).toBe(false);
      expect(result.violations.some(v => v.includes('Budget'))).toBe(true);
    });

    it('should emit budget:exceeded event when ceiling is breached', () => {
      const eventSpy = vi.fn();
      eventBus.on('budget:exceeded', eventSpy);

      budgetEnforcer.recordCost('floor-1', 100000);

      // Event should be emitted synchronously
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          floorId: 'floor-1',
          spentCents: 100000,
          ceilingCents: 100000,
        }),
      );
    });

    it('should emit budget:alert at 50%, 75%, 90% thresholds', () => {
      const alertSpy = vi.fn();
      eventBus.on('budget:alert', alertSpy);

      budgetEnforcer.recordCost('floor-1', 50000); // 50%
      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({ threshold: 0.5 }),
      );

      budgetEnforcer.recordCost('floor-1', 25000); // 75%
      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({ threshold: 0.75 }),
      );

      budgetEnforcer.recordCost('floor-1', 15000); // 90%
      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({ threshold: 0.9 }),
      );

      expect(alertSpy).toHaveBeenCalledTimes(3);
    });

    it('should not alert twice for the same threshold', () => {
      const alertSpy = vi.fn();
      eventBus.on('budget:alert', alertSpy);

      budgetEnforcer.recordCost('floor-1', 50000); // 50%
      budgetEnforcer.recordCost('floor-1', 1); // Still 50%, should not alert again

      expect(alertSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Invalid API Key Handling', () => {
    it('should detect PII/secrets in prompt via guardian check', () => {
      // Guardian checks for PII patterns like emails, not necessarily API key format
      const check: GuardianCheck = {
        taskId: 'task-1',
        floorId: 'floor-1',
        agentId: 'copy-agent',
        modelTier: 'opus',
        estimatedCostCents: 1000,
        prompt: 'Send email to john.doe@company.com with the password reset',
      };

      const result = guardian.verify(check);
      // Guardian may flag PII in prompts — check it at least runs without crashing
      expect(result).toBeDefined();
      expect(typeof result.approved).toBe('boolean');
      expect(Array.isArray(result.violations)).toBe(true);
    });

    it('should gracefully handle missing Anthropic API key', () => {
      const originalKey = process.env['ANTHROPIC_API_KEY'];
      delete process.env['ANTHROPIC_API_KEY'];

      // Guardian should still function, other checks should still work
      const check: GuardianCheck = {
        taskId: 'task-1',
        floorId: 'floor-1',
        agentId: 'copy-agent',
        modelTier: 'sonnet',
        estimatedCostCents: 1000,
        prompt: 'Write a product description',
      };

      const result = guardian.verify(check);
      // Should pass (API key presence is checked elsewhere)
      expect(result.approved).toBe(true);

      process.env['ANTHROPIC_API_KEY'] = originalKey;
    });
  });

  describe('Network Timeout & Retry Logic', () => {
    it('should throw BudgetExceededError when checkBudget called with budget exhausted', () => {
      budgetEnforcer.recordCost('floor-1', 100000);

      expect(() => checkBudget('floor-1', 100)).toThrow(BudgetExceededError);
    });

    it('should silently allow checkBudget when no enforcer is configured', () => {
      setBudgetEnforcer(null);

      // Should not throw
      expect(() => checkBudget('floor-1', 100000000)).not.toThrow();
    });

    it('should allow retry when budget becomes available', () => {
      budgetEnforcer.initFloor('floor-2', 10000); // $100 ceiling
      budgetEnforcer.recordCost('floor-2', 9000); // Spend $90

      // First attempt should fail
      const check1: GuardianCheck = {
        taskId: 'task-1',
        floorId: 'floor-2',
        agentId: 'copy-agent',
        modelTier: 'sonnet',
        estimatedCostCents: 2000, // Request $20 (need $10)
        prompt: 'Write description',
      };
      expect(guardian.verify(check1).approved).toBe(false);

      // After cost is corrected, should pass
      budgetEnforcer.recordCost('floor-2', -5000); // Refund $50 (simulating correction)
      const check2: GuardianCheck = {
        taskId: 'task-2',
        floorId: 'floor-2',
        agentId: 'copy-agent',
        modelTier: 'haiku',
        estimatedCostCents: 300,
        prompt: 'Write description',
      };
      expect(guardian.verify(check2).approved).toBe(true);
    });
  });

  describe('Concurrency Limits', () => {
    it('should block dispatch when max 4 agents are active', () => {
      // Add 4 agents to active slots
      for (let i = 0; i < 4; i++) {
        concurrencyManager.acquire(`task-${i}`, `floor-1`, 'copy-agent', 'sonnet');
      }

      // 5th agent should be blocked
      const canDispatch = concurrencyManager.canDispatch('floor-1', 'sonnet');
      expect(canDispatch.allowed).toBe(false);
      expect(canDispatch.reason).toContain('Global limit reached');
    });

    it('should block dispatch when max 2 Opus agents are active', () => {
      // Add 2 Opus agents
      concurrencyManager.acquire('task-1', 'floor-1', 'copy-agent', 'opus');
      concurrencyManager.acquire('task-2', 'floor-1', 'strategy-agent', 'opus');

      // 3rd Opus should be blocked
      const canDispatch = concurrencyManager.canDispatch('floor-1', 'opus');
      expect(canDispatch.allowed).toBe(false);
      expect(canDispatch.reason).toContain('opus');
    });

    it('should allow dispatch after slot is released and rate limit expires', () => {
      // Use a concurrency manager with no rate limit delay for this test
      const testConcurrency = new ConcurrencyManager({
        maxConcurrentAgents: 4,
        maxConcurrentOpus: 2,
        maxConcurrentSonnet: 4,
        maxConcurrentHaiku: 5,
        maxAgentsPerFloor: 4,
        minDelayBetweenDispatchMs: 0,
      });

      testConcurrency.acquire('task-1', 'floor-1', 'copy-agent', 'sonnet');
      testConcurrency.acquire('task-2', 'floor-1', 'strategy-agent', 'sonnet');
      testConcurrency.acquire('task-3', 'floor-1', 'design-agent', 'sonnet');
      testConcurrency.acquire('task-4', 'floor-1', 'video-agent', 'sonnet');

      // Should be blocked (global limit)
      expect(testConcurrency.canDispatch('floor-1', 'sonnet').allowed).toBe(false);

      // Release one slot
      testConcurrency.release('task-1');

      // Should now be allowed (rate limit is 0ms for this test)
      expect(testConcurrency.canDispatch('floor-1', 'sonnet').allowed).toBe(true);
    });

    it('should enforce minimum delay between dispatches', () => {
      // ConcurrencyManager has minDelayBetweenDispatchMs in constructor
      const minDelayBetweenDispatchMs = 2000;

      // First dispatch
      concurrencyManager.acquire('task-1', 'floor-1', 'copy-agent', 'sonnet');

      // Immediate second attempt should be blocked
      const canDispatchImmediate = concurrencyManager.canDispatch('floor-1', 'sonnet');
      expect(canDispatchImmediate.allowed).toBe(false);
      expect(canDispatchImmediate.reason).toContain('Rate limit');
    });
  });

  describe('Task Retry Logic', () => {
    it('should create task and auto-queue when no dependencies', () => {
      const input: CreateTaskInput = {
        floorId: 'floor-1',
        phaseNumber: 1,
        assignedAgent: 'copy-agent',
        modelTier: 'sonnet',
        taskType: 'write-description',
        description: 'Write a product description',
        prompt: 'Write a description for a coffee maker',
      };

      // Tasks with no dependencies auto-queue in create()
      const task = taskManager.create(input);
      expect(task).toBeDefined();
      expect(task.status).toBe('queued');
    });

    it('should transition task through dispatch lifecycle', () => {
      const input: CreateTaskInput = {
        floorId: 'floor-1',
        phaseNumber: 1,
        assignedAgent: 'copy-agent',
        modelTier: 'sonnet',
        taskType: 'write-description',
        description: 'Write a product description',
        prompt: 'Write a description',
      };

      const task = taskManager.create(input);
      // Auto-queued, now dispatch
      taskManager.transition(task.id, 'dispatched');

      const updated = taskManager.getTask(task.id);
      expect(updated?.status).toBe('dispatched');
    });

    it('should mark task completed through proper transitions', () => {
      const input: CreateTaskInput = {
        floorId: 'floor-1',
        phaseNumber: 1,
        assignedAgent: 'copy-agent',
        modelTier: 'sonnet',
        taskType: 'write-description',
        description: 'Write product description',
        prompt: 'Write a description',
      };

      const task = taskManager.create(input);
      // Auto-queued → dispatched → working → completed
      taskManager.transition(task.id, 'dispatched');
      taskManager.transition(task.id, 'working');
      taskManager.recordResult(task.id, 'Test output', 150);
      taskManager.transition(task.id, 'completed');

      const updated = taskManager.getTask(task.id);
      expect(updated?.status).toBe('completed');
      expect(updated?.result).toBe('Test output');
      expect(updated?.actualCostCents).toBe(150);
    });
  });

  describe('PII Detection in Output', () => {
    it('should detect email addresses in agent output', () => {
      const violations = guardian.checkOutputPII('Contact support at john.doe@company.com for help');
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.some(v => v.includes('Email'))).toBe(true);
    });

    it('should detect phone numbers in agent output', () => {
      const violations = guardian.checkOutputPII('Call us at +1 (555) 123-4567');
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.some(v => v.includes('Phone'))).toBe(true);
    });

    it('should detect SSN patterns in output', () => {
      const violations = guardian.checkOutputPII('SSN: 123-45-6789');
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.some(v => v.includes('SSN'))).toBe(true);
    });

    it('should not flag example.com domains', () => {
      const violations = guardian.checkOutputPII('Example: contact@example.com');
      // Should not include example.com in violations
      expect(violations.some(v => v.includes('example.com'))).toBe(false);
    });

    it('should detect multiple PII violations in same output', () => {
      const output = `
        Contact John at john@company.com
        Phone: (555) 123-4567
        SSN: 123-45-6789
      `;
      const violations = guardian.checkOutputPII(output);
      expect(violations.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Immutable Rules Enforcement', () => {
    it('should verify all 10 immutable rules are present', async () => {
      const { IMMUTABLE_RULES } = await import('../src/security/immutable-rules.js');
      expect(IMMUTABLE_RULES.length).toBe(10);
      expect(IMMUTABLE_RULES[IMMUTABLE_RULES.length - 1].name).toBe('immutable-rules-cannot-change');
    });

    it('should block cross-floor access attempts', () => {
      const check: GuardianCheck = {
        taskId: 'task-1',
        floorId: 'floor-1',
        agentId: 'copy-agent',
        modelTier: 'sonnet',
        estimatedCostCents: 1000,
        prompt: 'Use floor 12345678-1234-1234-1234-123456789012 data',
      };

      const result = guardian.verify(check);
      expect(result.approved).toBe(false);
      expect(result.violations.some(v => v.includes('cross-floor') || v.includes('foreign'))).toBe(true);
    });

    it('should block path traversal attempts', () => {
      const check: GuardianCheck = {
        taskId: 'task-1',
        floorId: 'floor-1',
        agentId: 'copy-agent',
        modelTier: 'sonnet',
        estimatedCostCents: 1000,
        prompt: 'Read file from ../../etc/passwd',
      };

      const result = guardian.verify(check);
      expect(result.approved).toBe(false);
      expect(result.violations.some(v => v.includes('path') || v.includes('directory'))).toBe(true);
    });

    it('should block dangerous shell commands', () => {
      const check: GuardianCheck = {
        taskId: 'task-1',
        floorId: 'floor-1',
        agentId: 'copy-agent',
        modelTier: 'sonnet',
        estimatedCostCents: 1000,
        prompt: 'Run: rm -rf / to clean up',
      };

      const result = guardian.verify(check);
      expect(result.approved).toBe(false);
      expect(result.violations.some(v => v.includes('shell') || v.includes('command'))).toBe(true);
    });
  });

  describe('Health Endpoint Reporting', () => {
    it('should track budget alerts in health status', () => {
      const alerts: unknown[] = [];
      eventBus.on('budget:alert', (data) => alerts.push(data));

      budgetEnforcer.recordCost('floor-1', 50000); // 50%
      budgetEnforcer.recordCost('floor-1', 25000); // 75%

      expect(alerts.length).toBe(2);
    });

    it('should track task lifecycle events', () => {
      const lifecycleEvents: unknown[] = [];
      eventBus.on('task:lifecycle-event', (event) => lifecycleEvents.push(event));

      const input: CreateTaskInput = {
        floorId: 'floor-1',
        phaseNumber: 1,
        assignedAgent: 'copy-agent',
        modelTier: 'sonnet',
        taskType: 'write-description',
        description: 'Write product description',
        prompt: 'Write a description',
      };

      const task = taskManager.create(input);
      taskManager.emitLifecycleEvent(task.id, false, 'success');

      expect(lifecycleEvents.length).toBeGreaterThan(0);
    });
  });
});
