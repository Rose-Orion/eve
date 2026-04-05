/**
 * Error handling middleware for Fastify.
 */

import type { FastifyInstance } from 'fastify';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(async (error, _request, reply) => {
    const err = error as { statusCode?: number; message?: string };
    const statusCode = err.statusCode ?? 500;

    if (statusCode >= 500) {
      console.error(`[API Error]`, error);
    }

    reply.status(statusCode).send({
      error: statusCode >= 500 ? 'Internal server error' : (err.message ?? 'Unknown error'),
      statusCode,
    });
  });

  app.setNotFoundHandler(async (_request, reply) => {
    reply.status(404).send({ error: 'Not found', statusCode: 404 });
  });
}
