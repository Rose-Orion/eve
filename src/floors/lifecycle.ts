/**
 * FloorLifecycle — state machine for floor status transitions.
 */

import type { FloorStatus } from '../config/types.js';
import type { EventBus } from '../orchestrator/event-bus.js';

const VALID_TRANSITIONS: Record<FloorStatus, FloorStatus[]> = {
  planning:  ['review', 'building'],
  review:    ['building', 'paused'],
  building:  ['staging', 'paused'],
  staging:   ['launched', 'building', 'paused'],
  launched:  ['operating', 'paused'],
  operating: ['paused'],
  paused:    ['building', 'staging', 'launched', 'operating', 'archived'],
  archived:  [],
};

export class FloorLifecycle {
  private statuses = new Map<string, FloorStatus>();

  constructor(private eventBus: EventBus) {}

  /** Initialize floor status. */
  init(floorId: string, status: FloorStatus = 'planning'): void {
    this.statuses.set(floorId, status);
  }

  /** Transition to a new status. Returns false if transition is invalid. */
  transition(floorId: string, newStatus: FloorStatus): boolean {
    const current = this.statuses.get(floorId);
    if (!current) return false;

    const allowed = VALID_TRANSITIONS[current];
    if (!allowed.includes(newStatus)) return false;

    this.statuses.set(floorId, newStatus);
    this.eventBus.emit('floor:status-changed', { floorId, status: newStatus });
    return true;
  }

  /** Get current status. */
  getStatus(floorId: string): FloorStatus | undefined {
    return this.statuses.get(floorId);
  }

  /** Check if a transition is valid without performing it. */
  canTransition(floorId: string, newStatus: FloorStatus): boolean {
    const current = this.statuses.get(floorId);
    if (!current) return false;
    return VALID_TRANSITIONS[current].includes(newStatus);
  }
}
