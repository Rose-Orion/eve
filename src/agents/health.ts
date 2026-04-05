/**
 * Agent Health Monitor — tracks heartbeats from real agents.
 * Alerts when agents go silent past their expected interval.
 */

import type { AgentId, RealAgentId } from '../config/types.js';
import { REAL_AGENTS } from '../config/types.js';
import type { EventBus } from '../orchestrator/event-bus.js';
import type { AgentRegistry } from './registry.js';

const HEARTBEAT_TIMEOUT_MS = 120_000; // 2 minutes without heartbeat = stale
const HEARTBEAT_CRITICAL_MS = 300_000; // 5 minutes = critical

export class AgentHealthMonitor {
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private alertedAgents = new Set<string>(); // Avoid repeat alerts

  constructor(
    private eventBus: EventBus,
    private registry: AgentRegistry,
  ) {
    this.eventBus.on('agent:heartbeat', (data) => {
      this.registry.recordHeartbeat(data.floorId, data.agentId);
      // Clear alert state on heartbeat received
      this.alertedAgents.delete(`${data.floorId}:${data.agentId}`);
    });
  }

  /** Start periodic health checks. */
  start(intervalMs: number = 30_000): void {
    this.checkInterval = setInterval(() => this.check(), intervalMs);
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /** Check all registered real agents for stale heartbeats. */
  private check(): void {
    // Iterate all floors and check each real agent's heartbeat
    const allAgents = this.registry.getAllAgents();
    const now = Date.now();

    for (const agent of allAgents) {
      // Only check real agents — virtual agents don't have heartbeats
      if (!(REAL_AGENTS as readonly string[]).includes(agent.id)) continue;
      if (!agent.floorId) continue;

      const key = `${agent.floorId}:${agent.id}`;

      // Skip if agent is offline (expected)
      if (agent.status === 'offline') continue;

      // No heartbeat ever received
      if (!agent.lastHeartbeat) {
        if (!this.alertedAgents.has(key)) {
          this.alertedAgents.add(key);
          this.eventBus.emit('agent:status-changed', {
            floorId: agent.floorId,
            agentId: agent.id,
            status: 'no-heartbeat',
          });
        }
        continue;
      }

      const elapsed = now - agent.lastHeartbeat.getTime();

      if (elapsed > HEARTBEAT_CRITICAL_MS) {
        // Critical — agent may have crashed
        if (!this.alertedAgents.has(key)) {
          this.alertedAgents.add(key);
          this.registry.updateStatus(agent.floorId, agent.id, 'error');
          this.eventBus.emit('agent:status-changed', {
            floorId: agent.floorId,
            agentId: agent.id,
            status: 'critical-stale',
          });
          console.warn(`[Health] CRITICAL: ${agent.id} on floor ${agent.floorId} — no heartbeat for ${Math.round(elapsed / 1000)}s`);
        }
      } else if (elapsed > HEARTBEAT_TIMEOUT_MS) {
        // Warning — agent is slow
        if (!this.alertedAgents.has(key)) {
          this.alertedAgents.add(key);
          this.eventBus.emit('agent:status-changed', {
            floorId: agent.floorId,
            agentId: agent.id,
            status: 'stale',
          });
          console.warn(`[Health] WARNING: ${agent.id} on floor ${agent.floorId} — no heartbeat for ${Math.round(elapsed / 1000)}s`);
        }
      }
    }
  }

  /** Check if a specific agent is healthy. */
  isHealthy(floorId: string, agentId: RealAgentId): boolean {
    const agent = this.registry.getAgent(floorId, agentId);
    if (!agent || !agent.lastHeartbeat) return false;
    return Date.now() - agent.lastHeartbeat.getTime() < HEARTBEAT_TIMEOUT_MS;
  }

  /** Get health status for all real agents on a floor. */
  getFloorHealth(floorId: string): Array<{ agentId: AgentId; healthy: boolean; lastHeartbeatAgo: number | null }> {
    const agents = this.registry.getFloorAgents(floorId);
    return agents
      .filter(a => (REAL_AGENTS as readonly string[]).includes(a.id))
      .map(a => ({
        agentId: a.id,
        healthy: a.lastHeartbeat ? (Date.now() - a.lastHeartbeat.getTime() < HEARTBEAT_TIMEOUT_MS) : false,
        lastHeartbeatAgo: a.lastHeartbeat ? Date.now() - a.lastHeartbeat.getTime() : null,
      }));
  }
}
