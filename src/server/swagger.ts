/**
 * Swagger Configuration — OpenAPI documentation registration for the Fastify server.
 * Provides interactive API documentation at /docs.
 */

import type { FastifyInstance } from 'fastify';

export async function registerSwagger(app: FastifyInstance): Promise<void> {
  try {
    await app.register(import('@fastify/swagger'), {
      openapi: {
        openapi: '3.0.0',
        info: {
          title: 'EVE Orchestrator API',
          description: 'API for the EVE autonomous business-building system',
          version: '1.0.0',
          contact: {
            name: 'EVE Team',
          },
        },
        servers: [
          {
            url: `http://localhost:${process.env.PORT || 3000}`,
            description: 'Development server',
          },
          {
            url: process.env.PRODUCTION_URL || 'https://api.eve.example.com',
            description: 'Production server',
          },
        ],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
              description: 'Bearer token for API authentication',
            },
          },
          schemas: {
            Error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                statusCode: { type: 'number' },
              },
            },
            Floor: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                slug: { type: 'string' },
                status: { type: 'string' },
                currentPhase: { type: 'number' },
                budgetCeilingCents: { type: 'number' },
                createdAt: { type: 'string', format: 'date-time' },
              },
            },
            Task: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                floorId: { type: 'string' },
                taskType: { type: 'string' },
                status: { type: 'string' },
                assignedAgent: { type: 'string' },
                createdAt: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
        tags: [
          {
            name: 'Floors',
            description: 'Floor management endpoints',
          },
          {
            name: 'Tasks',
            description: 'Task management endpoints',
          },
          {
            name: 'Budget',
            description: 'Budget tracking endpoints',
          },
          {
            name: 'Health',
            description: 'System health endpoints',
          },
        ],
      },
    });

    await app.register(import('@fastify/swagger-ui'), {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: false,
      },
      logLevel: 'info',
      staticCSP: true,
    });

    console.log('[API] Swagger documentation registered at /docs');
  } catch (err) {
    console.error('[API] Swagger registration failed:', (err as Error).message);
    // Non-fatal — API continues without docs
  }
}
