/**
 * Approval API routes — handle human approval gates.
 */

import type { FastifyInstance } from 'fastify';
import type { Orchestrator } from '../../orchestrator/index.js';
import { getPendingDashboardPatches, applyApprovedDashboardPatch, rejectDashboardPatch, getPendingBackendPatches, applyApprovedBackendPatch, rejectBackendPatch } from '../../orchestrator/eve-actions.js';

export function registerApprovalRoutes(app: FastifyInstance, orchestrator: Orchestrator): void {
  // Get pending approvals
  app.get('/api/approvals', async () => {
    return orchestrator.getPendingApprovals();
  });

  // Approve a task/gate
  app.post<{
    Params: { id: string };
    Body: { feedback?: string };
  }>('/api/approvals/:id/approve', async (request) => {
    orchestrator.handleApproval(request.params.id, true, request.body.feedback);
    return { success: true };
  });

  // Reject a task/gate
  app.post<{
    Params: { id: string };
    Body: { feedback: string };
  }>('/api/approvals/:id/reject', async (request) => {
    orchestrator.handleApproval(request.params.id, false, request.body.feedback);
    return { success: true };
  });

  // Dashboard patches — review pending patches before they go live
  app.get('/api/dashboard-patches', async () => {
    return getPendingDashboardPatches().map(p => ({
      key: `dashboard-patch-${p.patchId}`,
      patchId: p.patchId,
      floorId: p.floorId,
      issueDescription: p.issueDescription,
      changeCount: p.patches.length,
      patches: p.patches.map(patch => ({
        file: patch.file,
        find: patch.find.slice(0, 200),
        replace: patch.replace.slice(0, 200),
      })),
      rawMarkdown: p.rawMarkdown,
      createdAt: p.createdAt,
    }));
  });

  // Approve and apply a dashboard patch
  app.post<{ Params: { key: string } }>('/api/dashboard-patches/:key/approve', async (request, reply) => {
    const result = await applyApprovedDashboardPatch(request.params.key);
    if (result.error) return reply.code(404).send({ error: result.error });
    return { success: true, applied: result.applied, failed: result.failed };
  });

  // Reject a dashboard patch
  app.post<{ Params: { key: string } }>('/api/dashboard-patches/:key/reject', async (request, reply) => {
    const ok = rejectDashboardPatch(request.params.key);
    if (!ok) return reply.code(404).send({ error: 'Patch not found' });
    return { success: true };
  });

  // Backend patches — review pending patches before they go live (TypeScript-validated on approval)
  app.get('/api/backend-patches', async () => {
    return getPendingBackendPatches().map(p => ({
      key: `backend-patch-${p.patchId}`,
      patchId: p.patchId,
      floorId: p.floorId,
      issueDescription: p.issueDescription,
      changeCount: p.patches.length,
      patches: p.patches.map(patch => ({
        file: patch.file,
        find: patch.find.slice(0, 500),
        replace: patch.replace.slice(0, 500),
      })),
      rawMarkdown: p.rawMarkdown,
      createdAt: p.createdAt,
    }));
  });

  // Approve and apply a backend patch (runs TypeScript validation before applying)
  app.post<{ Params: { key: string } }>('/api/backend-patches/:key/approve', async (request, reply) => {
    const result = await applyApprovedBackendPatch(request.params.key);
    if (result.error) return reply.code(404).send({ error: result.error });
    return { success: true, applied: result.applied, failed: result.failed };
  });

  // Reject a backend patch
  app.post<{ Params: { key: string } }>('/api/backend-patches/:key/reject', async (request, reply) => {
    const ok = rejectBackendPatch(request.params.key);
    if (!ok) return reply.code(404).send({ error: 'Patch not found' });
    return { success: true };
  });
}
