/**
 * PhaseManager — manages the 10-phase build pipeline for each floor.
 * Tracks phase status, enforces gate approvals, and triggers phase transitions.
 */

import type { EventBus } from './event-bus.js';
import type { PhaseRecord } from '../integrations/supabase.js';
import { savePhase, persistWithRetry } from '../integrations/supabase.js';

export type PhaseStatus = 'pending' | 'active' | 'gate-waiting' | 'completed' | 'skipped';

export interface Phase {
  number: number;
  name: string;
  status: PhaseStatus;
  requiresGate: boolean;
  startedAt: Date | null;
  completedAt: Date | null;
}

const PHASE_DEFINITIONS: Array<{ name: string; requiresGate: boolean }> = [
  { name: 'Idea Evaluation',        requiresGate: false },
  { name: 'Floor Initialization',   requiresGate: false },
  { name: 'Foundation Sprint',      requiresGate: true },  // Gate 1: Owner approves brand
  { name: 'Parallel Buildout',      requiresGate: false },
  { name: 'Content Production',     requiresGate: false },
  { name: 'Staging & QA',           requiresGate: true },  // Gate 2: Owner approves launch
  { name: 'Launch',                 requiresGate: false },
  { name: 'Ad Campaign Activation', requiresGate: true },  // Gate 3: Owner approves ad spend
  { name: 'Growth Operations',      requiresGate: false },
  { name: 'Optimization Loop',      requiresGate: false },
];

export class PhaseManager {
  private floors = new Map<string, Phase[]>();

  constructor(private eventBus: EventBus) {}

  /** Initialize phases for a new floor. */
  initFloor(floorId: string): Phase[] {
    const phases = PHASE_DEFINITIONS.map((def, i) => ({
      number: i + 1,
      name: def.name,
      status: 'pending' as PhaseStatus,
      requiresGate: def.requiresGate,
      startedAt: null,
      completedAt: null,
    }));

    this.floors.set(floorId, phases);
    return phases;
  }

  /** Activate a phase. Returns false if not valid. */
  activatePhase(floorId: string, phaseNumber: number): boolean {
    const phases = this.floors.get(floorId);
    if (!phases) return false;

    const phase = phases[phaseNumber - 1];
    if (!phase || phase.status !== 'pending') return false;

    // Check all prior phases are completed or skipped
    for (let i = 0; i < phaseNumber - 1; i++) {
      const prior = phases[i];
      if (prior && prior.status !== 'completed' && prior.status !== 'skipped') {
        return false;
      }
    }

    phase.status = 'active';
    phase.startedAt = new Date();

    persistWithRetry(() => savePhase({ floorId, phaseNumber: phase.number, name: phase.name, status: 'active', startedAt: phase.startedAt }), `phase:active:${floorId.slice(0, 8)}-p${phaseNumber}`);
    this.eventBus.emit('floor:phase-started', { floorId, phase: phaseNumber });
    return true;
  }

  /** Complete a phase. If gate required, moves to gate-waiting instead. */
  completePhase(floorId: string, phaseNumber: number): boolean {
    const phases = this.floors.get(floorId);
    if (!phases) return false;

    const phase = phases[phaseNumber - 1];
    if (!phase || phase.status !== 'active') return false;

    if (phase.requiresGate) {
      phase.status = 'gate-waiting';
      persistWithRetry(() => savePhase({ floorId, phaseNumber: phase.number, name: phase.name, status: 'gate-waiting' }), `phase:gate-wait:${floorId.slice(0, 8)}-p${phaseNumber}`);
      this.eventBus.emit('approval:needed', {
        floorId,
        taskId: `gate-${phaseNumber}`,
        type: `phase-${phaseNumber}-gate`,
      });
      return true;
    }

    phase.status = 'completed';
    phase.completedAt = new Date();
    persistWithRetry(() => savePhase({ floorId, phaseNumber: phase.number, name: phase.name, status: 'completed', completedAt: phase.completedAt }), `phase:complete:${floorId.slice(0, 8)}-p${phaseNumber}`);
    this.eventBus.emit('floor:phase-complete', { floorId, phase: phaseNumber });
    return true;
  }

