/**
 * Task API routes — view and manage tasks.
 */

import type { FastifyInstance } from 'fastify';
import type { Orchestrator } from '../../orchestrator/index.js';

export function registerTaskRoutes(app: FastifyInstance, orchestrator: Orchestrator): void {
  // GET /api/tasks/:taskId — fetch a single task by ID (used by Review button detail view)
  app.get<{ Params: { taskId: string } }>('/api/tasks/:taskId', async (request, reply) => {
    const task = orchestrator.getTask(request.params.taskId);
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    return task;
  });

  // GET /api/floors/:id/tasks/:taskId — fetch a single task scoped to a floor
  app.get<{ Params: { id: string; taskId: string } }>(
    '/api/floors/:id/tasks/:taskId',
    async (request, reply) => {
      const floor = orchestrator.getFloor(request.params.id);
      if (!floor) return reply.code(404).send({ error: 'Floor not found' });

      const task = orchestrator.getTask(request.params.taskId);
      if (!task) return reply.code(404).send({ error: 'Task not found' });

      // Verify task belongs to this floor
      if (task.floorId !== request.params.id) {
        return reply.code(403).send({ error: 'Task does not belong to this floor' });
      }

      return task;
    },
  );

  // POST /api/tasks/:taskId/retry — retry a failed/escalated task
  app.post<{ Params: { taskId: string }; Body: { reassignAgent?: string } }>('/api/tasks/:taskId/retry', async (request, reply) => {
    const body = (request.body ?? {}) as { reassignAgent?: string };
    const result = orchestrator.retryTask(request.params.taskId, body.reassignAgent as any);
    if (!result.success) {
      return reply.code(400).send({ error: result.error });
    }
    const task = orchestrator.getTask(request.params.taskId);
    return reply.code(200).send({ success: true, task });
  });

  // POST /api/tasks/:taskId/requeue — reset a stuck task back to queued so the dispatch loop picks it up
  app.post<{ Params: { taskId: string } }>('/api/tasks/:taskId/requeue', async (request, reply) => {
    const task = orchestrator.getTask(request.params.taskId);
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    // Reset task to queued state — clears dispatch/review artifacts
    task.status = 'queued' as any;
    task.dispatchedAt = null as any;
    task.startedAt = null as any;
    task.completedAt = null as any;
    task.result = null as any;
    task.reviewStatus = null as any;
    task.reviewFeedback = null as any;
    task.retryCount = (task.retryCount || 0);
    request.log.info({ taskId: task.id, taskType: task.taskType }, '[requeue] Task reset to queued');
    return reply.code(200).send({ success: true, task });
  });

  // GET /api/debug/dispatch — diagnose why queued tasks aren't dispatching
  app.get('/api/debug/dispatch', async (_request, reply) => {
    const queued = (orchestrator as any).taskManager.getQueuedTasks();
    const results: any[] = [];
    for (const task of queued) {
      const diag: any = { id: task.id.slice(0, 8), type: task.taskType, phase: task.phaseNumber, agent: task.assignedAgent, status: task.status };
      // Safety controls
      const safety = (orchestrator as any).safetyControls.canDispatch(task.floorId);
      if (!safety.allowed) { diag.block = `SAFETY: ${safety.reason}`; results.push(diag); continue; }
      // Dependencies
      if (task.dependsOn.length > 0) {
        const ready = (orchestrator as any).dependencyGraph.getReadyTasks();
        if (!ready.includes(task.id)) { diag.block = `DEPS: unmet (depends on ${task.dependsOn})`; results.push(diag); continue; }
      }
      // Guardian
      const guardian = (orchestrator as any).guardian.verify({
        taskId: task.id, floorId: task.floorId, agentId: task.assignedAgent,
        modelTier: task.modelTier, estimatedCostCents: task.estimatedCostCents,
        prompt: task.prompt, taskType: task.taskType, approvalToken: task.approvalToken ?? undefined,
      });
      if (!guardian.approved) { diag.block = `GUARDIAN: ${guardian.violations?.join(', ')}`; results.push(diag); continue; }
      // Trust
      const TRUST_EXEMPT_PHASES = new Set([3, 4, 5, 6, 8]);
      const trustExempt = TRUST_EXEMPT_PHASES.has(task.phaseNumber);
      if (!trustExempt && (orchestrator as any).trustLadder.needsApproval(task.floorId, task.taskType)) {
        diag.block = `TRUST: needs approval (level ${(orchestrator as any).trustLadder.getLevel(task.floorId)})`; results.push(diag); continue;
      }
      // Concurrency
      const conc = (orchestrator as any).concurrency.canDispatch(task.floorId, task.modelTier);
      if (!conc.allowed) { diag.block = `CONCURRENCY: ${conc.reason}`; results.push(diag); continue; }
      // Budget per turn
      const bpt = (orchestrator as any).safetyControls.checkBudgetPerTurn(task.floorId, task.estimatedCostCents);
      if (!bpt.allowed) { diag.block = `BUDGET: ${bpt.reason}`; results.push(diag); continue; }
      diag.block = 'NONE — should dispatch';
      results.push(diag);
    }
    return reply.send({ queuedCount: queued.length, processLoopCounter: (orchestrator as any).processLoopCounter, running: (orchestrator as any).running, tasks: results });
  });

  // POST /api/tasks/:taskId/force-complete — force accept a task's current result
  app.post<{ Params: { taskId: string } }>('/api/tasks/:taskId/force-complete', async (request, reply) => {
    const task = orchestrator.getTask(request.params.taskId);
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    if (!task.result) return reply.code(400).send({ error: 'Task has no result to accept' });
    // Force to completed status regardless of current state
    task.status = 'completed' as any;
    task.revisionNote = null;
    task.completedAt = new Date();
    // Emit task:completed so phase completion check runs
    orchestrator.eventBus.emit('task:completed', {
      taskId: task.id,
      floorId: task.floorId,
      agentId: task.assignedAgent,
      result: task.result,
    });
    return reply.code(200).send({ success: true, task });
  });

  // POST /api/tasks/:taskId/force-escalate — skip a task that can't complete (e.g. missing integration)
  app.post<{ Params: { taskId: string } }>('/api/tasks/:taskId/force-escalate', async (request, reply) => {
    const task = orchestrator.getTask(request.params.taskId);
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    task.status = 'escalated' as any;
    task.completedAt = new Date();
    task.result = task.result || '[Force-escalated: integration not configured in test environment]';
    // Resume floor in case runaway detector killed it
    (orchestrator as any).safetyControls.resumeFloor(task.floorId);
    // Emit task:completed so phase completion check fires
    orchestrator.eventBus.emit('task:completed', {
      taskId: task.id,
      floorId: task.floorId,
      agentId: task.assignedAgent,
      result: task.result,
    });
    return reply.code(200).send({ success: true, task });
  });

  // GET /api/tasks/:taskId/deliverable — get full deliverable output for a completed task
  app.get<{ Params: { taskId: string } }>('/api/tasks/:taskId/deliverable', async (request, reply) => {
    const task = orchestrator.getTask(request.params.taskId);
    if (!task) return reply.code(404).send({ error: 'Task not found' });

    // Include council metadata if this task was dispatched via council
    const council = orchestrator.getCouncilResult(request.params.taskId);

    return reply.code(200).send({
      id: task.id,
      taskType: task.taskType,
      assignedAgent: task.assignedAgent,
      status: task.status,
      phaseNumber: task.phaseNumber,
      result: task.result ?? null,
      completedAt: task.completedAt ?? null,
      attempts: task.attempts,
      outputFiles: task.outputFiles ?? [],
      // Council fields (null if not a council task)
      council: council ? {
        winnerIndex: council.winnerIndex,
        rationale: council.rationale,
        totalCostCents: council.totalCostCents,
        proposalCount: council.proposals.length,
        proposals: council.proposals.map((p, i) => ({
          index: i,
          persona: p.persona.slice(0, 200),
          preview: p.content.slice(0, 500),
          costCents: p.costCents,
          success: p.success,
          isWinner: i === council.winnerIndex,
        })),
      } : null,
    });
  });

  // GET /api/tasks/:taskId/council/:proposalIndex — get full proposal content
  app.get<{ Params: { taskId: string; proposalIndex: string } }>(
    '/api/tasks/:taskId/council/:proposalIndex',
    async (request, reply) => {
      const council = orchestrator.getCouncilResult(request.params.taskId);
      if (!council) return reply.code(404).send({ error: 'No council data for this task' });

      const idx = parseInt(request.params.proposalIndex, 10);
      if (isNaN(idx) || idx < 0 || idx >= council.proposals.length) {
        return reply.code(400).send({ error: 'Invalid proposal index' });
      }

      const proposal = council.proposals[idx];
      if (!proposal) return reply.code(404).send({ error: 'Proposal not found' });
      return reply.code(200).send({
        index: idx,
        persona: proposal.persona,
        content: proposal.content,
        costCents: proposal.costCents,
        success: proposal.success,
        isWinner: idx === council.winnerIndex,
      });
    },
  );
}
