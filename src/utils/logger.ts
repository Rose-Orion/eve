import pino from 'pino';

/**
 * Structured Logger — Pino-based logging with consistent formatting.
 * In development, uses pino-pretty for readable output.
 * In production, outputs structured JSON for log aggregation.
 */

const isDevelopment = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          singleLine: false,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

/**
 * Create a child logger for a specific module with context.
 */
export function createChildLogger(module: string, context?: Record<string, unknown>) {
  return logger.child({ module, ...context });
}

/**
 * Log a structured event with metadata.
 */
export function logEvent(
  level: 'info' | 'warn' | 'error' | 'debug',
  event: string,
  metadata?: Record<string, unknown>,
) {
  logger[level](metadata ?? {}, event);
}

/**
 * Log metrics for monitoring.
 */
export function logMetric(
  metricName: string,
  value: number,
  unit?: string,
  tags?: Record<string, string>,
) {
  logger.info(
    {
      metric: metricName,
      value,
      unit,
      tags,
    },
    `Metric: ${metricName} = ${value}${unit ? ` ${unit}` : ''}`,
  );
}

/**
 * Log task lifecycle events.
 */
export function logTaskEvent(
  taskId: string,
  event: string,
  status?: string,
  details?: Record<string, unknown>,
) {
  logger.info(
    {
      taskId: taskId.slice(0, 8),
      event,
      status,
      ...details,
    },
    `Task [${taskId.slice(0, 8)}] ${event}${status ? `: ${status}` : ''}`,
  );
}

/**
 * Log dispatch events.
 */
export function logDispatch(
  taskId: string,
  agentId: string,
  dispatchType: 'virtual' | 'real' | 'council',
  result: 'success' | 'failure',
  error?: string,
) {
  const level = result === 'success' ? 'info' : 'warn';
  logger[level](
    {
      taskId: taskId.slice(0, 8),
      agentId,
      dispatchType,
      result,
      error,
    },
    `Dispatch [${dispatchType.toUpperCase()}] task to ${agentId}: ${result}`,
  );
}

/**
 * Log cost tracking events.
 */
export function logCost(
  floorId: string,
  taskId: string,
  agentId: string,
  costCents: number,
  reason: string,
) {
  logger.info(
    {
      floorId: floorId.slice(0, 8),
      taskId: taskId.slice(0, 8),
      agentId,
      costCents,
      costDollars: costCents / 100,
      reason,
    },
    `Cost: $${costCents / 100} for ${agentId} — ${reason}`,
  );
}

/**
 * Log security/safety events.
 */
export function logSecurity(
  event: string,
  severity: 'info' | 'warn' | 'critical',
  details?: Record<string, unknown>,
) {
  const level = severity === 'critical' ? 'error' : severity === 'warn' ? 'warn' : 'info';
  logger[level](
    {
      event,
      severity,
      ...details,
    },
    `Security: ${event} [${severity}]`,
  );
}

export default logger;
