import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BudgetEnforcer } from '../src/security/budget-enforcer.js';
import { EventBus } from '../src/orchestrator/event-bus.js';

describe('BudgetEnforcer', () => {
  let enforcer: BudgetEnforcer;
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    enforcer = new BudgetEnforcer(eventBus);
  });

  it('should initialize budget for a floor', () => {
    enforcer.initFloor('floor-1', 100000); // $1000 budget
    const status = enforcer.getStatus('floor-1');

    expect(status).toBeDefined();
    expect(status?.ceilingCents).toBe(100000);
    expect(status?.spentCents).toBe(0);
    expect(status?.percentUsed).toBe(0);
  });

  it('should allow dispatch within budget', () => {
    enforcer.initFloor('floor-1', 100000);
    const result = enforcer.canAfford('floor-1', 10000); // $100

    expect(result.allowed).toBe(true);
  });

  it('should block dispatch when over budget', () => {
    enforcer.initFloor('floor-1', 100000); // $1000
    enforcer.recordCost('floor-1', 95000); // $950 spent
    const result = enforcer.canAfford('floor-1', 10000); // Try to spend $100 more

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Budget exceeded');
  });

  it('should record cost correctly', () => {
    enforcer.initFloor('floor-1', 100000);
    enforcer.recordCost('floor-1', 25000); // $250

    const status = enforcer.getStatus('floor-1');
    expect(status?.spentCents).toBe(25000);
    expect(status?.percentUsed).toBe(25);
  });

  it('should emit alert at 50% threshold', () => {
    const alertListener = vi.fn();
    eventBus.on('budget:alert', alertListener);

    enforcer.initFloor('floor-1', 100000);
    enforcer.recordCost('floor-1', 50000); // Spend exactly 50%

    expect(alertListener).toHaveBeenCalledWith(
      expect.objectContaining({
        floorId: 'floor-1',
        threshold: 0.5,
      }),
    );
  });

  it('should emit alert at 75% threshold', () => {
    const alertListener = vi.fn();
    eventBus.on('budget:alert', alertListener);

    enforcer.initFloor('floor-1', 100000);
    enforcer.recordCost('floor-1', 75000); // Spend exactly 75%

    expect(alertListener).toHaveBeenCalledWith(
      expect.objectContaining({
        threshold: 0.75,
      }),
    );
  });

  it('should emit alert at 90% threshold', () => {
    const alertListener = vi.fn();
    eventBus.on('budget:alert', alertListener);

    enforcer.initFloor('floor-1', 100000);
    enforcer.recordCost('floor-1', 90000); // Spend exactly 90%

    expect(alertListener).toHaveBeenCalledWith(
      expect.objectContaining({
        threshold: 0.9,
      }),
    );
  });

  it('should emit budget-exceeded event when limit reached', () => {
    const exceededListener = vi.fn();
    eventBus.on('budget:exceeded', exceededListener);

    enforcer.initFloor('floor-1', 100000);
    enforcer.recordCost('floor-1', 100000); // Spend everything

    expect(exceededListener).toHaveBeenCalledWith(
      expect.objectContaining({
        floorId: 'floor-1',
        spentCents: 100000,
        ceilingCents: 100000,
      }),
    );
  });

  it('should calculate remaining budget correctly', () => {
    enforcer.initFloor('floor-1', 100000);
    enforcer.recordCost('floor-1', 30000);

    const remaining = enforcer.getRemaining('floor-1');
    expect(remaining).toBe(70000);
  });

  it('should not go below zero remaining budget', () => {
    enforcer.initFloor('floor-1', 100000);
    enforcer.recordCost('floor-1', 150000); // Overspend

    const remaining = enforcer.getRemaining('floor-1');
    expect(remaining).toBe(0);
  });

  it('should update ceiling correctly', () => {
    enforcer.initFloor('floor-1', 100000);
    enforcer.recordCost('floor-1', 50000);
    enforcer.updateCeiling('floor-1', 200000); // Double the budget

    const status = enforcer.getStatus('floor-1');
    expect(status?.ceilingCents).toBe(200000);
  });

  it('should remove floor from tracking', () => {
    enforcer.initFloor('floor-1', 100000);
    enforcer.removeFloor('floor-1');

    const status = enforcer.getStatus('floor-1');
    expect(status).toBeNull();
  });

  it('should return null status for non-existent floor', () => {
    const status = enforcer.getStatus('non-existent');
    expect(status).toBeNull();
  });
});
