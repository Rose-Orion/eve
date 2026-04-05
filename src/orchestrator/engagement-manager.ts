/**
 * Engagement Manager — Comment monitoring, triage, and automated responses.
 * Polls social platforms for new comments, classifies them, and generates contextual responses.
 */

import type { EventBus } from './event-bus.js';
import * as meta from '../integrations/meta.js';
import * as tiktok from '../integrations/tiktok.js';
import { getSupabase, withRetry } from '../integrations/supabase.js';

export interface Comment {
  id: string;
  postId: string;
  platform: 'instagram' | 'tiktok' | 'facebook';
  author: string;
  text: string;
  createdAt: string;
  floorId: string;
}

export type CommentType = 'purchase-intent' | 'complaint' | 'question' | 'compliment' | 'spam';

export interface TriageResult {
  type: CommentType;
  confidence: number;
  suggestedResponse?: string;
}

export interface EngagementManagerConfig {
  eventBus: EventBus;
  minDelayBetweenRepliesMsec?: number;
  maxCommentAgeHours?: number;
}

/**
 * Keyword patterns for comment triage.
 */
const TRIAGE_PATTERNS = {
  'purchase-intent': {
    keywords: ['price', 'how much', 'buy', 'order', 'shipping', 'link', 'where can i', 'cost', 'available', 'stock'],
    minConfidence: 0.6,
  },
  'complaint': {
    keywords: ['broken', 'terrible', 'worst', 'refund', 'scam', 'disappointed', 'poor quality', 'defective', 'bad', 'trash', 'waste'],
    minConfidence: 0.7,
  },
  'question': {
    keywords: ['?', 'how', 'what', 'when', 'where', 'why', 'can', 'does', 'is', 'will'],
    minConfidence: 0.5,
  },
  'compliment': {
    keywords: ['love', 'amazing', 'awesome', 'great', 'best', 'beautiful', 'perfect', 'excellent', 'fantastic', 'incredible'],
    minConfidence: 0.6,
  },
  'spam': {
    keywords: ['http', 'www', 'click here', 'follow me', '!!!', 'aaaaaa', 'zzzzz'],
    minConfidence: 0.5,
  },
};

export class EngagementManager {
  private eventBus: EventBus;
  private minDelayBetweenRepliesMsec: number;
  private maxCommentAgeHours: number;
  private lastReplyTimeByAuthor = new Map<string, number>();

  constructor(config: EngagementManagerConfig) {
    this.eventBus = config.eventBus;
    this.minDelayBetweenRepliesMsec = config.minDelayBetweenRepliesMsec ?? 120_000; // 2 minutes default
    this.maxCommentAgeHours = config.maxCommentAgeHours ?? 48; // 48 hours default
  }

  /**
   * Poll Meta Graph API and TikTok API for new comments on posts.
   * Returns array of Comment objects with metadata.
   */
  async pollComments(floorId: string): Promise<Comment[]> {
    const comments: Comment[] = [];

    // TODO: Fetch floor config to get access tokens and post IDs
    // For now, return empty array — full implementation requires floor config access
    return comments;
  }

  /**
   * Classify a comment into one of five types: purchase-intent, complaint, question, compliment, spam.
   * Uses keyword matching with confidence scoring.
   */
  triageComment(comment: Comment): TriageResult {
    const lowerText = comment.text.toLowerCase();

    // Score each category
    const scores: Record<CommentType, number> = {
      'purchase-intent': 0,
      'complaint': 0,
      'question': 0,
      'compliment': 0,
      'spam': 0,
    };

    // Spam detection: check for URLs and excessive characters
    if (/https?:\/\/|www\.|click here|follow me/i.test(comment.text)) {
      return { type: 'spam', confidence: 0.95 };
    }
    if (/(.)\1{3,}/.test(comment.text)) {
      scores.spam += 0.3; // Repeated characters like "aaaaa"
    }

    // Keyword matching for each category
    for (const [category, pattern] of Object.entries(TRIAGE_PATTERNS)) {
      const categoryType = category as CommentType;
      if (categoryType === 'spam') continue; // Already handled

      let matches = 0;
      for (const keyword of pattern.keywords) {
        if (lowerText.includes(keyword)) {
          matches++;
        }
      }
      scores[categoryType] = matches / pattern.keywords.length;
    }

    // Check if ends with question mark
    if (comment.text.trim().endsWith('?')) {
      scores.question += 0.2;
    }

    // Find top category
    let topType: CommentType = 'compliment';
    let topScore = 0;

    for (const [type, score] of Object.entries(scores)) {
      if (score > topScore) {
        topScore = score;
        topType = type as CommentType;
      }
    }

    // Ensure minimum confidence
    const minConfidence = TRIAGE_PATTERNS[topType].minConfidence;
    if (topScore < minConfidence) {
      topType = 'question'; // Default to question if no clear match
      topScore = 0.5;
    }

    return {
      type: topType,
      confidence: Math.min(topScore, 1.0),
    };
  }

