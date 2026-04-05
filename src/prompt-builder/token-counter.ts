/**
 * Token counter for PromptBuilder.
 * Uses tiktoken for accurate Claude token estimation.
 * Falls back to heuristic (~4 chars per token) if tiktoken unavailable.
 */

let encoder: { encode: (text: string) => Uint32Array; free: () => void } | null = null;
let initAttempted = false;

async function getEncoder() {
  if (encoder) return encoder;
  if (initAttempted) return null;
  initAttempted = true;
  try {
    const tiktoken = await import('tiktoken');
    encoder = tiktoken.get_encoding('cl100k_base');
    return encoder;
  } catch {
    return null;
  }
}

/** Count tokens in a string. Async on first call (loads encoder), sync thereafter. */
export async function countTokens(text: string): Promise<number> {
  if (!text) return 0;
  const enc = await getEncoder();
  if (enc) {
    return enc.encode(text).length;
  }
  // Heuristic fallback: ~4 characters per token for English
  return Math.ceil(text.length / 4);
}

/** Synchronous estimate — always uses heuristic. Use for quick checks. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/** Truncate text to fit within a token budget. */
export async function truncateToTokens(text: string, maxTokens: number): Promise<string> {
  const current = await countTokens(text);
  if (current <= maxTokens) return text;

  // Binary search for the right cutoff
  const ratio = maxTokens / current;
  let end = Math.floor(text.length * ratio);

  // Find the last complete sentence or line within budget
  const truncated = text.slice(0, end);
  const lastNewline = truncated.lastIndexOf('\n');
  const lastPeriod = truncated.lastIndexOf('. ');

  const cutPoint = Math.max(lastNewline, lastPeriod + 1);
  if (cutPoint > end * 0.5) {
    return text.slice(0, cutPoint + 1).trimEnd();
  }

  return truncated.trimEnd();
}
