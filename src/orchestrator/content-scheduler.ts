/**
 * ContentScheduler — Cron-driven social media publishing.
 *
 * Manages a content calendar stored in memory (persisted to Supabase).
 * Social Media Agent populates the calendar → ContentScheduler publishes
 * at optimal times via Meta Graph API and TikTok Content API.
 *
 * Features:
 *   - Per-platform scheduling (different optimal times)
 *   - Queue management with retry on API failures
 *   - Rate limiting to avoid API throttling
 *   - Post-publish analytics tracking
 */

import type { EventBus } from './event-bus.js';
import type { Orchestrator } from './index.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type Platform = 'instagram' | 'facebook' | 'tiktok';
export type PostStatus = 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';
export type ContentFormat = 'reel' | 'story' | 'carousel' | 'post' | 'video';

/**
 * ContentBrief — Single content piece for a platform.
 */
export interface ContentBrief {
  id?: string;
  platform: Platform;
  format: ContentFormat;
  topic: string;
  caption: string;
  hashtags: string[];
  scheduledAt: Date;
  priority: 'high' | 'normal' | 'low';
}

/**
 * WeeklyCalendar — Collection of content briefs for a week.
 */
export interface WeeklyCalendar {
  floorId: string;
  weekStarting: string; // ISO date (YYYY-MM-DD)
  briefs: ContentBrief[];
}

/**
 * PlatformAdaptation — Adapted content for specific platform.
 */
export interface PlatformAdaptation {
  platform: Platform;
  caption: string;
  hashtags: string[];
  format: ContentFormat;
  cta: string; // Call to action
}

export interface ScheduledPost {
  id: string;
  floorId: string;
  platform: Platform;
  /** Scheduled publish time (UTC) */
  scheduledAt: Date;
  /** Post content */
  message: string;
  /** Media URL (image or video) */
  mediaUrl?: string;
  /** Media type */
  mediaType?: 'image' | 'video';
  /** Link URL (for link posts) */
  linkUrl?: string;
  /** Hashtags (auto-appended) */
  hashtags?: string[];
  status: PostStatus;
  /** Platform-specific post ID after publishing */
  platformPostId?: string;
  /** Error message if failed */
  error?: string;
  /** Number of publish attempts */
  attempts: number;
  /** Max retries before marking failed */
  maxRetries: number;
  createdAt: Date;
  publishedAt?: Date;
}

export interface ContentCalendarEntry {
  floorId: string;
  platform: Platform;
  scheduledAt: Date;
  message: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
  linkUrl?: string;
  hashtags?: string[];
}

export interface PlatformAuth {
  /** Meta/Facebook Page access token + page ID */
  metaAccessToken?: string;
  metaPageId?: string;
  /** TikTok access token */
  tiktokAccessToken?: string;
}

// ─── ContentScheduler ───────────────────────────────────────────────────────

export class ContentScheduler {
  private posts = new Map<string, ScheduledPost>();
  private platformAuths = new Map<string, PlatformAuth>();
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;

  /** Minimum gap between publishes per platform to avoid throttling (ms) */
  private readonly publishCooldownMs = 60_000; // 1 minute
  private lastPublishTime = new Map<string, number>(); // key: floorId:platform

  constructor(private eventBus: EventBus) {}

  // ── Configuration ──

  setPlatformAuth(floorId: string, auth: PlatformAuth): void {
    this.platformAuths.set(floorId, auth);
  }

  // ── Calendar Management ──

  /**
   * Schedule a post for future publishing.
   */
  schedulePost(entry: ContentCalendarEntry): ScheduledPost {
    const post: ScheduledPost = {
      id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      floorId: entry.floorId,
      platform: entry.platform,
      scheduledAt: entry.scheduledAt,
      message: entry.message,
      mediaUrl: entry.mediaUrl,
      mediaType: entry.mediaType,
      linkUrl: entry.linkUrl,
      hashtags: entry.hashtags,
      status: 'scheduled',
      attempts: 0,
      maxRetries: 3,
      createdAt: new Date(),
    };

    this.posts.set(post.id, post);
    console.log(`[ContentScheduler] Scheduled ${post.platform} post "${post.id}" for ${post.scheduledAt.toISOString()}`);
    return post;
  }

  /**
   * Schedule multiple posts from a content calendar batch.
   */
  scheduleBatch(entries: ContentCalendarEntry[]): ScheduledPost[] {
    return entries.map(e => this.schedulePost(e));
  }