  /**
   * Generate contextual response based on comment type and content.
   * Returns response text or null for spam comments.
   */
  async generateResponse(
    comment: Comment,
    triageResult: TriageResult,
    floorId: string,
  ): Promise<string | null> {
    // Never respond to spam
    if (triageResult.type === 'spam') {
      return null;
    }

    const responses: Record<Exclude<CommentType, 'spam'>, string> = {
      'purchase-intent': `Thanks for your interest! We'd love to help. Check out our products and feel free to DM us with any questions about pricing or shipping.`,
      'complaint': `We're sorry to hear you had a negative experience. We take your feedback seriously and would love to make things right. Please DM us so we can help.`,
      'question': `Great question! We're here to help. Feel free to DM us or check out our FAQs for more info.`,
      'compliment': `Thank you so much! We really appreciate the love.`,
    };

    return responses[triageResult.type] ?? null;
  }

  /**
   * Reply to a comment via Meta Graph API (Instagram/Facebook) or TikTok API.
   * Requires platform-specific access tokens from floor configuration.
   */
  async replyToComment(comment: Comment, response: string): Promise<void> {
    try {
      // TODO: Fetch floor config for access tokens
      // Meta Graph API: POST /{COMMENT_ID}/private_replies
      // TikTok API: POST /v1/comment/reply/
      // For now, log only
      console.log(`[EngagementManager] Would reply to ${comment.id} on ${comment.platform}: ${response}`);
    } catch (err) {
      console.error(`[EngagementManager] Failed to reply to comment ${comment.id}:`, (err as Error).message);
      throw err;
    }
  }

  /**
   * Run a complete engagement cycle: poll → triage → generate → reply.
   * Respects rate limits (2-minute minimum delay between replies to same author).
   * Skips comments older than maxCommentAgeHours.
   */
  async runEngagementCycle(floorId: string): Promise<void> {
    try {
      const comments = await this.pollComments(floorId);
      const now = Date.now();
      const maxAgeMs = this.maxCommentAgeHours * 60 * 60 * 1000;

      for (const comment of comments) {
        // Skip old comments
        const commentAgeMs = now - new Date(comment.createdAt).getTime();
        if (commentAgeMs > maxAgeMs) {
          continue;
        }

        // Emit received event
        this.eventBus.emit('engagement:comment-received', {
          commentId: comment.id,
          floorId,
          author: comment.author,
          text: comment.text,
        });

        // Triage the comment
        const triageResult = this.triageComment(comment);

        // Skip if we recently replied to this author
        const lastReplyTime = this.lastReplyTimeByAuthor.get(comment.author) ?? 0;
        if (now - lastReplyTime < this.minDelayBetweenRepliesMsec) {
          continue;
        }

        // Generate and send response
        const response = await this.generateResponse(comment, triageResult, floorId);
        if (response) {
          await this.replyToComment(comment, response);
          this.lastReplyTimeByAuthor.set(comment.author, now);

          this.eventBus.emit('engagement:response-sent', {
            commentId: comment.id,
            floorId,
            author: comment.author,
            response,
          });
        }

        // Emit escalation event for complaints
        if (triageResult.type === 'complaint') {
          this.eventBus.emit('engagement:escalated', {
            commentId: comment.id,
            floorId,
            reason: `Complaint detected: "${comment.text.substring(0, 100)}"`,
          });
        }
      }
    } catch (err) {
      console.error(`[EngagementManager] runEngagementCycle failed for floor ${floorId}:`, (err as Error).message);
      throw err;
    }
  }
}

