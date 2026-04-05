/**
 * Social Analytics — Performance metrics collection, trend monitoring, and boost recommendations.
 * Aggregates engagement data from Meta Insights and TikTok analytics.
 */

import type { EventBus } from './event-bus.js';
import { getSupabase, withRetry, persistWithRetry } from '../integrations/supabase.js';

export interface PostMetrics {
  postId: string;
  platform: string;
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  clicks: number;
  engagement_rate: number;
  measuredAt: string;
}

export interface PerformanceSummary {
  floorId: string;
  period: '1h' | '24h' | '7d' | '30d';
  totalImpressions: number;
  totalEngagement: number;
  avgEngagementRate: number;
  topPosts: PostMetrics[];
  platformBreakdown: Record<string, {
    posts: number;
    impressions: number;
    engagement: number;
  }>;
}

export interface TrendSignal {
  type: 'hashtag' | 'audio' | 'format';
  platform: string;
  value: string;
  relevanceScore: number;
  detectedAt: string;
}

export interface BoostRecommendation {
  shouldBoost: boolean;
  reason: string;
  suggestedBudget: number;
}

export interface SocialAnalyticsConfig {
  eventBus: EventBus;
  engagementThresholdMultiplier?: number;
  maxPostAgeHours?: number;
}

export class SocialAnalytics {
  private eventBus: EventBus;
  private engagementThresholdMultiplier: number;
  private maxPostAgeHours: number;

  constructor(config: SocialAnalyticsConfig) {
    this.eventBus = config.eventBus;
    this.engagementThresholdMultiplier = config.engagementThresholdMultiplier ?? 2.0;
    this.maxPostAgeHours = config.maxPostAgeHours ?? 48;
  }

  /**
   * Collect performance metrics from Meta Insights API and TikTok analytics.
   * Aggregates impressions, reach, engagement, and click data.
   */
  async collectPerformanceMetrics(floorId: string): Promise<PostMetrics[]> {
    const metrics: PostMetrics[] = [];

    // TODO: Fetch floor config to get access tokens and post IDs
    // Meta Insights API: GET /{POST_ID}/insights?fields=impressions,reach,likes,comments,shares,saves
    // TikTok Analytics API: GET /v1/post/list/
    // For now, return empty array — full implementation requires floor config access

    return metrics;
  }

  /**
   * Identify top-performing posts that exceed 2x the average engagement rate.
   * Used to determine which content to amplify.
   */
  detectTopPerformers(floorId: string, metrics: PostMetrics[]): PostMetrics[] {
    if (metrics.length === 0) return [];

    const avgEngagement = metrics.reduce((sum, m) => sum + m.engagement_rate, 0) / metrics.length;
    const threshold = avgEngagement * this.engagementThresholdMultiplier;

    return metrics
      .filter(m => m.engagement_rate >= threshold)
      .sort((a, b) => b.engagement_rate - a.engagement_rate);
  }

  /**
   * Recommend whether a post should be boosted with paid promotion.
   * Criteria:
   * - Engagement rate > 3x average
   * - Post is < 48 hours old
   * - Suggests daily budget based on impressions
   */
  suggestBoost(postId: string, metrics: PostMetrics): BoostRecommendation {
    const now = new Date();
    const measuredTime = new Date(metrics.measuredAt);
    const ageHours = (now.getTime() - measuredTime.getTime()) / (1000 * 60 * 60);

    // Check post age
    if (ageHours > this.maxPostAgeHours) {
      return {
        shouldBoost: false,
        reason: `Post is ${ageHours.toFixed(1)} hours old (exceeds ${this.maxPostAgeHours}h limit)`,
        suggestedBudget: 0,
      };
    }

    // In practice, this would compare to average engagement for the floor
    // For now, use a simple heuristic
    const engagementScore = metrics.likes + metrics.comments + metrics.shares;
    const impressionsPerEngagement = engagementScore > 0 ? metrics.impressions / engagementScore : Infinity;

    // Good engagement means low impressions-per-engagement ratio
    const shouldBoost = impressionsPerEngagement < 50 && engagementScore > 10;

    if (!shouldBoost) {
      return {
        shouldBoost: false,
        reason: `Engagement score ${engagementScore} is below recommendation threshold`,
        suggestedBudget: 0,
      };
    }

    // Suggest daily budget: $0.10 per 1000 impressions
    const suggestedBudgetUsd = (metrics.impressions / 1000) * 0.10;
    const suggestedBudgetCents = Math.round(suggestedBudgetUsd * 100);

    return {
      shouldBoost: true,
      reason: `High engagement (${engagementScore} actions) with good impression efficiency`,
      suggestedBudget: suggestedBudgetCents,
    };
  }

