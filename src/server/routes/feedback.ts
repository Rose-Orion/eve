/**
 * Agent Feedback API — Floor Managers and agents submit improvement requests to EVE.
 * EVE analyzes each request and decides: auto-apply, escalate to owner, defer, or reject.
 * Cross-floor issues are propagated system-wide automatically.
 */

import type { FastifyInstance } from 'fastify';
import type { Orchestrator } from '../../orchestrator/index.js';

export function registerFeedbackRoutes(app: FastifyInstance, orchestrator: Orchestrator): void {
  // Submit feedback from an agent (typically Floor Manager)
  app.post<{
    Params: { floorId: string };
    Body: { agentId?: string; message: string; source?: string };
  }>('/api/floors/:floorId/feedback', async (request, reply) => {
    const { floorId } = request.params;
    const { agentId, message, source } = request.body;
    if (!message?.trim()) return reply.code(400).send({ error: 'Message is required' });
    const result = await orchestrator.submitAgentFeedback(
      floorId,
      agentId || (source === 'owner' ? 'owner' : 'floor-manager'),
      message,
    );
    return result;
  });

  // Get all feedback (optionally filtered by floor)
  app.get<{ Querystring: { floorId?: string } }>('/api/feedback', async (request) => {
    return orchestrator.getAllFeedback(request.query.floorId);
  });

  // Get pending feedback needing owner approval
  app.get('/api/feedback/pending', async () => {
    return orchestrator.getPendingFeedback();
  });

  // Approve a feedback item
  app.post<{ Params: { id: string } }>('/api/feedback/:id/approve', async (request) => {
    const success = orchestrator.approveFeedback(request.params.id);
    return { success };
  });

  // Reject a feedback item
  app.post<{ Params: { id: string } }>('/api/feedback/:id/reject', async (request) => {
    const success = orchestrator.rejectFeedback(request.params.id);
    return { success };
  });

  // Get system-wide learnings (cross-floor improvements)
  app.get('/api/feedback/learnings', async () => {
    return orchestrator.getSystemLearnings();
  });
}