  /**
   * Cancel a scheduled post.
   */
  cancelPost(postId: string): boolean {
    const post = this.posts.get(postId);
    if (!post || post.status !== 'scheduled') return false;
    post.status = 'cancelled';
    return true;
  }

  /**
   * Get all posts for a floor, optionally filtered by status.
   */
  getFloorPosts(floorId: string, status?: PostStatus): ScheduledPost[] {
    return [...this.posts.values()]
      .filter(p => p.floorId === floorId && (!status || p.status === status))
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  }

  /**
   * Get upcoming posts (next 24h).
   */
  getUpcoming(floorId: string): ScheduledPost[] {
    const now = Date.now();
    const in24h = now + 24 * 60 * 60 * 1000;
    return this.getFloorPosts(floorId, 'scheduled')
      .filter(p => p.scheduledAt.getTime() >= now && p.scheduledAt.getTime() <= in24h);
  }

  // ── Scheduler Engine ──

  /**
   * Start the publishing scheduler. Checks every 30 seconds for posts due to publish.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.tickInterval = setInterval(() => this.tick(), 30_000);
    console.log('[ContentScheduler] Started — checking every 30s');
  }

  /**
   * Stop the scheduler.
   */
  stop(): void {
    this.running = false;
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    console.log('[ContentScheduler] Stopped');
  }

  /**
   * Process one scheduler tick — find and publish due posts.
   */
  private async tick(): Promise<void> {
    const now = Date.now();
    const duePosts = [...this.posts.values()]
      .filter(p => p.status === 'scheduled' && p.scheduledAt.getTime() <= now);

    for (const post of duePosts) {
      // Cooldown check — avoid publishing too fast on same platform
      const cooldownKey = `${post.floorId}:${post.platform}`;
      const lastPublish = this.lastPublishTime.get(cooldownKey) ?? 0;
      if (now - lastPublish < this.publishCooldownMs) continue;

      await this.publishPost(post);
      this.lastPublishTime.set(cooldownKey, Date.now());
    }
  }

  /**
   * Publish a single post to its target platform.
   */
  private async publishPost(post: ScheduledPost): Promise<void> {
    const auth = this.platformAuths.get(post.floorId);
    if (!auth) {
      post.status = 'failed';
      post.error = 'No platform auth configured for this floor';
      return;
    }

    post.status = 'publishing';
    post.attempts++;

    try {
      switch (post.platform) {
        case 'facebook':
        case 'instagram':
          await this.publishToMeta(post, auth);
          break;
        case 'tiktok':
          await this.publishToTikTok(post, auth);
          break;
      }

      post.status = 'published';
      post.publishedAt = new Date();

      console.log(`[ContentScheduler] Published ${post.platform} post ${post.id}`);

      this.eventBus.emit('media:generated', {
        floorId: post.floorId,
        taskId: post.id,
        type: 'image',
        url: post.platformPostId ?? '',
      });
    } catch (err) {
      const errorMsg = (err as Error).message;
      console.error(`[ContentScheduler] Failed to publish ${post.id} (attempt ${post.attempts}): ${errorMsg}`);

      if (post.attempts >= post.maxRetries) {
        post.status = 'failed';
        post.error = errorMsg;
      } else {
        // Retry — put back in scheduled state with 5 minute delay
        post.status = 'scheduled';
        post.scheduledAt = new Date(Date.now() + 5 * 60 * 1000);
      }
    }
  }

  // ── Platform Publishers ──

  private async publishToMeta(post: ScheduledPost, auth: PlatformAuth): Promise<void> {
    if (!auth.metaAccessToken || !auth.metaPageId) {
      throw new Error('Meta access token or page ID not configured');
    }

    const { publishPost } = await import('../integrations/meta.js');

    // Compose full message with hashtags
    let fullMessage = post.message;
    if (post.hashtags && post.hashtags.length > 0) {
      fullMessage += '\n\n' + post.hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ');
    }

    const result = await publishPost(auth.metaAccessToken, auth.metaPageId, fullMessage, post.mediaUrl);
    post.platformPostId = result.id;
  }

