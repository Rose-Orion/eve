/**
 * Floor API routes — CRUD for business floors.
 */

import type { FastifyInstance } from 'fastify';
import type { Orchestrator } from '../../orchestrator/index.js';
import { z } from 'zod';

const VALID_BUSINESS_TYPES = ['ecommerce', 'service', 'content', 'personal-brand'] as const;

const createFloorSchema = z.object({
  name: z.string().min(1, 'Floor name is required').max(100, 'Floor name too long'),
  goal: z.string().min(1, 'Goal is required').max(2000, 'Goal too long (max 2000 chars — it gets embedded in every agent prompt)'),
  businessType: z.enum(VALID_BUSINESS_TYPES, {
    errorMap: () => ({ message: `businessType must be one of: ${VALID_BUSINESS_TYPES.join(', ')}` }),
  }),
  budgetCeilingCents: z.number().int().min(100, 'Budget must be at least $1.00').max(100_000_00, 'Budget cannot exceed $100,000'),
});

export function registerFloorRoutes(app: FastifyInstance, orchestrator: Orchestrator): void {
  app.get('/api/floors', async () => {
    return orchestrator.getFloors().map(floor => {
      const costs = orchestrator.getFloorCosts(floor.id);
      return { ...floor, spentCents: costs?.spentCents ?? floor.spentCents };
    });
  });

  app.post<{
    Body: { name: string; goal: string; businessType: string; budgetCeilingCents: number };
  }>('/api/floors', async (request, reply) => {
    const parsed = createFloorSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Validation failed',
        details: parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    const { name, goal, businessType, budgetCeilingCents } = parsed.data;
    const floor = await orchestrator.createFloor({
      name,
      goal,
      businessType,
      budgetCeilingCents,
    });
    return floor;
  });

  app.get<{ Params: { id: string } }>('/api/floors/:id', async (request, reply) => {
    const floor = orchestrator.getFloor(request.params.id);
    if (!floor) return reply.code(404).send({ error: 'Floor not found' });
    const costs = orchestrator.getFloorCosts(floor.id);
    return { ...floor, spentCents: costs?.spentCents ?? floor.spentCents };
  });

  // PATCH — update floor settings
  app.patch<{
    Params: { id: string };
    Body: { name?: string; budgetCeilingCents?: number; brandState?: string; selectedBrand?: { index: number; name: string; tagline: string; personality: string; voiceAttributes: string[] } };
  }>('/api/floors/:id', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const result = orchestrator.updateFloor(request.params.id, body);
    if (!result) return reply.code(404).send({ error: 'Floor not found' });

    // If caller tried to set selectedBrand but it wasn't applied (placeholder rejection),
    // return 422 so the frontend knows the brand data was rejected.
    if (body.selectedBrand && !result.selectedBrand) {
      return reply.code(422).send({ error: 'Brand selection rejected — brand name appears to be a placeholder. Wait for the Brand Agent to finish, then try again.' });
    }
    const sb = body.selectedBrand as { name?: string } | undefined;
    if (sb?.name && result.selectedBrand?.name !== sb.name) {
      return reply.code(422).send({ error: `Brand selection rejected — "${sb.name}" was not accepted. This usually means the brand parser failed to extract real data.` });
    }

    return result;
  });

  app.get<{ Params: { id: string } }>('/api/floors/:id/agents', async (request) => {
    return orchestrator.getFloorAgents(request.params.id);
  });

  app.get<{ Params: { id: string } }>('/api/floors/:id/tasks', async (request) => {
    const tasks = orchestrator.getFloorTasks(request.params.id);
    // Annotate tasks with council flag for dashboard display
    return tasks.map(t => ({
      ...t,
      councilUsed: !!orchestrator.getCouncilResult(t.id),
    }));
  });

  // Theme — return the floor's brand theme config (colors, fonts, palette) as CSS variables
  app.get<{ Params: { id: string } }>('/api/floors/:id/theme', async (request, reply) => {
    const floor = orchestrator.getFloor(request.params.id);
    if (!floor) return reply.code(404).send({ error: 'Floor not found' });
    if (!floor.themeConfig) return reply.code(204).send();

    const theme = floor.themeConfig;
    const cssVars: Record<string, string> = {};
    if (theme.primaryColor) cssVars['--brand-primary'] = theme.primaryColor;
    if (theme.secondaryColor) cssVars['--brand-secondary'] = theme.secondaryColor;
    if (theme.accentColor) cssVars['--brand-accent'] = theme.accentColor;
    if (theme.backgroundColor) cssVars['--brand-bg'] = theme.backgroundColor;
    if (theme.textColor) cssVars['--brand-text'] = theme.textColor;
    if (theme.headingFont) cssVars['--brand-heading-font'] = theme.headingFont;
    if (theme.bodyFont) cssVars['--brand-body-font'] = theme.bodyFont;
    if (theme.palette?.length) {
      theme.palette.forEach((swatch, i) => {
        const slug = swatch.name.toLowerCase().replace(/\s+/g, '-');
        cssVars[`--brand-color-${slug}`] = swatch.hex;
        cssVars[`--brand-palette-${i}`] = swatch.hex;
      });
    }

    const families: string[] = [];
    const SYSTEM_FONTS = new Set(['system-ui', 'sans-serif', 'serif', 'monospace', 'Arial', 'Georgia', 'Times New Roman']);
    if (theme.headingFont && !SYSTEM_FONTS.has(theme.headingFont)) {
      families.push(theme.headingFont.replace(/\s+/g, '+') + ':wght@400;600;700');
    }
    if (theme.bodyFont && theme.bodyFont !== theme.headingFont && !SYSTEM_FONTS.has(theme.bodyFont)) {
      families.push(theme.bodyFont.replace(/\s+/g, '+') + ':wght@400;500');
    }
    const googleFontsUrl = families.length
      ? `https://fonts.googleapis.com/css2?${families.map(f => `family=${f}`).join('&')}&display=swap`
      : null;

    return reply.send({ theme, cssVariables: cssVars, googleFontsUrl });
  });

  app.get<{ Params: { id: string } }>('/api/floors/:id/costs', async (request) => {
    return orchestrator.getFloorCosts(request.params.id);
  });

  // Generate brand direction logos — called by the gate screen to produce logo previews
  // for each parsed brand direction. Stores URLs in a floor-level cache.
  app.post<{
    Params: { id: string };
    Body: {
      directions: Array<{
        name: string;
        logoDirection: string;
        colors: string[];
        tagline?: string;
        concept?: string;
        voice?: string;
        typography?: string;
      }>;
      regenerate?: boolean;
    };
  }>('/api/floors/:id/brand-logos', async (request, reply) => {
    const floor = orchestrator.getFloor(request.params.id);
    if (!floor) return reply.code(404).send({ error: 'Floor not found' });

    const { directions, regenerate } = request.body;
    if (!directions?.length) return reply.code(400).send({ error: 'No directions provided' });

    // Check if logos already exist for this floor (full candidate set) — skip if regenerate requested
    if (!regenerate) {
      const existing = (floor as any).brandLogoCandidates as Record<string, string[]> | undefined;
      if (existing && Object.keys(existing).length >= directions.length) {
        return { logos: existing, cached: true };
      }
    }

    // logos now maps letter → array of candidate URLs (3 per direction)
    const logos: Record<string, string[]> = {};
    const mediaGen = orchestrator.mediaGenerator;
    const CANDIDATES_PER_DIRECTION = 3;

    // Generate logo candidates in parallel (one batch per direction)
    const letterMap = ['A', 'B', 'C'] as const;
    const promises = directions.slice(0, 3).map(async (dir, idx) => {
      const letter = letterMap[idx] ?? 'A';

      try {
        const candidates = await mediaGen.generateLogoCandidates(
          floor.id,
          dir.name,
          dir.logoDirection,
          dir.colors,
          CANDIDATES_PER_DIRECTION,
          {
            tagline: dir.tagline,
            concept: dir.concept,
            voice: dir.voice,
            typography: dir.typography,
          },
        );
        const urls = candidates.map(c => c.url).filter(Boolean);
        if (urls.length > 0) {
          logos[letter] = urls;
        }
      } catch (err) {
        console.warn(`[Logo] Failed to generate candidates for direction ${letter}:`, (err as Error).message);
      }
    });

    await Promise.all(promises);

    // Cache on the floor object so subsequent loads don't regenerate
    (floor as any).brandLogoCandidates = logos;

    return { logos, cached: false };
  });

  // Agent status — what agents are doing on this floor
  app.get<{ Params: { id: string } }>('/api/floors/:id/agent-status', async (request, reply) => {
    const floor = orchestrator.getFloor(request.params.id);
    if (!floor) return reply.code(404).send({ error: 'Floor not found' });
    return orchestrator.getFloorAgentStatus(request.params.id);
  });

  // Floor stats — real metrics (spend, tasks, phases, agent utilization)
  app.get<{ Params: { id: string } }>('/api/floors/:id/stats', async (request, reply) => {
    const stats = orchestrator.getFloorStats(request.params.id);
    if (!stats) return reply.code(404).send({ error: 'Floor not found' });
    return stats;
  });

  // Delete floor permanently
  app.delete<{ Params: { id: string } }>('/api/floors/:id', async (request, reply) => {
    const floor = orchestrator.getFloor(request.params.id);
    if (!floor) return reply.code(404).send({ error: 'Floor not found' });
    const ok = await orchestrator.deleteFloor(request.params.id);
    if (!ok) return reply.code(500).send({ error: 'Delete failed' });
    return reply.code(200).send({ success: true });
  });

  // Kill switch
  app.post<{ Params: { id: string } }>('/api/floors/:id/kill', async (request, reply) => {
    const floor = orchestrator.getFloor(request.params.id);
    if (!floor) return reply.code(404).send({ error: 'Floor not found' });
    orchestrator.killFloor(request.params.id);
    return reply.code(200).send({ success: true });
  });

  // Resume
  app.post<{ Params: { id: string } }>('/api/floors/:id/resume', async (request, reply) => {
    const floor = orchestrator.getFloor(request.params.id);
    if (!floor) return reply.code(404).send({ error: 'Floor not found' });
    orchestrator.resumeFloor(request.params.id);
    return reply.code(200).send({ success: true });
  });

  // Trust ladder promotion (owner-only action)
  app.post<{ Params: { id: string } }>('/api/floors/:id/promote', async (request, reply) => {
    const check = orchestrator.checkCanPromote(request.params.id);
    if (!check.eligible) return reply.code(400).send({ error: `Cannot promote: ${check.reason}` });
    const promoted = orchestrator.promoteFloor(request.params.id);
    if (!promoted) return reply.code(400).send({ error: 'Promotion failed' });
    return reply.code(200).send({ success: true, level: orchestrator.getTrustLevel(request.params.id) });
  });

  // Trust level status
  app.get<{ Params: { id: string } }>('/api/floors/:id/trust', async (request, reply) => {
    const level = orchestrator.getTrustLevel(request.params.id);
    const check = orchestrator.checkCanPromote(request.params.id);
    return reply.code(200).send({ level, canPromote: check });
  });

  // Phase data
  app.get<{ Params: { id: string } }>('/api/floors/:id/phases', async (request, reply) => {
    const phases = orchestrator.getPhases(request.params.id);
    if (!phases.length) return reply.code(404).send({ error: 'Floor not found or phases not initialized' });
    return phases;
  });

  // Seed Foundation Sprint tasks (recovery for floors that lost them)
  app.post<{ Params: { id: string } }>('/api/floors/:id/seed-foundation', async (request, reply) => {
    const ok = await orchestrator.seedFoundationTasks(request.params.id);
    if (!ok) return reply.code(400).send({ error: 'Floor not found or Foundation tasks already exist' });
    return reply.code(200).send({ success: true });
  });

  // Approve a phase gate (owner action)
  app.post<{
    Params: { id: string; phase: string };
    Body: { feedback?: string };
  }>('/api/floors/:id/approve-gate/:phase', async (request, reply) => {
    const phaseNumber = parseInt(request.params.phase, 10);
    if (isNaN(phaseNumber)) return reply.code(400).send({ error: 'Invalid phase number' });
    const floor = orchestrator.getFloor(request.params.id);
    if (!floor) return reply.code(404).send({ error: 'Floor not found' });
    // For Gate 3, check if brand is missing BEFORE calling approvePhaseGate so we can
    // return a specific error message (not just generic "failed").
    if (phaseNumber === 3 && !floor.selectedBrand?.name) {
      return reply.code(422).send({ error: 'You must select a brand direction before approving the Foundation. Go back and pick a brand.' });
    }
    const ok = await orchestrator.approvePhaseGate(request.params.id, phaseNumber);
    if (!ok) return reply.code(500).send({ error: 'Gate approval failed — please retry' });
    // Return updated floor state so the frontend can navigate to the correct destination
    // without guessing based on nextPhase alone. This fixes "goes to wrong page" and
    // "doesn't go all the way through" — the client now has authoritative state to route from.
    const updatedFloor = orchestrator.getFloor(request.params.id);
    const costs = updatedFloor ? orchestrator.getFloorCosts(updatedFloor.id) : null;
    return reply.code(200).send({
      success: true,
      nextPhase: phaseNumber + 1,
      floor: updatedFloor
        ? { ...updatedFloor, spentCents: costs?.spentCents ?? updatedFloor.spentCents }
        : null,
      currentPhase: updatedFloor?.currentPhase ?? phaseNumber + 1,
      status: updatedFloor?.status ?? 'building',
      brandState: updatedFloor?.brandState ?? null,
    });
  });

  // Content production tasks — returns all phase 5 tasks with full result content.
  // This is the data endpoint for the 'Review content production' detail view.
  // The frontend navigates here after clicking 'Review content production'.
  app.get<{ Params: { id: string } }>(
    '/api/floors/:id/content-tasks',
    async (request, reply) => {
      const floorId = request.params.id;
      const floor = orchestrator.getFloor(floorId);
      if (!floor) return reply.code(404).send({ error: 'Floor not found' });

      const CONTENT_PHASE = 5;
      const tasks = orchestrator.getFloorTasks(floorId);
      const contentTasks = tasks.filter(t => t.phaseNumber === CONTENT_PHASE);

      // Also attempt to load from Supabase if in-memory is empty
      // (handles server restart where restoreWithStatus may have missed tasks)
      if (contentTasks.length === 0) {
        // Log for diagnostics — caller should see this in server logs
        request.log.warn(
          { floorId, currentPhase: floor.currentPhase },
          '[content-tasks] No phase 5 tasks in memory — floor may need recovery',
        );
      }

      return reply.code(200).send({
        floorId,
        floorName: floor.name,
        currentPhase: floor.currentPhase,
        floorStatus: floor.status,
        brandState: floor.brandState,
        contentPhase: CONTENT_PHASE,
        tasks: contentTasks.map(t => ({
          id: t.id,
          taskType: t.taskType,
          description: t.description,
          status: t.status,
          assignedAgent: t.assignedAgent,
          priority: t.priority,
          phaseNumber: t.phaseNumber,
          result: t.result,
          reviewStatus: t.reviewStatus,
          reviewFeedback: t.reviewFeedback,
          createdAt: t.createdAt,
          completedAt: t.completedAt,
          attempts: t.attempts,
          outputFiles: t.outputFiles,
        })),
        taskCount: contentTasks.length,
        completedCount: contentTasks.filter(t => t.status === 'completed').length,
        allTerminal: contentTasks.length > 0 &&
          contentTasks.every(t => ['completed', 'escalated'].includes(t.status)),
        canApprove: floor.currentPhase <= CONTENT_PHASE,
        alreadyAdvanced: floor.currentPhase > CONTENT_PHASE,
      });
    },
  );

  // Content review readiness check — returns whether phase 5 tasks are loaded and terminal.
  // The frontend should call this before enabling the Review button to avoid pressing it
  // when task data hasn't fully hydrated.
  app.get<{ Params: { id: string } }>(
    '/api/floors/:id/content-review-readiness',
    async (request, reply) => {
      const floorId = request.params.id;
      const floor = orchestrator.getFloor(floorId);
      if (!floor) return reply.code(404).send({ error: 'Floor not found' });

      const CONTENT_PHASE = 5;

      // Already advanced — button should navigate forward, not submit
      if (floor.currentPhase > CONTENT_PHASE) {
        return reply.code(200).send({
          ready: true,
          alreadyAdvanced: true,
          currentPhase: floor.currentPhase,
          message: `Floor already past phase ${CONTENT_PHASE}`,
        });
      }

      const tasks = orchestrator.getFloorTasks(floorId);
      const phase5Tasks = tasks.filter(t => t.phaseNumber === CONTENT_PHASE);
      const terminalStatuses = ['completed', 'escalated'] as const;
      const terminalCount = phase5Tasks.filter(t => terminalStatuses.includes(t.status as typeof terminalStatuses[number])).length;
      const nonTerminalCount = phase5Tasks.length - terminalCount;
      const allTerminal = phase5Tasks.length > 0 && nonTerminalCount === 0;

      return reply.code(200).send({
        ready: phase5Tasks.length > 0,
        allTasksTerminal: allTerminal,
        taskCount: phase5Tasks.length,
        terminalCount,
        nonTerminalCount,
        currentPhase: floor.currentPhase,
        taskSummary: phase5Tasks.map(t => ({
          taskType: t.taskType,
          status: t.status,
          agent: t.assignedAgent,
        })),
        message: phase5Tasks.length === 0
          ? 'Phase 5 tasks not yet loaded — task data may be hydrating'
          : allTerminal
            ? 'All phase 5 tasks complete — ready to approve'
            : `${nonTerminalCount} task(s) still in progress`,
      });
    },
  );

  // Approve Content Review — transitions from Phase 5 (Content Production) gate to Phase 6 (Staging & QA).
  // This is the handler for the 'Review' button on the content production page.
  // Duplicate-click safe: in-flight requests are deduplicated per floor ID.
  // Returns full floor state so the frontend can navigate to the correct destination.
  const contentReviewApprovalInFlight = new Set<string>();
  app.post<{ Params: { id: string }; Body: { feedback?: string } }>(
    '/api/floors/:id/approve-content-review',
    async (request, reply) => {
      const floorId = request.params.id;

      // Duplicate-click guard
      if (contentReviewApprovalInFlight.has(floorId)) {
        const floor = orchestrator.getFloor(floorId);
        const costs = floor ? orchestrator.getFloorCosts(floor.id) : null;
        return reply.code(202).send({
          success: true,
          deduplicated: true,
          floor: floor
            ? { ...floor, spentCents: costs?.spentCents ?? floor.spentCents }
            : null,
          currentPhase: floor?.currentPhase ?? null,
          status: floor?.status ?? 'unknown',
          message: 'Content review approval already in progress',
        });
      }

      contentReviewApprovalInFlight.add(floorId);
      try {
        const floor = orchestrator.getFloor(floorId);
        if (!floor) {
          return reply.code(404).send({ success: false, error: 'Floor not found' });
        }

        const CONTENT_PHASE = 5;

        // Idempotent: if floor has already advanced past phase 5, return current state
        // immediately. approvePhaseGate returns `false` for already-advanced floors —
        // treat that as success (not a 500) so the frontend can navigate correctly.
        if (floor.currentPhase > CONTENT_PHASE) {
          const costs = orchestrator.getFloorCosts(floor.id);
          return reply.code(200).send({
            success: true,
            alreadyAdvanced: true,
            floor: { ...floor, spentCents: costs?.spentCents ?? floor.spentCents },
            currentPhase: floor.currentPhase,
            nextPhase: CONTENT_PHASE + 1,
            status: floor.status,
            brandState: floor.brandState ?? null,
            message: `Floor already past phase ${CONTENT_PHASE} (currentPhase=${floor.currentPhase})`,
          });
        }

        // Validate that phase 5 tasks exist and are loaded before allowing approval.
        // If tasks aren't loaded the button should be disabled by the frontend, but
        // this server-side guard ensures we never gate-advance with missing task data.
        const tasks = orchestrator.getFloorTasks(floorId);
        const phase5Tasks = tasks.filter(t => t.phaseNumber === CONTENT_PHASE);
        if (phase5Tasks.length === 0) {
          return reply.code(422).send({
            success: false,
            error: 'Phase 5 tasks not found — task data may not be fully loaded. Refresh and try again.',
            code: 'TASKS_NOT_LOADED',
          });
        }

        // Check for non-terminal tasks: warn but do not block (owner may force-approve).
        const nonTerminal = phase5Tasks.filter(
          t => !['completed', 'escalated'].includes(t.status),
        );
        if (nonTerminal.length > 0) {
          // Log for diagnostics but continue — owner is explicitly approving.
          request.log.warn(
            { floorId, nonTerminalCount: nonTerminal.length, taskTypes: nonTerminal.map(t => t.taskType) },
            '[approve-content-review] Approving gate with non-terminal phase 5 tasks',
          );
        }

        // Phase 5 = Content Production gate. Approve gate 5 → seeds Phase 6 (Staging & QA).
        let ok: boolean;
        try {
          ok = await orchestrator.approvePhaseGate(floorId, CONTENT_PHASE);
        } catch (gateErr) {
          const errMsg = gateErr instanceof Error ? gateErr.message : String(gateErr);
          request.log.error({ floorId, error: errMsg }, '[approve-content-review] approvePhaseGate threw');
          return reply.code(500).send({
            success: false,
            error: `Gate approval failed: ${errMsg}`,
            code: 'GATE_ERROR',
          });
        }

        // approvePhaseGate returns false only when saveFloor fails (DB write error).
        // The idempotent already-advanced case is handled above, so false here is
        // a genuine persistence failure.
        if (!ok) {
          return reply.code(500).send({
            success: false,
            error: 'Failed to persist content review gate approval — database write error. Please retry.',
            code: 'DB_WRITE_FAILED',
          });
        }

        const updatedFloor = orchestrator.getFloor(floorId);
        const costs = updatedFloor ? orchestrator.getFloorCosts(updatedFloor.id) : null;
        return reply.code(200).send({
          success: true,
          floor: updatedFloor
            ? { ...updatedFloor, spentCents: costs?.spentCents ?? updatedFloor.spentCents }
            : null,
          currentPhase: updatedFloor?.currentPhase ?? CONTENT_PHASE + 1,
          nextPhase: CONTENT_PHASE + 1,
          status: updatedFloor?.status ?? 'building',
          brandState: updatedFloor?.brandState ?? null,
        });
      } catch (unexpectedErr) {
        // Catch-all: ensure the in-flight lock is always released (finally handles that)
        // and return a structured error instead of crashing Fastify's error handler.
        const errMsg = unexpectedErr instanceof Error ? unexpectedErr.message : String(unexpectedErr);
        request.log.error({ floorId, error: errMsg }, '[approve-content-review] unexpected error');
        return reply.code(500).send({
          success: false,
          error: `Unexpected error during content review: ${errMsg}`,
          code: 'UNEXPECTED_ERROR',
        });
      } finally {
        contentReviewApprovalInFlight.delete(floorId);
      }
    },
  );

  // Phase readiness diagnostic — returns full phase state for debugging the Review button.
  // Call GET /api/floors/:id/phase-readiness/:phase to inspect what's blocking a phase.
  app.get<{ Params: { id: string; phase: string } }>(
    '/api/floors/:id/phase-readiness/:phase',
    async (request, reply) => {
      const phaseNumber = parseInt(request.params.phase, 10);
      if (isNaN(phaseNumber)) return reply.code(400).send({ error: 'Invalid phase number' });
      const result = await orchestrator.getPhaseReadiness(request.params.id, phaseNumber);
      return reply.code(result.ready ? 200 : 422).send(result);
    },
  );

  // Recovery endpoint: force-reload all tasks for a floor from Supabase into memory.
  // Use this when the Review button fails because tasks aren't in memory after a restart.
  // POST /api/floors/:id/reload-tasks
  app.post<{ Params: { id: string } }>(
    '/api/floors/:id/reload-tasks',
    async (request, reply) => {
      const floorId = request.params.id;
      const floor = orchestrator.getFloor(floorId);
      if (!floor) return reply.code(404).send({ error: 'Floor not found' });

      try {
        const { loadAllTasks } = await import('../../integrations/supabase.js');
        const allTasks = await loadAllTasks(floorId);

        let loadedCount = 0;
        let skippedCount = 0;
        const seen = new Set<string>();

        // Sort newest-first so dedup keeps the latest version of each task type
        const sorted = [...allTasks].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );

        for (const task of sorted) {
          const key = `${task.phaseNumber}:${task.taskType}`;
          // Skip if this exact task ID is already in memory (already loaded)
          const existing = orchestrator.getTask(task.id);
          if (existing) {
            skippedCount++;
            continue;
          }
          if (seen.has(key)) {
            skippedCount++;
            continue;
          }
          seen.add(key);
          // Use restoreWithStatus to preserve completed/escalated state
          (orchestrator as any).taskManager.restoreWithStatus(task);
          loadedCount++;
        }

        const tasks = orchestrator.getFloorTasks(floorId);
        const contentTasks = tasks.filter(t => t.phaseNumber === 5);

        return reply.code(200).send({
          success: true,
          floorId,
          floorName: floor.name,
          currentPhase: floor.currentPhase,
          totalTasksInDb: allTasks.length,
          loadedIntoMemory: loadedCount,
          alreadyInMemory: skippedCount,
          totalInMemoryAfter: tasks.length,
          phase5Tasks: contentTasks.map(t => ({
            id: t.id,
            taskType: t.taskType,
            status: t.status,
            phaseNumber: t.phaseNumber,
          })),
          message: loadedCount > 0
            ? `Loaded ${loadedCount} tasks into memory. Review button should now work.`
            : 'No new tasks loaded — tasks may already be in memory or DB is empty.',
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ success: false, error: errMsg });
      }
    },
  );

  // Approve Foundation — transitions floor.status → 'building' and starts Phase 4.
  // This is the handler for the 'Approve Foundation — Start Building' CTA.
  // Duplicate-click safe: in-flight requests are deduplicated per floor ID.
  const foundationApprovalInFlight = new Set<string>();
  app.post<{ Params: { id: string } }>(
    '/api/floors/:id/approve-foundation',
    async (request, reply) => {
      const floorId = request.params.id;

      // Duplicate-click guard: if a request for this floor is already processing, return 202
      if (foundationApprovalInFlight.has(floorId)) {
        const floor = orchestrator.getFloor(floorId);
        return reply.code(202).send({
          success: true,
          deduplicated: true,
          status: floor?.status ?? 'unknown',
          message: 'Approval already in progress',
        });
      }

      foundationApprovalInFlight.add(floorId);
      try {
        const result = await orchestrator.approveFoundation(floorId);
        if (!result.success) {
          return reply.code(result.error === 'Floor not found' ? 404 : 500).send({
            success: false,
            error: result.error,
          });
        }
        return reply.code(200).send({
          success: true,
          floor: result.floor,
          status: result.floor?.status,
          currentPhase: result.floor?.currentPhase,
        });
      } finally {
        // Always release the in-flight lock, even on error
        foundationApprovalInFlight.delete(floorId);
      }
    },
  );
}
