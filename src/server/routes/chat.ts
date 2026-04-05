/**
 * Chat relay API — owner communicates with Floor Manager via chat.
 */

import type { FastifyInstance } from 'fastify';
import type { Orchestrator } from '../../orchestrator/index.js';

export function registerChatRoutes(app: FastifyInstance, orchestrator: Orchestrator): void {
  // Send message to Floor Manager on a specific floor
  app.post<{
    Params: { floorId: string };
    Body: { message: string };
  }>('/api/chat/:floorId/message', async (request, reply) => {
    const { floorId } = request.params;
    const { message } = request.body;

    if (!message?.trim()) {
      return reply.code(400).send({ error: 'Message is required' });
    }

    const floor = orchestrator.getFloor(floorId);
    if (!floor) {
      return reply.code(404).send({ error: 'Floor not found' });
    }

    try {
      const result = await orchestrator.sendChatMessage(floorId, message);
      return result;
    } catch (err) {
      console.error(`[Chat] sendChatMessage failed for floor ${floorId}: ${(err as Error).message}`);
      return reply.code(500).send({ error: 'Failed to send message' });
    }
  });

  // Get chat history for a floor
  app.get<{ Params: { floorId: string } }>('/api/chat/:floorId/history', async (request, reply) => {
    const floor = orchestrator.getFloor(request.params.floorId);
    if (!floor) {
      return reply.code(404).send({ error: 'Floor not found' });
    }
    return orchestrator.getChatHistory(request.params.floorId);
  });
}
