/**
 * Heartbeat API routes — for OpenClaw agents to check system status and trigger queue processing.
 * CEO Mode and Floor Manager use these endpoints to get status updates for their heartbeats.
 */

import type { FastifyInstance } from 'fastify';
import type { Orchestrator } from '../../orchestrator/index.js';
import type { Task } from '../../config/types.js';

interface HeartbeatStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  activeFloors: Array<{
    floorId: string;
    name: string;
    phase: number;
    phaseName: string;
    progress: number;
  }>;
  pendingApprovals: Array<{
    id: string;
    floorId: string;
    type: string;
    description: string;
    waitingMs: number;
  }>;
  pendingTasks: number;
  stuckTasks: Array<{
    taskId: string;
    floorId: string;
    agentId: string;
    stuckMs: number;
  }>;
  budgetAlerts: Array<{
    floorId: string;
    threshold: number;
    spentCents: number;
    ceilingCents: number;
    message: string;
  }>;
}

interface FloorHeartbeatStatus {
  floorId: string;
  phase: number;
  phaseName: string;
  progress: number;
  activeTasks: Array<{
    taskId: string;
    agentId: string;
    status: string;
    createdAtMs: number;
  }>;
  pendingApprovals: Array<{
    id: string;
    type: string;
    description: string;
    waitingMs: number;
  }>;
  budgetStatus: {
    spentCents: number;
    ceilingCents: number;
    remainingCents: number;
    percentSpent: number;
  };
  blockedTasks: number;
}

interface QueueProcessResult {
  processed: number;
  queued: number;
  blocked: number;
  nextDispatch?: string;
}

