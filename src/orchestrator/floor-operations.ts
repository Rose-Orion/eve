/**
 * FloorOperations — Extracted floor management methods from Orchestrator.
 * Handles floor creation, deletion, updates, and metadata queries.
 */

import type { Floor } from '../config/types.js';
import type { CreateFloorInput } from '../floors/creator.js';
import type { FloorAuthContext } from './action-executor.js';

export interface FloorOperationsState {
  floors: Map<string, Floor>;
  floorAuthContexts: Map<string, FloorAuthContext>;
}

export class FloorOperations {
  constructor(private state: FloorOperationsState) {}

  /** Get a floor by ID. */
  getFloor(floorId: string): Floor | undefined {
    return this.state.floors.get(floorId);
  }

  /** Get all floors. */
  getFloors(): Floor[] {
    return [...this.state.floors.values()];
  }

  /** Look up a floor by its display name (case-insensitive). */
  getFloorByName(name: string): Floor | undefined {
    const lower = name.toLowerCase();
    return [...this.state.floors.values()].find(f => f.name.toLowerCase() === lower);
  }

  /** Update a floor's settings. */
  updateFloor(floorId: string, updates: Record<string, unknown>): Floor | null {
    const floor = this.state.floors.get(floorId);
    if (!floor) return null;

    if (updates.name !== undefined && typeof updates.name === 'string') {
      floor.name = updates.name;
    }

    if (updates.budgetCeilingCents !== undefined && typeof updates.budgetCeilingCents === 'number') {
      const newCeiling = updates.budgetCeilingCents;
      if (newCeiling >= 100) {
        floor.budgetCeilingCents = newCeiling;
      }
    }

    if (updates.brandState !== undefined && typeof updates.brandState === 'string') {
      const validStates = ['pre-foundation', 'foundation-review', 'foundation-approved', 'brand-revision'];
      if (validStates.includes(updates.brandState)) {
        floor.brandState = updates.brandState as Floor['brandState'];
      }
    }

    if (updates.themeConfig !== undefined) {
      floor.themeConfig = updates.themeConfig as Floor['themeConfig'];
    }

    if (updates.selectedBrand !== undefined) {
      floor.selectedBrand = updates.selectedBrand as Floor['selectedBrand'];
    }

    return floor;
  }

  /** Store floor in the state map. */
  storeFloor(floor: Floor): void {
    this.state.floors.set(floor.id, floor);
  }

  /** Remove a floor from state. */
  removeFloor(floorId: string): boolean {
    return this.state.floors.delete(floorId);
  }

  /** Set OAuth/API credentials for a floor. */
  setFloorAuthContext(floorId: string, auth: Partial<FloorAuthContext>): void {
    const existing = this.state.floorAuthContexts.get(floorId) ?? { floorId };
    this.state.floorAuthContexts.set(floorId, { ...existing, ...auth });
  }

  /** Get the current auth context for a floor. */
  getFloorAuthContext(floorId: string): FloorAuthContext | undefined {
    return this.state.floorAuthContexts.get(floorId);
  }
}