  /**
   * Monitor trending signals on each platform.
   * Placeholder implementation — returns empty array.
   * TODO: Integrate with Meta Trend API and TikTok Discovery API.
   */
  async monitorTrends(floorId: string): Promise<TrendSignal[]> {
    // Placeholder: Return empty array
    // Full implementation would call:
    // - Meta Trend API (requires Business API access)
    // - TikTok Discovery API
    // - Parse trending hashtags, sounds, and formats
    return [];
  }

  /**
   * Generate a weekly performance summary.
   * Aggregates 7-day metrics, computes averages, identifies top 5 posts.
   */
  async generateWeeklyReport(floorId: string): Promise<PerformanceSummary> {
    const metrics = await this.collectPerformanceMetrics(floorId);

    if (metrics.length === 0) {
      return {
        floorId,
        period: '7d',
        totalImpressions: 0,
        totalEngagement: 0,
        avgEngagementRate: 0,
        topPosts: [],
        platformBreakdown: {},
      };
    }

    // Compute totals
    const totalImpressions = metrics.reduce((sum, m) => sum + m.impressions, 0);
    const totalEngagement = metrics.reduce((sum, m) => {
      return sum + (m.likes + m.comments + m.shares + m.saves);
    }, 0);
    const avgEngagementRate = metrics.reduce((sum, m) => sum + m.engagement_rate, 0) / metrics.length;

    // Top 5 posts by engagement rate
    const topPosts = [...metrics]
      .sort((a, b) => b.engagement_rate - a.engagement_rate)
      .slice(0, 5);

    // Platform breakdown
    const platformBreakdown: Record<string, { posts: number; impressions: number; engagement: number }> = {};
    for (const metric of metrics) {
      const platform = platformBreakdown[metric.platform];
      if (!platform) {
        platformBreakdown[metric.platform] = { posts: 0, impressions: 0, engagement: 0 };
      }
      const pb = platformBreakdown[metric.platform];
      if (pb) {
        pb.posts += 1;
        pb.impressions += metric.impressions;
        pb.engagement += metric.likes + metric.comments + metric.shares + metric.saves;
      }
    }

    return {
      floorId,
      period: '7d',
      totalImpressions,
      totalEngagement,
      avgEngagementRate,
      topPosts,
      platformBreakdown,
    };
  }

  /**
   * Persist metrics to content_performance table via Supabase.
   * Uses withRetry for transient failure handling.
   */
  async storeMetrics(metrics: PostMetrics[], floorId: string): Promise<void> {
    const sb = getSupabase();
    if (!sb) {
      console.warn('[SocialAnalytics] Supabase not available — metrics not persisted');
      return;
    }

    const rows = metrics.map(m => ({
      floor_id: floorId,
      post_id: m.postId,
      platform: m.platform,
      impressions: m.impressions,
      reach: m.reach,
      likes: m.likes,
      comments: m.comments,
      shares: m.shares,
      saves: m.saves,
      clicks: m.clicks,
      engagement_rate: m.engagement_rate,
      measured_at: m.measuredAt,
    }));

    await withRetry(
      async () => {
        const { error } = await sb.from('content_performance').insert(rows);
        if (error) {
          throw new Error(error.message);
        }
        return true;
      },
      `storeMetrics for floor ${floorId}`,
      3,
    );
  }

  /**
   * Emit a boost recommendation event if a post qualifies.
   * Called after collecting metrics and analyzing performance.
   */
  emitBoostRecommendation(postMetrics: PostMetrics, floorId: string): void {
    const recommendation = this.suggestBoost(postMetrics.postId, postMetrics);
    if (recommendation.shouldBoost) {
      this.eventBus.emit('social:boost-suggested', {
        postId: postMetrics.postId,
        floorId,
        reason: recommendation.reason,
        suggestedBudgetCents: recommendation.suggestedBudget,
      });
    }
  }
}