  /** Approve a gate, completing the phase and allowing the next to start. */
  approveGate(floorId: string, phaseNumber: number): boolean {
    const phases = this.floors.get(floorId);
    if (!phases) return false;

    const phase = phases[phaseNumber - 1];
    if (!phase) return false;

    // Idempotent: if already completed (e.g. approvePhaseGate already ran), just persist
    if (phase.status === 'completed') {
      persistWithRetry(() => savePhase({ floorId, phaseNumber: phase.number, name: phase.name, status: 'completed', completedAt: phase.completedAt ?? new Date(), gateApproved: true, gateApprovedAt: phase.completedAt ?? new Date() }), `phase:gate-idem:${floorId.slice(0, 8)}-p${phaseNumber}`);
      return true;
    }

    if (phase.status !== 'gate-waiting') return false;

    phase.status = 'completed';
    phase.completedAt = new Date();
    persistWithRetry(() => savePhase({ floorId, phaseNumber: phase.number, name: phase.name, status: 'completed', completedAt: phase.completedAt, gateApproved: true, gateApprovedAt: phase.completedAt }), `phase:gate-approve:${floorId.slice(0, 8)}-p${phaseNumber}`);
    this.eventBus.emit('floor:phase-complete', { floorId, phase: phaseNumber });
    return true;
  }

  /** Get current active phase for a floor. */
  getCurrentPhase(floorId: string): Phase | null {
    const phases = this.floors.get(floorId);
    if (!phases) return null;
    return phases.find(p => p.status === 'active' || p.status === 'gate-waiting') ?? null;
  }

  /** Get all phases for a floor. */
  getPhases(floorId: string): Phase[] {
    return this.floors.get(floorId) ?? [];
  }

  removeFloor(floorId: string): void {
    this.floors.delete(floorId);
  }

  /**
   * Force-complete all phases up to and including phaseNumber
   * so that gate approval can proceed even if phases were skipped.
   */
  forceCompleteUpTo(floorId: string, phaseNumber: number): void {
    const phases = this.floors.get(floorId);
    if (!phases) return;

    for (let i = 0; i < phaseNumber; i++) {
      const phase = phases[i];
      if (!phase) continue;
      if (phase.status === 'pending') {
        phase.status = 'active';
        phase.startedAt = new Date();
      }
      if (phase.status === 'active') {
        if (phase.requiresGate && i === phaseNumber - 1) {
          // The target gate phase: move to gate-waiting so approveGate() can work
          phase.status = 'gate-waiting';
        } else if (!phase.requiresGate) {
          phase.status = 'completed';
          phase.completedAt = new Date();
        } else {
          // Prior gate phases that were never approved — force complete
          phase.status = 'completed';
          phase.completedAt = new Date();
        }
      }
    }

    // The gate phase itself must be in gate-waiting
    const gatePhasé = phases[phaseNumber - 1];
    if (gatePhasé && gatePhasé.status !== 'gate-waiting') {
      if (gatePhasé.status === 'active') {
        gatePhasé.status = 'gate-waiting';
      } else if (gatePhasé.status === 'pending') {
        gatePhasé.status = 'active';
        gatePhasé.startedAt = new Date();
        gatePhasé.status = 'gate-waiting';
      }
    }
  }

  /**
   * Recovery-only: force ALL phases 1..upToPhase to 'completed' (bypasses gate-waiting),
   * then activate the target phase so checkPhaseCompletion can fire the phase-complete event.
   */
  forceRecoveryActivate(floorId: string, targetPhase: number): void {
    const phases = this.floors.get(floorId);
    if (!phases) return;
    for (let i = 0; i < targetPhase - 1; i++) {
      const phase = phases[i];
      if (!phase) continue;
      phase.status = 'completed';
      phase.completedAt = phase.completedAt ?? new Date();
    }
    // Activate the target phase so completePhase() can work on it
    const target = phases[targetPhase - 1];
    if (target && target.status !== 'active') {
      target.status = 'active';
      target.startedAt = target.startedAt ?? new Date();
    }
  }

  /** Restore saved phase state from Supabase (used on crash recovery). */
  restorePhases(floorId: string, records: PhaseRecord[]): void {
    const phases = this.floors.get(floorId);
    if (!phases) return;

    for (const record of records) {
      const phase = phases[record.phaseNumber - 1];
      if (!phase) continue;
      // For completed phases: only treat as gate-waiting if the phase actually requires a gate
      // AND the gate hasn't been approved yet. Non-gate phases are always fully completed.
      if (record.status === 'completed') {
        phase.status = (phase.requiresGate && !record.gateApproved) ? 'gate-waiting' : 'completed';
      } else {
        phase.status = record.status === 'pending' ? 'pending' :
                       record.status === 'active' ? 'active' :
                       record.status === 'skipped' ? 'skipped' : 'pending';
      }
      phase.startedAt = record.startedAt ?? null;
      phase.completedAt = record.completedAt ?? null;
    }
  }
}
