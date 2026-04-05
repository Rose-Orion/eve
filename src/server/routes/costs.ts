/**
 * Cost tracking API routes — detailed breakdowns for the Dashboard.
 */

import type { FastifyInstance } from 'fastify';
import type { Orchestrator } from '../../orchestrator/index.js';

export function registerCostRoutes(app: FastifyInstance, orchestrator: Orchestrator): void {
  // Get cost summary across all floors
  app.get('/api/costs/summary', async () => {
    return orchestrator.getCostSummary();
  });

  // Get detailed cost breakdown for a specific floor
  app.get<{ Params: { floorId: string } }>('/api/costs/:floorId', async (request) => {
    const { floorId } = request.params;
    const summary = orchestrator.getCostSummary().find(s => s.floorId === floorId);
    if (!summary) return { error: 'Floor not found' };
    return summary;
  });

  // Costs grouped by agent for a floor
  app.get<{ Params: { floorId: string } }>('/api/costs/:floorId/by-agent', async (request) => {
    const { floorId } = request.params;
    const tasks = orchestrator.taskManager.getFloorTasks(floorId);
    const byAgent = new Map<string, { agent: string; totalCostCents: number; taskCount: number }>();

    for (const task of tasks) {
      if (task.actualCostCents > 0) {
        const entry = byAgent.get(task.assignedAgent) ?? { agent: task.assignedAgent, totalCostCents: 0, taskCount: 0 };
        entry.totalCostCents += task.actualCostCents;
        entry.taskCount++;
        byAgent.set(task.assignedAgent, entry);
      }
    }

    return [...byAgent.values()].sort((a, b) => b.totalCostCents - a.totalCostCents);
  });

  // Costs grouped by model tier for a floor
  app.get<{ Params: { floorId: string } }>('/api/costs/:floorId/by-model', async (request) => {
    const { floorId } = request.params;
    const tasks = orchestrator.taskManager.getFloorTasks(floorId);
    const byModel = new Map<string, { model: string; totalCostCents: number; taskCount: number }>();

    for (const task of tasks) {
      if (task.actualCostCents > 0) {
        const entry = byModel.get(task.modelTier) ?? { model: task.modelTier, totalCostCents: 0, taskCount: 0 };
        entry.totalCostCents += task.actualCostCents;
        entry.taskCount++;
        byModel.set(task.modelTier, entry);
      }
    }

    return [...byModel.values()].sort((a, b) => b.totalCostCents - a.totalCostCents);
  });

  // Budget projection for a floor
  app.get<{ Params: { floorId: string } }>('/api/costs/:floorId/projection', async (request) => {
    const { floorId } = request.params;
    const summary = orchestrator.getCostSummary().find(s => s.floorId === floorId);
    if (!summary) return { error: 'Floor not found' };

    const tasks = orchestrator.taskManager.getFloorTasks(floorId);
    const completedTasks = tasks.filter(t => t.status === 'completed' && t.actualCostCents > 0);

    if (completedTasks.length === 0) {
      return { ...summary, dailyRate: 0, daysRemaining: null, message: 'No completed tasks yet' };
    }

    // Calculate daily spend rate from completed tasks
    const firstTask = completedTasks.reduce((min, t) => (min && t.createdAt < min.createdAt ? t : min));
    if (!firstTask) {
      return { ...summary, dailyRate: 0, daysRemaining: null, message: 'No completed tasks yet' };
    }
    const daysSinceFirst = Math.max(1, (Date.now() - firstTask.createdAt.getTime()) / (1000 * 60 * 60 * 24));
    const dailyRate = Math.round(summary.spentCents / daysSinceFirst);
    const remainingCents = summary.ceilingCents - summary.spentCents;
    const daysRemaining = dailyRate > 0 ? Math.round(remainingCents / dailyRate) : null;

    return {
      ...summary,
      dailyRateCents: dailyRate,
      daysRemaining,
      completedTaskCount: completedTasks.length,
    };
  });
}
