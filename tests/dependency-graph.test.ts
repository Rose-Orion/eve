import { describe, it, expect, beforeEach } from 'vitest';
import { DependencyGraph } from '../src/orchestrator/dependency-graph.js';

describe('DependencyGraph', () => {
  let graph: DependencyGraph;

  beforeEach(() => {
    graph = new DependencyGraph();
  });

  it('should add task to graph without dependencies', () => {
    graph.addTask('task-1');

    const ready = graph.getReadyTasks();
    expect(ready).toContain('task-1');
  });

  it('should not list ready tasks with pending dependencies', () => {
    graph.addTask('task-1');
    graph.addTask('task-2', ['task-1']);

    const ready = graph.getReadyTasks();
    expect(ready).toContain('task-1');
    expect(ready).not.toContain('task-2');
  });

  it('should unblock dependent tasks when dependency completes', () => {
    graph.addTask('task-1');
    graph.addTask('task-2', ['task-1']);
    graph.addTask('task-3', ['task-2']);

    // Initially only task-1 is ready
    expect(graph.getReadyTasks()).toContain('task-1');
    expect(graph.getReadyTasks()).not.toContain('task-2');

    // Complete task-1
    const unblocked = graph.onTaskCompleted('task-1');
    expect(unblocked).toContain('task-2');

    // Now task-2 should be ready
    expect(graph.getReadyTasks()).toContain('task-2');
  });

  it('should cascade completions through dependency chain', () => {
    graph.addTask('task-1');
    graph.addTask('task-2', ['task-1']);
    graph.addTask('task-3', ['task-2']);

    graph.onTaskCompleted('task-1');
    graph.onTaskCompleted('task-2');

    const ready = graph.getReadyTasks();
    expect(ready).toContain('task-3');
  });

  it('should handle multiple tasks with same dependency', () => {
    graph.addTask('foundation');
    graph.addTask('task-a', ['foundation']);
    graph.addTask('task-b', ['foundation']);
    graph.addTask('task-c', ['foundation']);

    // Before foundation is done, none of the others are ready
    let ready = graph.getReadyTasks();
    expect(ready).not.toContain('task-a');
    expect(ready).not.toContain('task-b');
    expect(ready).not.toContain('task-c');

    // Complete foundation
    graph.onTaskCompleted('foundation');

    // All should now be ready
    ready = graph.getReadyTasks();
    expect(ready).toContain('task-a');
    expect(ready).toContain('task-b');
    expect(ready).toContain('task-c');
  });

  it('should handle tasks with multiple dependencies', () => {
    graph.addTask('task-1');
    graph.addTask('task-2');
    graph.addTask('task-3', ['task-1', 'task-2']);

    // task-3 not ready until both dependencies are done
    expect(graph.getReadyTasks()).not.toContain('task-3');

    graph.onTaskCompleted('task-1');
    expect(graph.getReadyTasks()).not.toContain('task-3');

    graph.onTaskCompleted('task-2');
    expect(graph.getReadyTasks()).toContain('task-3');
  });

  it('should remove task from graph', () => {
    graph.addTask('task-1');
    graph.addTask('task-2', ['task-1']);

    graph.removeTask('task-1');

    // task-2 should now be ready (task-1 removed, so dependency no longer exists)
    const ready = graph.getReadyTasks();
    expect(ready).toContain('task-2');
  });

  it('should detect circular dependencies', () => {
    graph.addTask('task-1', ['task-2']);
    graph.addTask('task-2', ['task-3']);
    graph.addTask('task-3', ['task-1']); // Circular dependency

    const validation = graph.validate();
    expect(validation.valid).toBe(false);
    expect(validation.cycles.length).toBeGreaterThan(0);
  });

  it('should validate acyclic graph', () => {
    graph.addTask('task-1');
    graph.addTask('task-2', ['task-1']);
    graph.addTask('task-3', ['task-2']);

    const validation = graph.validate();
    expect(validation.valid).toBe(true);
    expect(validation.cycles).toHaveLength(0);
  });

  it('should report blocked tasks correctly', () => {
    graph.addTask('task-1');
    graph.addTask('task-2', ['task-1']);
    graph.addTask('task-3', ['task-2']);

    const blocked = graph.getBlockedTasks();

    // task-2 is blocked waiting for task-1
    const blockedTask2 = blocked.find(b => b.taskId === 'task-2');
    expect(blockedTask2?.waitingFor).toContain('task-1');

    // task-3 is blocked waiting for task-2
    const blockedTask3 = blocked.find(b => b.taskId === 'task-3');
    expect(blockedTask3?.waitingFor).toContain('task-2');
  });

  it('should not report completed tasks as blocked', () => {
    graph.addTask('task-1');
    graph.addTask('task-2', ['task-1']);

    graph.onTaskCompleted('task-1');

    const blocked = graph.getBlockedTasks();
    const blockedTask1 = blocked.find(b => b.taskId === 'task-1');
    expect(blockedTask1).toBeUndefined();
  });

  it('should handle empty graph', () => {
    expect(graph.getReadyTasks()).toHaveLength(0);
    expect(graph.getBlockedTasks()).toHaveLength(0);
    const validation = graph.validate();
    expect(validation.valid).toBe(true);
  });

  it('should track ready tasks correctly as dependencies complete', () => {
    graph.addTask('phase-1');
    graph.addTask('phase-2-a', ['phase-1']);
    graph.addTask('phase-2-b', ['phase-1']);
    graph.addTask('phase-3', ['phase-2-a', 'phase-2-b']);

    let ready = graph.getReadyTasks();
    expect(ready).toEqual(['phase-1']);

    graph.onTaskCompleted('phase-1');
    ready = graph.getReadyTasks();
    expect(ready).toContain('phase-2-a');
    expect(ready).toContain('phase-2-b');

    graph.onTaskCompleted('phase-2-a');
    ready = graph.getReadyTasks();
    expect(ready).not.toContain('phase-3'); // Still waiting for phase-2-b

    graph.onTaskCompleted('phase-2-b');
    ready = graph.getReadyTasks();
    expect(ready).toContain('phase-3');
  });
});
