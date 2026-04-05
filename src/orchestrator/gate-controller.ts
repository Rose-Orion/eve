/**
 * GateController — Extracted phase gate logic from Orchestrator.
 * Manages phase gate states, approvals, and phase transitions.
 */

import type { Floor } from '../config/types.js';

export interface GateState {
  phase: number;
  status: 'active' | 'gate-waiting' | 'completed';
  approvedAt?: Date;
}

export class GateController {
  private gateStates = new Map<string, Map<number, GateState>>();

  /** Initialize gates for a floor. */
  initFloor(floorId: string): void {
    if (!this.gateStates.has(floorId)) {
      this.gateStates.set(floorId, new Map());
    }
  }

  /** Get the current gate status for a phase. */
  getGateStatus(floorId: string, phaseNumber: number): GateState | undefined {
    return this.gateStates.get(floorId)?.get(phaseNumber);
  }

  /** Set gate to waiting for approval. */
  setGateWaiting(floorId: string, phaseNumber: number): void {
    const floors = this.gateStates.get(floorId);
    if (floors) {
      floors.set(phaseNumber, {
        phase: phaseNumber,
        status: 'gate-waiting',
      });
    }
  }

  /** Approve a gate and record approval time. */
  approveGate(floorId: string, phaseNumber: number): boolean {
    const floors = this.gateStates.get(floorId);
    if (!floors) return false;

    const gate = floors.get(phaseNumber);
    if (!gate) return false;

    gate.status = 'completed';
    gate.approvedAt = new Date();
    return true;
  }

  /** Check if a gate is waiting for approval. */
  isGateWaiting(floorId: string, phaseNumber: number): boolean {
    const gate = this.getGateStatus(floorId, phaseNumber);
    return gate?.status === 'gate-waiting';
  }

  /** Get all gates for a floor. */
  getAllGates(floorId: string): Array<[number, GateState]> {
    const floors = this.gateStates.get(floorId);
    return floors ? Array.from(floors.entries()) : [];
  }

  /** Check readiness for advancing to a phase. */
  canAdvanceToPhase(floor: Floor, targetPhase: number): {
    allowed: boolean;
    blockedBy: string[];
  } {
    const blockedBy: string[] = [];

    // Phase 3 is the foundation gate — requires explicit approval
    if (targetPhase === 3 && floor.brandState !== 'foundation-approved') {
      blockedBy.push('Foundation not approved');
    }

    // All phases require the previous phase to be completed
    if (targetPhase > 1) {
      const previousPhase = targetPhase - 1;
      // This would be checked against actual phase completion in the full implementation
    }

    return {
      allowed: blockedBy.length === 0,
      blockedBy,
    };
  }

  /** Remove floor gates. */
  removeFloor(floorId: string): void {
    this.gateStates.delete(floorId);
  }
}
