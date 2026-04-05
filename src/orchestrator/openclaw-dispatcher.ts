/**
 * OpenClawDispatcher — dispatches tasks to real agents via the OpenClaw CLI.
 * Real agents: Floor Manager, Web Agent, Launch Agent, CEO Mode.
 */

import type { RealAgentId } from '../config/types.js';
import { isRealAgent } from '../config/types.js';
import { dispatchToAgent } from '../clients/openclaw.js';
import type { EventBus } from './event-bus.js';

export interface RealDispatchInput {
  taskId: string;
  floorId: string;
  agentId: RealAgentId;
  openclawAgentId: string;
  message: string;
}

export interface RealDispatchResult {
  success: boolean;
  output: string;
  error?: string;
}

export class OpenClawDispatcher {
  constructor(private eventBus: EventBus) {}

  async dispatch(input: RealDispatchInput): Promise<RealDispatchResult> {
    if (!isRealAgent(input.agentId)) {
      throw new Error(`${input.agentId} is a virtual agent — use VirtualDispatcher`);
    }

    const result = await dispatchToAgent(input.openclawAgentId, input.message);

    if (!result.success) {
      this.eventBus.emit('task:failed', {
        taskId: input.taskId,
        floorId: input.floorId,
        agentId: input.agentId,
        error: result.error ?? 'OpenClaw dispatch failed',
        attempt: 1,
      });

      return {
        success: false,
        output: '',
        error: result.error,
      };
    }

    return {
      success: true,
      output: result.output,
    };
  }
}
