/**
 * DependencyGraph — DAG of task dependencies.
 * Determines which tasks are ready to dispatch based on completed dependencies.
 */

export interface GraphNode {
  taskId: string;
  dependsOn: Set<string>;
  dependedOnBy: Set<string>;
  completed: boolean;
}

export class DependencyGraph {
  private nodes = new Map<string, GraphNode>();

  /** Add a task to the graph with its dependencies. */
  addTask(taskId: string, dependsOn: string[] = []): void {
    const node: GraphNode = {
      taskId,
      dependsOn: new Set(dependsOn),
      dependedOnBy: new Set(),
      completed: false,
    };
    this.nodes.set(taskId, node);

    // Register reverse edges
    for (const depId of dependsOn) {
      const depNode = this.nodes.get(depId);
      if (depNode) {
        depNode.dependedOnBy.add(taskId);
      }
    }
  }

  /** Remove a task from the graph. */
  removeTask(taskId: string): void {
    const node = this.nodes.get(taskId);
    if (!node) return;

    // Clean up reverse edges
    for (const depId of node.dependsOn) {
      const depNode = this.nodes.get(depId);
      if (depNode) depNode.dependedOnBy.delete(taskId);
    }
    for (const depId of node.dependedOnBy) {
      const depNode = this.nodes.get(depId);
      if (depNode) depNode.dependsOn.delete(taskId);
    }

    this.nodes.delete(taskId);
  }

  /**
   * Get tasks that are ready to dispatch — all dependencies completed.
   */
  getReadyTasks(): string[] {
    const ready: string[] = [];
    for (const node of this.nodes.values()) {
      if (node.completed) continue;
      const allDepsCompleted = [...node.dependsOn].every(depId => {
        const dep = this.nodes.get(depId);
        return dep?.completed ?? true; // Missing deps treated as completed
      });
      if (allDepsCompleted) {
        ready.push(node.taskId);
      }
    }
    return ready;
  }

  /**
   * Mark a task as completed and return newly unblocked tasks.
   */
  onTaskCompleted(taskId: string): string[] {
    const node = this.nodes.get(taskId);
    if (!node) return [];

    node.completed = true;

    // Check which dependent tasks are now unblocked
    const newlyReady: string[] = [];
    for (const dependentId of node.dependedOnBy) {
      const dependent = this.nodes.get(dependentId);
      if (!dependent || dependent.completed) continue;

      const allDepsCompleted = [...dependent.dependsOn].every(depId => {
        const dep = this.nodes.get(depId);
        return dep?.completed ?? true;
      });
      if (allDepsCompleted) {
        newlyReady.push(dependentId);
      }
    }

    return newlyReady;
  }

  /** Validate the graph has no circular dependencies. */
  validate(): { valid: boolean; cycles: string[][] } {
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const cycles: string[][] = [];

    const dfs = (taskId: string, path: string[]): boolean => {
      if (inStack.has(taskId)) {
        const cycleStart = path.indexOf(taskId);
        cycles.push(path.slice(cycleStart));
        return true;
      }
      if (visited.has(taskId)) return false;

      visited.add(taskId);
      inStack.add(taskId);
      path.push(taskId);

      const node = this.nodes.get(taskId);
      if (node) {
        // Traverse dependsOn edges (prerequisites) to detect cycles
        for (const depId of node.dependsOn) {
          dfs(depId, [...path]);
        }
      }

      inStack.delete(taskId);
      return false;
    };

    for (const taskId of this.nodes.keys()) {
      if (!visited.has(taskId)) {
        dfs(taskId, []);
      }
    }

    return { valid: cycles.length === 0, cycles };
  }

  /** Get blocked tasks and what they're waiting for. */
  getBlockedTasks(): Array<{ taskId: string; waitingFor: string[] }> {
    const blocked: Array<{ taskId: string; waitingFor: string[] }> = [];
    for (const node of this.nodes.values()) {
      if (node.completed) continue;
      const waiting = [...node.dependsOn].filter(depId => {
        const dep = this.nodes.get(depId);
        return dep && !dep.completed;
      });
      if (waiting.length > 0) {
        blocked.push({ taskId: node.taskId, waitingFor: waiting });
      }
    }
    return blocked;
  }

  /** Generate a Mermaid diagram for visualization. */
  toMermaid(): string {
    const lines = ['graph TD'];
    for (const node of this.nodes.values()) {
      const status = node.completed ? '✅' : '⏳';
      lines.push(`  ${node.taskId}["${status} ${node.taskId}"]`);
      for (const depId of node.dependsOn) {
        lines.push(`  ${depId} --> ${node.taskId}`);
      }
    }
    return lines.join('\n');
  }

  /** Get total node count. */
  get size(): number {
    return this.nodes.size;
  }

  /** Check if a specific task is completed. */
  isCompleted(taskId: string): boolean {
    return this.nodes.get(taskId)?.completed ?? false;
  }
}
