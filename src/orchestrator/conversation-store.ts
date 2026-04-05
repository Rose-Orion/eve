/**
 * ConversationStore — persists and prunes conversation history per agent per floor.
 *
 * Rules from spec:
 * - History persists across work cycles (agent remembers what it did)
 * - History is scoped per floor per agent
 * - When history exceeds token limits, prune: keep first msg + last 5 + summarize middle
 * - Context window targets: Opus 30K, Sonnet 20K, Haiku 8K
 * - Pinned messages are never pruned
 */

import type { AgentId, ModelTier } from '../config/types.js';
import type { ConversationMessage } from '../clients/anthropic.js';
import { countTokens } from '../prompt-builder/token-counter.js';

interface ConversationEntry extends ConversationMessage {
  pinned: boolean;
  timestamp: Date;
}

const CONTEXT_TARGETS: Record<ModelTier, number> = {
  opus: 30_000,
  sonnet: 20_000,
  haiku: 8_000,
};

const CONTEXT_MAX: Record<ModelTier, number> = {
  opus: 50_000,
  sonnet: 30_000,
  haiku: 15_000,
};

export class ConversationStore {
  // Key: "{floorId}:{agentId}"
  private histories = new Map<string, ConversationEntry[]>();

  private key(floorId: string, agentId: AgentId): string {
    return `${floorId}:${agentId}`;
  }

  /** Add a message to the conversation history. */
  addMessage(
    floorId: string,
    agentId: AgentId,
    message: ConversationMessage,
    pinned: boolean = false,
  ): void {
    const k = this.key(floorId, agentId);
    if (!this.histories.has(k)) {
      this.histories.set(k, []);
    }
    this.histories.get(k)!.push({
      ...message,
      pinned,
      timestamp: new Date(),
    });
  }

  /** Get conversation messages for API call, pruned to fit within context window. */
  async getMessages(
    floorId: string,
    agentId: AgentId,
    modelTier: ModelTier,
    systemPromptTokens: number,
  ): Promise<ConversationMessage[]> {
    const k = this.key(floorId, agentId);
    const entries = this.histories.get(k);
    if (!entries || entries.length === 0) return [];

    const target = CONTEXT_TARGETS[modelTier];
    const availableTokens = target - systemPromptTokens;

    if (availableTokens <= 0) return [];

    // Calculate total tokens
    let total = 0;
    for (const entry of entries) {
      total += await countTokens(entry.content);
    }

    // If within budget, return all
    if (total <= availableTokens) {
      return entries.map(e => ({ role: e.role, content: e.content }));
    }

    // Prune: keep first message + pinned messages + last 5 + summarize middle
    const first = entries[0]!;
    const last5 = entries.slice(-5);
    const pinned = entries.filter(e => e.pinned && !last5.includes(e) && e !== first);
    const middle = entries.slice(1, -5).filter(e => !e.pinned);

    // Summarize middle section
    const middleSummary = middle.length > 0
      ? `[Summary of ${middle.length} earlier messages: Agent worked on ${new Set(middle.map(m => m.role)).size > 1 ? 'multiple exchanges' : 'tasks'}. Key outputs were delivered.]`
      : '';

    const result: ConversationMessage[] = [
      { role: first.role, content: first.content },
    ];

    for (const p of pinned) {
      result.push({ role: p.role, content: p.content });
    }

    if (middleSummary) {
      result.push({ role: 'user', content: middleSummary });
    }

    for (const entry of last5) {
      result.push({ role: entry.role, content: entry.content });
    }

    return result;
  }

  /** Pin a message so it's never pruned. */
  pinMessage(floorId: string, agentId: AgentId, index: number): void {
    const k = this.key(floorId, agentId);
    const entries = this.histories.get(k);
    if (entries && entries[index]) {
      entries[index].pinned = true;
    }
  }

  /** Get raw history length. */
  getLength(floorId: string, agentId: AgentId): number {
    return this.histories.get(this.key(floorId, agentId))?.length ?? 0;
  }

  /** Clear history for a specific agent on a floor. */
  clear(floorId: string, agentId: AgentId): void {
    this.histories.delete(this.key(floorId, agentId));
  }
}