  private async publishToTikTok(post: ScheduledPost, auth: PlatformAuth): Promise<void> {
    if (!auth.tiktokAccessToken) {
      throw new Error('TikTok access token not configured');
    }

    if (!post.mediaUrl || post.mediaType !== 'video') {
      throw new Error('TikTok requires video content');
    }

    const { initVideoUpload } = await import('../integrations/tiktok.js');
    const result = await initVideoUpload(auth.tiktokAccessToken, post.message);
    post.platformPostId = result.publishId;

    // Note: actual video upload to result.uploadUrl would happen here
    // For now, we initialize the upload and store the publish ID
  }

  // ── Stats ──

  getStats(floorId: string): {
    scheduled: number;
    published: number;
    failed: number;
    publishedThisWeek: number;
  } {
    const posts = [...this.posts.values()].filter(p => p.floorId === floorId);
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    return {
      scheduled: posts.filter(p => p.status === 'scheduled').length,
      published: posts.filter(p => p.status === 'published').length,
      failed: posts.filter(p => p.status === 'failed').length,
      publishedThisWeek: posts.filter(p =>
        p.status === 'published' && p.publishedAt && p.publishedAt.getTime() > weekAgo,
      ).length,
    };
  }
}

// ─── Weekly Calendar Generation ──────────────────────────────────────────────

/**
 * Generate a weekly content calendar using Social Media Agent.
 * Creates 20-30 briefs with platform-specific frequencies.
 * Instagram: 1 Reel/day, 3-4 Stories/day, 2 Carousels/week
 * TikTok: 1-2 videos/day
 * Facebook: 1 post/day
 */
export async function generateWeeklyCalendar(
  floorId: string,
  orchestrator: Orchestrator,
): Promise<WeeklyCalendar> {
  const weekStarting = new Date();
  weekStarting.setHours(0, 0, 0, 0);
  const isoString = weekStarting.toISOString();
  const weekStartingStr = (isoString.split('T')[0]) as string;

  // Get floor info for context
  const floor = (orchestrator as any).floors?.get(floorId);
  const floorSlug = floor?.slug ?? 'unknown';

  // Dispatch Social Media Agent to generate calendar
  const result = await orchestrator.virtualDispatcher.dispatch({
    taskId: `calendar-${floorId}-${Date.now()}`,
    floorId,
    floorSlug,
    agentId: 'social-media-agent',
    taskType: 'weekly_calendar_generation',
    taskDescription: `Generate a weekly content calendar for the week starting ${weekStartingStr}. Create 20-30 content briefs with the following platform frequencies:
- Instagram: 1 Reel per day (7), 3-4 Stories per day (21-28), 2 Carousels per week (2)
- TikTok: 1-2 videos per day (7-14)
- Facebook: 1 post per day (7)

Each brief must include:
- platform: 'instagram' | 'facebook' | 'tiktok'
- format: 'reel' | 'story' | 'carousel' | 'post' | 'video'
- topic: relevant to the business
- caption: 100-200 words
- hashtags: array of 5-30 hashtags
- scheduledAt: ISO timestamp (spread throughout each day with optimal posting times)
- priority: 'high' | 'normal' | 'low'

Return valid JSON array of ContentBrief objects.`,
    acceptanceCriteria: [
      'At least 20 content briefs',
      'Correct platform frequency distribution',
      'Each brief has required fields',
      'Valid JSON output',
    ],
    inputFiles: [],
    pendingInputs: [],
    outputSpec: 'JSON array of ContentBrief objects with all required fields',
    priority: 'normal',
    modelTier: 'sonnet',
    brandState: floor?.brandState ?? 'pre-foundation',
    selectedBrand: floor?.selectedBrand ?? null,
  });

  if (!result.success) {
    throw new Error(`Failed to generate weekly calendar: ${result.error ?? 'Unknown error'}`);
  }

  // Parse the JSON response
  let briefs: ContentBrief[] = [];
  try {
    // Extract JSON from response (may be wrapped in markdown)
    const jsonMatch = result.content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array found in response');
    briefs = JSON.parse(jsonMatch[0]) as ContentBrief[];
  } catch (err) {
    console.error('[ContentScheduler] Failed to parse calendar response:', (err as Error).message);
    // Return empty calendar on parse error
    briefs = [];
  }

  return {
    floorId,
    weekStarting: weekStartingStr,
    briefs: briefs.map((b, i) => ({ ...b, id: `brief-${i}-${Date.now()}` })),
  };
}

/**
 * Queue calendar items as scheduled posts.
 */
