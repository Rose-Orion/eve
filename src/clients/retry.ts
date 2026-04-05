/**
 * Retry utility with exponential backoff for all API clients.
 *
 * Handles transient errors (rate limits, network blips, server errors)
 * so a single failed API call doesn't permanently kill a task.
 */

export interface RetryConfig {
  /** Max retry attempts (default: 3) */
  maxRetries: number;
  /** Initial delay in ms before first retry (default: 1000) */
  initialDelayMs: number;
  /** Backoff multiplier per retry (default: 2) */
  backoffMultiplier: number;
  /** Max delay cap in ms (default: 30000) */
  maxDelayMs: number;
  /** HTTP status codes that should trigger retry (default: [429, 500, 502, 503, 504]) */
  retryableStatuses: number[];
  /** Log prefix for retry messages */
  label: string;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 30_000,
  retryableStatuses: [429, 500, 502, 503, 504],
  label: 'API',
};

/**
 * Check if an error is retryable based on status code or error type.
 */
function isRetryable(error: unknown, config: RetryConfig): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();

    // Rate limit errors
    if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many requests')) {
      return true;
    }

    // Network errors
    if (msg.includes('econnreset') || msg.includes('econnrefused') ||
        msg.includes('etimedout') || msg.includes('socket hang up') ||
        msg.includes('network') || msg.includes('fetch failed')) {
      return true;
    }

    // Server errors (5xx)
    if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) {
      return true;
    }

    // Anthropic SDK overloaded error
    if (msg.includes('overloaded') || msg.includes('capacity')) {
      return true;
    }
  }

  // Check for status property on error objects
  if (typeof error === 'object' && error !== null) {
    const status = (error as Record<string, unknown>)['status'];
    if (typeof status === 'number' && config.retryableStatuses.includes(status)) {
      return true;
    }
  }

  return false;
}

/**
 * Extract retry-after delay from error (rate limit responses often include this).
 */
function getRetryAfterMs(error: unknown): number | null {
  if (typeof error === 'object' && error !== null) {
    const headers = (error as Record<string, unknown>)['headers'];
    if (typeof headers === 'object' && headers !== null) {
      const retryAfter = (headers as Record<string, unknown>)['retry-after'];
      if (typeof retryAfter === 'string') {
        const seconds = parseFloat(retryAfter);
        if (!isNaN(seconds)) return seconds * 1000;
      }
    }
  }
  return null;
}

/**
 * Execute a function with retry logic and exponential backoff.
 *
 * @param fn - Async function to execute
 * @param config - Retry configuration (partial, merged with defaults)
 * @returns Result of fn()
 * @throws Last error if all retries exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config?: Partial<RetryConfig>,
): Promise<T> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let lastError: unknown;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry on final attempt
      if (attempt >= cfg.maxRetries) break;

      // Only retry retryable errors
      if (!isRetryable(error, cfg)) {
        throw error; // Non-retryable error — fail immediately
      }

      // Calculate delay
      const retryAfterMs = getRetryAfterMs(error);
      const backoffDelay = Math.min(
        cfg.initialDelayMs * Math.pow(cfg.backoffMultiplier, attempt),
        cfg.maxDelayMs,
      );
      const delayMs = retryAfterMs ?? backoffDelay;

      console.warn(
        `[${cfg.label}] Attempt ${attempt + 1}/${cfg.maxRetries + 1} failed: ${(error as Error).message ?? error}. ` +
        `Retrying in ${Math.round(delayMs)}ms...`,
      );

      await sleep(delayMs);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
