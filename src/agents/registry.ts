/**
 * Agent Registry — tracks all agents (real + virtual) and their dispatch type.
 * Central lookup for the Orchestrator to know how to reach each agent.
 */

import type { AgentId, RealAgentId, VirtualAgentId } from '../config/types.js';
import { isRealAgent, REAL_AGENTS, VIRTUAL_AGENTS } from '../config/types.js';

export type DispatchType = 'virtual' | 'openclaw';

export type AgentStatus = 'idle' | 'working' | 'offline' | 'error';

export interface AgentRecord {
  id: AgentId;
  dispatchType: DispatchType;
  status: AgentStatus;
  floorId: string | null;
  currentTaskId: string | null;
  openclawAgentId: string | null; // Only for real agents
  lastHeartbeat: Date | null;
}

export class AgentRegistry {
  private agents = new Map<string, AgentRecord>();

  /** Register all agents for a floor. Real agents get OpenClaw IDs. */
  registerFloorAgents(floorId: string, activeAgents: AgentId[], openclawIds?: Map<RealAgentId, string>): void {
    for (const agentId of activeAgents) {
      const key = `${floorId}:${agentId}`;
      this.agents.set(key, {
        id: agentId,
        dispatchType: isRealAgent(agentId) ? 'openclaw' : 'virtual',
        status: 'idle',
        floorId,
        currentTaskId: null,
        openclawAgentId: openclawIds?.get(agentId as RealAgentId) ?? null,
        lastHeartbeat: null,
      });
    }
  }

  /** Get an agent record for a specific floor. */
  getAgent(floorId: string, agentId: AgentId): AgentRecord | undefined {
    return this.agents.get(`${floorId}:${agentId}`);
  }

  /** Get all agents for a floor. */
  getFloorAgents(floorId: string): AgentRecord[] {
    const records: AgentRecord[] = [];
    for (const [key, record] of this.agents) {
      if (key.startsWith(`${floorId}:`)) {
        records.push(record);
      }
    }
    return records;
  }

  /** Update agent status. */
  updateStatus(floorId: string, agentId: AgentId, status: AgentStatus, taskId?: string | null): void {
    const record = this.agents.get(`${floorId}:${agentId}`);
    if (record) {
      record.status = status;
      if (taskId !== undefined) record.currentTaskId = taskId;
    }
  }

  /** Record a heartbeat from a real agent. */
  recordHeartbeat(floorId: string, agentId: AgentId): void {
    const record = this.agents.get(`${floorId}:${agentId}`);
    if (record) {
      record.lastHeartbeat = new Date();
    }
  }

  /** Get how to dispatch a task to an agent. */
  getDispatchType(agentId: AgentId): DispatchType {
    return isRealAgent(agentId) ? 'openclaw' : 'virtual';
  }

  /** Get count of currently working agents (optionally filtered by dispatch type). */
  getActiveCount(floorId?: string, dispatchType?: DispatchType): number {
    let count = 0;
    for (const record of this.agents.values()) {
      if (record.status !== 'working') continue;
      if (floorId && record.floorId !== floorId) continue;
      if (dispatchType && record.dispatchType !== dispatchType) continue;
      count++;
    }
    return count;
  }

  /** Get all agent records across all floors. */
  getAllAgents(): AgentRecord[] {
    return [...this.agents.values()];
  }

  /** Remove all agents for a floor. */
  removeFloorAgents(floorId: string): void {
    for (const key of [...this.agents.keys()]) {
      if (key.startsWith(`${floorId}:`)) {
        this.agents.delete(key);
      }
    }
  }
}