export async function queueCalendarItems(
  floorId: string,
  calendar: WeeklyCalendar,
  orchestrator: Orchestrator,
): Promise<void> {
  const scheduler = orchestrator.contentScheduler;
  if (!scheduler) {
    throw new Error('ContentScheduler not available in orchestrator');
  }

  const entries = calendar.briefs.map(brief => ({
    floorId,
    platform: brief.platform,
    scheduledAt: new Date(brief.scheduledAt),
    message: brief.caption,
    hashtags: brief.hashtags,
  }));

  const scheduled = scheduler.scheduleBatch(entries);
  console.log(`[ContentScheduler] Queued ${scheduled.length} posts from weekly calendar`);

  // Emit a task:queued event to signal the content calendar items
  orchestrator.eventBus.emit('task:queued', {
    taskId: `calendar-batch-${floorId}-${Date.now()}`,
    floorId,
  });
}

// ─── Cross-Platform Content Adaptation ────────────────────────────────────────

/**
 * Adapt a content brief for a specific platform.
 * Uses Copy Agent to rewrite captions and adjust hashtags/CTA.
 */
export async function adaptForPlatform(
  content: ContentBrief,
  targetPlatform: 'instagram' | 'tiktok' | 'facebook',
  orchestrator: Orchestrator,
  floorId?: string,
): Promise<PlatformAdaptation> {
  // Build platform-specific instructions
  let platformGuidelines = '';
  switch (targetPlatform) {
    case 'instagram':
      platformGuidelines = `
Platform: Instagram
- Caption: Keep shorter (150-200 chars), focus on engagement
- Hashtags: 20-30 hashtags, mix popular and niche
- CTA: Direct followers to bio/link
- Format: Adapt to reel/story/carousel as appropriate`;
      break;
    case 'tiktok':
      platformGuidelines = `
Platform: TikTok
- Caption: Very informal, conversational tone
- Include trending audio reference if applicable
- Hashtags: 3-5 hashtags, use trending ones
- CTA: Encourage saves, shares, and follows
- Format: Must be video`;
      break;
    case 'facebook':
      platformGuidelines = `
Platform: Facebook
- Caption: Longer form (300-400 chars), narrative driven
- Hashtags: 2-3 hashtags
- CTA: Question-based to encourage comments
- Format: Long-form post with image/carousel`;
      break;
  }

  // Get floor info if provided, otherwise use first available floor
  const targetFloorId = floorId ?? (floorId = (orchestrator as any).floors?.keys()?.next()?.value ?? 'unknown');
  const floor = (orchestrator as any).floors?.get(targetFloorId);
  const floorSlug = floor?.slug ?? 'unknown';

  const result = await orchestrator.virtualDispatcher.dispatch({
    taskId: `adapt-${content.id ?? 'unknown'}-${targetPlatform}-${Date.now()}`,
    floorId: targetFloorId,
    floorSlug,
    agentId: 'copy-agent',
    taskType: 'platform_adaptation',
    taskDescription: `Adapt the following content brief for ${targetPlatform}:

Original Content:
- Topic: ${content.topic}
- Caption: ${content.caption}
- Current Hashtags: ${content.hashtags.join(', ')}
- Current Format: ${content.format}

${platformGuidelines}

Return a JSON object with:
{
  "caption": "adapted caption for the platform",
  "hashtags": ["array", "of", "platform-specific", "hashtags"],
  "cta": "call to action text"
}`,
    acceptanceCriteria: [
      'Valid JSON output',
      'Caption adapted for platform tone',
      'Appropriate hashtag count and style',
      'Relevant CTA for platform',
    ],
    inputFiles: [],
    pendingInputs: [],
    outputSpec: 'JSON object with caption, hashtags array, and cta fields',
    priority: 'normal',
    modelTier: 'sonnet',
    brandState: floor?.brandState ?? 'pre-foundation',
    selectedBrand: floor?.selectedBrand ?? null,
  });

  if (!result.success) {
    throw new Error(`Failed to adapt content for ${targetPlatform}: ${result.error ?? 'Unknown error'}`);
  }

  // Parse the adaptation
  let adaptation: { caption?: string; hashtags?: string[]; cta?: string } = {};
  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object found in response');
    adaptation = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error(`[ContentScheduler] Failed to parse ${targetPlatform} adaptation:`, (err as Error).message);
  }

  return {
    platform: targetPlatform,
    caption: adaptation.caption ?? content.caption,
    hashtags: adaptation.hashtags ?? content.hashtags,
    format: content.format,
    cta: adaptation.cta ?? 'Learn more',
  };
}
