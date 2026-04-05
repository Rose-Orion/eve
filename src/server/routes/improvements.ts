/**
 * Improvement proposals API — view and manage self-improvement proposals.
 */

import type { FastifyInstance } from 'fastify';
import type { Orchestrator } from '../../orchestrator/index.js';

export function registerImprovementRoutes(app: FastifyInstance, orchestrator: Orchestrator): void {
  // Get all improvement proposals
  app.get('/api/improvements', async () => {
    return orchestrator.getImprovementProposals();
  });

  // Approve a proposal
  app.post<{ Params: { id: string } }>('/api/improvements/:id/approve', async (request) => {
    const success = orchestrator.approveImprovement(request.params.id);
    return { success };
  });

  // Reject a proposal
  app.post<{ Params: { id: string } }>('/api/improvements/:id/reject', async (request) => {
    const success = orchestrator.rejectImprovement(request.params.id);
    return { success };
  });
}