export function registerHeartbeatRoutes(app: FastifyInstance, orchestrator: Orchestrator): void {
  /**
   * GET /api/heartbeat — System-wide heartbeat status for CEO Mode
   * Returns overall health, active floors, pending approvals, and alerts
   */
  app.get('/api/heartbeat', async () => {
    const floors = orchestrator.getFloors();
    const allApprovals = orchestrator.getPendingApprovals();
    const now = Date.now();

    // Calculate active floors with phase progress
    const activeFloors = floors
      .filter(f => f.status !== 'paused' && f.status !== 'archived')
      .map(f => {
        const tasks = orchestrator.getFloorTasks(f.id);
        const completedInPhase = tasks.filter(
          t => t.phaseNumber === f.currentPhase && t.status === 'completed',
        ).length;
        const totalInPhase = tasks.filter(t => t.phaseNumber === f.currentPhase).length;
        const progress = totalInPhase > 0 ? Math.round((completedInPhase / totalInPhase) * 100) : 0;

        return {
          floorId: f.id,
          name: f.name,
          phase: f.currentPhase,
          phaseName: getPhaseName(f.currentPhase),
          progress,
        };
      });

    // Extract pending approvals with wait times
    const pendingApprovals = allApprovals
      .filter(a => a.status === 'pending')
      .slice(0, 10) // Limit to 10 most recent
      .map(a => {
        let createdAtMs = now;
        let approvalType = 'task';
        if ('createdAt' in a && a.createdAt instanceof Date) {
          createdAtMs = a.createdAt.getTime();
        }
        if ('phaseNumber' in a) {
          approvalType = 'gate';
        }
        return {
          id: a.id,
          floorId: a.floorId,
          type: approvalType,
          description: getApprovalDescription(a),
          waitingMs: now - createdAtMs,
        };
      });

    // Find stuck tasks (dispatched > 10 min with no completion)
    const stuckTasks = [];
    for (const floor of floors) {
      const tasks = orchestrator.getFloorTasks(floor.id);
      for (const task of tasks) {
        if (task.status === 'dispatched') {
          const elapsedMs = now - task.createdAt.getTime();
          if (elapsedMs > 10 * 60 * 1000) {
            stuckTasks.push({
              taskId: task.id,
              floorId: floor.id,
              agentId: task.assignedAgent,
              stuckMs: elapsedMs,
            });
          }
        }
      }
    }

    // Count pending tasks across all floors
    let totalPendingTasks = 0;
    for (const floor of floors) {
      const tasks = orchestrator.getFloorTasks(floor.id);
      totalPendingTasks += tasks.filter(t => t.status === 'queued').length;
    }

    // Budget alerts
    const budgetAlerts = [];
    const costSummary = orchestrator.getCostSummary();
    for (const summary of costSummary) {
      const percentSpent = Math.round((summary.spentCents / summary.ceilingCents) * 100);
      let threshold = 0;
      let message = '';

      if (summary.spentCents > summary.ceilingCents) {
        threshold = 100;
        message = 'Budget exceeded';
      } else if (percentSpent >= 90) {
        threshold = 90;
        message = 'Budget 90% spent';
      } else if (percentSpent >= 75) {
        threshold = 75;
        message = 'Budget 75% spent';
      }

      if (threshold > 0) {
        budgetAlerts.push({
          floorId: summary.floorId,
          threshold,
          spentCents: summary.spentCents,
          ceilingCents: summary.ceilingCents,
          message,
        });
      }
    }

    const status: HeartbeatStatus = {
      status: stuckTasks.length > 0 || budgetAlerts.some(a => a.threshold >= 90) ? 'degraded' : 'healthy',
      timestamp: new Date().toISOString(),
      activeFloors,
      pendingApprovals,
      pendingTasks: totalPendingTasks,
      stuckTasks,
      budgetAlerts,
    };

    return status;
  });

  /**
   * POST /api/heartbeat/trigger — Get current queue state without mutation
   * Called by Floor Manager heartbeat to check pending task status
   * Note: Queue processing happens automatically in the Orchestrator main loop.
   * This endpoint reports the current state for heartbeat monitoring.
   */
  app.post('/api/heartbeat/trigger', async () => {
    // Count queued tasks (ready to be processed)
    let queued = 0;
    for (const floor of orchestrator.getFloors()) {
      const tasks = orchestrator.getFloorTasks(floor.id);
      queued += tasks.filter(t => t.status === 'queued').length;
    }

    // Count blocked tasks (queued but dependencies not met)
    // We approximate this by checking if a task is queued but its dependencies aren't all completed
    let blocked = 0;
    for (const floor of orchestrator.getFloors()) {
      const tasks = orchestrator.getFloorTasks(floor.id);
      for (const task of tasks) {
        if (task.status === 'queued') {
          // Check if any dependency is not completed
          const hasPendingDeps = task.dependsOn && task.dependsOn.length > 0;
          if (hasPendingDeps) {
            blocked++;
          }
        }
      }
    }

    // Count dispatched tasks (currently being processed)
    let dispatched = 0;
    for (const floor of orchestrator.getFloors()) {
      const tasks = orchestrator.getFloorTasks(floor.id);
      dispatched += tasks.filter(t => t.status === 'dispatched').length;
    }

    const result: QueueProcessResult = {
      processed: dispatched, // Currently being processed
      queued,
      blocked,
      nextDispatch: new Date(Date.now() + 2000).toISOString(), // Typical 2s before next dispatch
    };

    return result;
  });

  /**
   * GET /api/heartbeat/floor/:floorId — Floor-specific heartbeat status
   * Called by Floor Manager to get detailed status for a specific floor
   */
  app.get<{
    Params: { floorId: string };
  }>('/api/heartbeat/floor/:floorId', async (request, reply) => {
    const { floorId } = request.params;
    const floor = orchestrator.getFloor(floorId);

    if (!floor) {
      return reply.status(404).send({ error: 'Floor not found' });
    }

    const tasks = orchestrator.getFloorTasks(floorId);
    const now = Date.now();

    // Active tasks (currently dispatched)
    const activeTasks = tasks
      .filter(t => t.status === 'dispatched')
      .map(t => ({
        taskId: t.id,
        agentId: t.assignedAgent,
        status: t.status,
        createdAtMs: t.createdAt.getTime(),
      }));

    // Phase progress
    const completedInPhase = tasks.filter(
      t => t.phaseNumber === floor.currentPhase && t.status === 'completed',
    ).length;
    const totalInPhase = tasks.filter(t => t.phaseNumber === floor.currentPhase).length;
    const progress = totalInPhase > 0 ? Math.round((completedInPhase / totalInPhase) * 100) : 0;

    // Pending approvals for this floor
    const allApprovals = orchestrator.getPendingApprovals();
    const floorApprovals = allApprovals
      .filter(a => a.floorId === floorId && a.status === 'pending')
      .map(a => {
        let createdAtMs = now;
        let approvalType = 'task';
        if ('createdAt' in a && a.createdAt instanceof Date) {
          createdAtMs = a.createdAt.getTime();
        }
        if ('phaseNumber' in a) {
          approvalType = 'gate';
        }
        return {
          id: a.id,
          type: approvalType,
          description: getApprovalDescription(a),
          waitingMs: now - createdAtMs,
        };
      });

    // Budget status
    const costs = orchestrator.getFloorCosts(floorId);
    const budgetStatus = {
      spentCents: costs?.spentCents ?? 0,
      ceilingCents: costs?.ceilingCents ?? 0,
      remainingCents: (costs?.ceilingCents ?? 0) - (costs?.spentCents ?? 0),
      percentSpent: costs?.ceilingCents ? Math.round((costs.spentCents / costs.ceilingCents) * 100) : 0,
    };

    // Blocked tasks (queued but have dependencies)
    let blockedTasks = 0;
    for (const task of tasks) {
      if (task.status === 'queued') {
        const hasPendingDeps = task.dependsOn && task.dependsOn.length > 0;
        if (hasPendingDeps) {
          blockedTasks++;
        }
      }
    }

    const status: FloorHeartbeatStatus = {
      floorId,
      phase: floor.currentPhase,
      phaseName: getPhaseName(floor.currentPhase),
      progress,
      activeTasks,
      pendingApprovals: floorApprovals,
      budgetStatus,
      blockedTasks,
    };

    return status;
  });
}

function getPhaseName(phaseNumber: number): string {
  const phases: Record<number, string> = {
    1: 'Foundation Sprint',
    2: 'Brand Approval Gate',
    3: 'Website Build',
    4: 'Product Setup',
    5: 'Content Creation',
    6: 'Email Sequences',
    7: 'Ad Campaign Setup',
    8: 'Pre-Launch Review',
    9: 'Launch',
    10: 'Operations',
  };
  return phases[phaseNumber] ?? `Phase ${phaseNumber}`;
}

function getApprovalDescription(approval: any): string {
  if ('phaseNumber' in approval && approval.type === 'gate') {
    return `Approve phase ${approval.phaseNumber} (${getPhaseName(approval.phaseNumber)})`;
  }
  if ('brief' in approval && approval.brief) {
    return approval.brief.substring(0, 100);
  }
  return `Approval ${approval.id}`;
}
