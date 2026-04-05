/**
 * AdsPipeline — Full Meta Ads execution: campaigns → ad sets → creatives.
 *
 * Bridges the Ads Agent's campaign plans to real Meta Marketing API calls.
 * Includes:
 *   - Campaign creation with budget enforcement
 *   - Ad set creation with audience targeting
 *   - Ad creative upload and association
 *   - Daily budget caps and ROAS-based circuit breakers
 *   - Pause/scale/kill automation based on performance thresholds
 *
 * All ad spend actions are HIGH-RISK and require Gate 3 (Ad Activation) approval.
 * Once approved, the pipeline runs autonomously within daily budget limits.
 */

import type { EventBus } from './event-bus.js';
import type { BudgetEnforcer } from '../security/budget-enforcer.js';

const GRAPH_API = 'https://graph.facebook.com/v21.0';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AdAccountConfig {
  floorId: string;
  accessToken: string;
  adAccountId: string;
  pageId: string;
  /** Max daily ad spend in cents across all campaigns */
  dailyBudgetCapCents: number;
  /** Target ROAS (e.g., 2.0 = $2 revenue per $1 spent) */
  targetRoas: number;
  /** CPA ceiling in cents — pause ads exceeding this */
  maxCpaCents: number;
  /** Minimum days before making optimization decisions */
  learningPeriodDays: number;
}

export interface CampaignPlan {
  name: string;
  objective: 'CONVERSIONS' | 'TRAFFIC' | 'AWARENESS' | 'ENGAGEMENT' | 'LEADS';
  dailyBudgetCents: number;
  adSets: AdSetPlan[];
}

export interface AdSetPlan {
  name: string;
  targeting: AudienceTargeting;
  placements?: string[];
  ads: AdCreativePlan[];
}

export interface AudienceTargeting {
  ageMin?: number;
  ageMax?: number;
  genders?: number[];  // 1=male, 2=female
  interests?: Array<{ id: string; name: string }>;
  locations?: Array<{ key: string; name: string }>;
  customAudiences?: string[];
  lookalikeSources?: string[];
}

export interface AdCreativePlan {
  name: string;
  headline: string;
  body: string;
  callToAction: string;
  imageUrl?: string;
  videoUrl?: string;
  linkUrl: string;
}

export interface CampaignResult {
  campaignId: string;
  adSetIds: string[];
  adIds: string[];
  status: 'created' | 'failed';
  errors: string[];
}

export interface CampaignPerformance {
  campaignId: string;
  campaignName: string;
  impressions: number;
  clicks: number;
  spend: number;  // cents
  conversions: number;
  revenue: number;  // cents
  roas: number;
  cpa: number;  // cents
  ctr: number;  // percentage
  status: 'learning' | 'winning' | 'losing' | 'paused';
  recommendation: 'scale' | 'maintain' | 'reduce' | 'pause' | 'kill';
}

// ─── AdsPipeline ────────────────────────────────────────────────────────────

export class AdsPipeline {
  private accountConfigs = new Map<string, AdAccountConfig>();

  constructor(
    private eventBus: EventBus,
    private budgetEnforcer: BudgetEnforcer,
  ) {}

  // ── Configuration ──

  setAccountConfig(floorId: string, config: AdAccountConfig): void {
    this.accountConfigs.set(floorId, config);
  }

  getAccountConfig(floorId: string): AdAccountConfig | undefined {
    return this.accountConfigs.get(floorId);
  }

  // ── Campaign Execution ──

  /**
   * Execute a full campaign plan: campaign → ad sets → ads.
   * All created in PAUSED state — requires explicit activation.
   */
  async executeCampaignPlan(floorId: string, plan: CampaignPlan): Promise<CampaignResult> {
    const config = this.accountConfigs.get(floorId);
    if (!config) {
      return { campaignId: '', adSetIds: [], adIds: [], status: 'failed', errors: ['No ad account configured for this floor'] };
    }

    const errors: string[] = [];
    const adSetIds: string[] = [];
    const adIds: string[] = [];

    // Budget check
    const budgetCheck = this.budgetEnforcer.canAfford(floorId, plan.dailyBudgetCents);
    if (!budgetCheck.allowed) {
      return { campaignId: '', adSetIds: [], adIds: [], status: 'failed', errors: [`Budget check failed: ${budgetCheck.reason}`] };
    }

    // Daily cap enforcement
    if (plan.dailyBudgetCents > config.dailyBudgetCapCents) {
      return { campaignId: '', adSetIds: [], adIds: [], status: 'failed', errors: [`Campaign daily budget (${plan.dailyBudgetCents}¢) exceeds floor cap (${config.dailyBudgetCapCents}¢)`] };
    }

    try {
      // 1. Create campaign (PAUSED)
      const campaignId = await this.createCampaign(config, plan);
      console.log(`[AdsPipeline] Created campaign "${plan.name}" (${campaignId}) for floor ${floorId}`);

      // 2. Create ad sets
      for (const adSetPlan of plan.adSets) {
        try {
          const adSetId = await this.createAdSet(config, campaignId, plan.dailyBudgetCents, adSetPlan);
          adSetIds.push(adSetId);

          // 3. Create ads within each ad set
          for (const adPlan of adSetPlan.ads) {
            try {
              const adId = await this.createAd(config, adSetId, adPlan);
              adIds.push(adId);
            } catch (err) {
              errors.push(`Ad "${adPlan.name}" failed: ${(err as Error).message}`);
            }
          }
        } catch (err) {
          errors.push(`AdSet "${adSetPlan.name}" failed: ${(err as Error).message}`);
        }
      }

      this.eventBus.emit('approval:needed', {
        floorId,
        taskId: `ads-activation-${campaignId}`,
        type: 'gate:ad-activation',
        summary: `Campaign "${plan.name}" created with ${adSetIds.length} ad sets and ${adIds.length} ads. Daily budget: $${(plan.dailyBudgetCents / 100).toFixed(2)}. Activate?`,
      });

      return { campaignId, adSetIds, adIds, status: 'created', errors };
    } catch (err) {
      return { campaignId: '', adSetIds, adIds, status: 'failed', errors: [...errors, (err as Error).message] };
    }
  }

  /**
   * Activate a paused campaign (after Gate 3 approval).
   */
  async activateCampaign(floorId: string, campaignId: string): Promise<boolean> {
    const config = this.accountConfigs.get(floorId);
    if (!config) return false;

    try {
      const res = await fetch(`${GRAPH_API}/${campaignId}`, {
        method: 'POST',
        body: new URLSearchParams({
          status: 'ACTIVE',
          access_token: config.accessToken,
        }),
      });

      if (!res.ok) {
        const err = await res.text().catch(() => 'unknown');
        console.error(`[AdsPipeline] Failed to activate campaign ${campaignId}: ${err}`);
        return false;
      }

      console.log(`[AdsPipeline] Campaign ${campaignId} activated for floor ${floorId}`);
      return true;
    } catch (err) {
      console.error(`[AdsPipeline] Activation error: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Pause a campaign (budget exceeded, poor performance, or manual override).
   */
  async pauseCampaign(floorId: string, campaignId: string, reason: string): Promise<boolean> {
    const config = this.accountConfigs.get(floorId);
    if (!config) return false;

    try {
      const res = await fetch(`${GRAPH_API}/${campaignId}`, {
        method: 'POST',
        body: new URLSearchParams({
          status: 'PAUSED',
          access_token: config.accessToken,
        }),
      });

      if (!res.ok) return false;

      console.log(`[AdsPipeline] Campaign ${campaignId} paused: ${reason}`);
      return true;
    } catch {
      return false;
    }
  }

  // ── Performance Analysis ──

  /**
   * Get campaign performance metrics and generate recommendations.
   */
  async analyzeCampaignPerformance(floorId: string): Promise<CampaignPerformance[]> {
    const config = this.accountConfigs.get(floorId);
    if (!config) return [];

    try {
      const { getAdInsights } = await import('../integrations/meta.js');

      const today = new Date();
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const dateRange = {
        since: weekAgo.toISOString().split('T')[0] ?? '',
        until: today.toISOString().split('T')[0] ?? '',
      };

      const insights = await getAdInsights(config.accessToken, config.adAccountId, dateRange);

      return insights.map(insight => {
        const impressions = Number(insight['impressions'] ?? 0);
        const clicks = Number(insight['clicks'] ?? 0);
        const spendCents = Math.round(Number(insight['spend'] ?? 0) * 100);
        const conversions = this.extractConversions(insight);
        const revenue = this.extractRevenue(insight);
        const roas = spendCents > 0 ? revenue / spendCents : 0;
        const cpa = conversions > 0 ? spendCents / conversions : Infinity;
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;

        // Determine status and recommendation
        const daysRunning = 7; // Simplified — would track actual start date
        const inLearning = daysRunning < config.learningPeriodDays;

        let status: CampaignPerformance['status'];
        let recommendation: CampaignPerformance['recommendation'];

        if (inLearning) {
          status = 'learning';
          recommendation = 'maintain';
        } else if (roas >= config.targetRoas) {
          status = 'winning';
          recommendation = roas >= config.targetRoas * 1.5 ? 'scale' : 'maintain';
        } else if (cpa > config.maxCpaCents) {
          status = 'losing';
          recommendation = cpa > config.maxCpaCents * 2 ? 'kill' : 'reduce';
        } else {
          status = 'losing';
          recommendation = 'reduce';
        }

        return {
          campaignId: String(insight['campaign_id'] ?? ''),
          campaignName: String(insight['campaign_name'] ?? ''),
          impressions,
          clicks,
          spend: spendCents,
          conversions,
          revenue,
          roas,
          cpa,
          ctr,
          status,
          recommendation,
        };
      });
    } catch (err) {
      console.error(`[AdsPipeline] Performance analysis failed: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * Execute optimization recommendations automatically.
   * Scale winners (max +20%/day), reduce losers, kill poor performers.
   */
  async executeOptimizations(floorId: string, performances: CampaignPerformance[]): Promise<string[]> {
    const actions: string[] = [];

    for (const perf of performances) {
      switch (perf.recommendation) {
        case 'scale': {
          // Increase budget by 20% (Meta best practice: max 20%/day to maintain learning)
          const success = await this.adjustBudget(floorId, perf.campaignId, 1.2);
          if (success) actions.push(`Scaled "${perf.campaignName}" +20% (ROAS: ${perf.roas.toFixed(2)})`);
          break;
        }
        case 'reduce': {
          const success = await this.adjustBudget(floorId, perf.campaignId, 0.75);
          if (success) actions.push(`Reduced "${perf.campaignName}" -25% (CPA: $${(perf.cpa / 100).toFixed(2)})`);
          break;
        }
        case 'pause': {
          const success = await this.pauseCampaign(floorId, perf.campaignId, `CPA $${(perf.cpa / 100).toFixed(2)} exceeds max`);
          if (success) actions.push(`Paused "${perf.campaignName}" (CPA: $${(perf.cpa / 100).toFixed(2)})`);
          break;
        }
        case 'kill': {
          const success = await this.pauseCampaign(floorId, perf.campaignId, `ROAS ${perf.roas.toFixed(2)} below target after learning period`);
          if (success) actions.push(`Killed "${perf.campaignName}" (ROAS: ${perf.roas.toFixed(2)})`);
          break;
        }
        case 'maintain':
          // No action needed
          break;
      }
    }

    return actions;
  }

  // ── Daily Optimization Loop ──

  // Constants for optimization rules
  private readonly LEARNING_PHASE_DAYS = 7;
  private readonly ROAS_PAUSE_THRESHOLD = 1.0;
  private readonly ROAS_PAUSE_CONSECUTIVE_DAYS = 3;
  private readonly ROAS_SCALE_THRESHOLD = 3.0;
  private readonly ROAS_SCALE_CONSECUTIVE_DAYS = 3;
  private readonly MAX_DAILY_BUDGET_INCREASE = 0.20; // 20%
  private readonly FATIGUE_CTR_DECLINE_DAYS = 3;
  private readonly FATIGUE_FREQUENCY_THRESHOLD = 3.0;

  // Track performance history for consecutive day analysis
  private performanceHistory = new Map<string, Array<{ date: string; roas: number; ctr: number; frequency: number }>>();

  /**
   * Run daily optimization loop for a floor.
   * Pulls insights from Meta and TikTok, applies optimization rules, saves results.
   */
  async runDailyOptimization(floorId: string): Promise<void> {
    const config = this.accountConfigs.get(floorId);
    if (!config) return;

    try {
      const { getAdInsights } = await import('../integrations/meta.js');
      const { getTikTokAdInsights } = await import('../integrations/tiktok.js');

      const today = new Date();
      const todayStr = today.toISOString().split('T')[0] ?? '';
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const dateRange = {
        since: weekAgo.toISOString().split('T')[0] ?? '',
        until: todayStr,
      };

      // Fetch insights from both platforms
      const metaInsights = await getAdInsights(config.accessToken, config.adAccountId, dateRange);

      // TikTok insights (if advertiser ID configured)
      const tikTokAdvertiserId = ''; // Would come from config
      let tikTokInsights: Array<{
        campaignId: string;
        impressions: number;
        clicks: number;
        spendCents: number;
        conversions: number;
        ctr: number;
      }> = [];

      if (tikTokAdvertiserId) {
        tikTokInsights = await getTikTokAdInsights(
          tikTokAdvertiserId,
          [], // Would need active campaign IDs
          { start: dateRange.since, end: dateRange.until }
        );
      }

      const actions: string[] = [];

      // Process Meta campaigns
      for (const insight of metaInsights) {
        const campaignId = String(insight['campaign_id'] ?? '');
        const campaignName = String(insight['campaign_name'] ?? '');
        const impressions = Number(insight['impressions'] ?? 0);
        const clicks = Number(insight['clicks'] ?? 0);
        const spendCents = Math.round(Number(insight['spend'] ?? 0) * 100);
        const conversions = this.extractConversions(insight);
        const revenue = this.extractRevenue(insight);
        const roas = spendCents > 0 ? revenue / spendCents : 0;
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
        const frequency = Number(insight['frequency'] ?? 1.0);

        // Update performance history
        const history = this.performanceHistory.get(campaignId) ?? [];
        history.push({ date: todayStr, roas, ctr, frequency });
        // Keep last 14 days only
        if (history.length > 14) history.shift();
        this.performanceHistory.set(campaignId, history);

        // Check for ROAS pause signal (3+ consecutive days below threshold)
        const recentDays = history.slice(-this.ROAS_PAUSE_CONSECUTIVE_DAYS);
        if (recentDays.length >= this.ROAS_PAUSE_CONSECUTIVE_DAYS) {
          const allBelowThreshold = recentDays.every(d => d.roas < this.ROAS_PAUSE_THRESHOLD);
          if (allBelowThreshold) {
            await this.pauseCampaign(floorId, campaignId, `ROAS ${roas.toFixed(2)} below ${this.ROAS_PAUSE_THRESHOLD} for 3 consecutive days`);
            this.eventBus.emit('ads:paused', {
              floorId,
              campaignId,
              reason: `ROAS below threshold for 3 consecutive days`,
            });
            actions.push(`Paused "${campaignName}" (ROAS: ${roas.toFixed(2)})`);
            continue;
          }
        }

        // Check for scale signal (3+ consecutive days above scale threshold)
        if (recentDays.length >= this.ROAS_SCALE_CONSECUTIVE_DAYS) {
          const allAboveThreshold = recentDays.every(d => d.roas >= this.ROAS_SCALE_THRESHOLD);
          if (allAboveThreshold) {
            const success = await this.adjustBudget(floorId, campaignId, 1 + this.MAX_DAILY_BUDGET_INCREASE);
            if (success) {
              this.eventBus.emit('ads:scaled', {
                floorId,
                campaignId,
                budgetMultiplier: 1 + this.MAX_DAILY_BUDGET_INCREASE,
              });
              actions.push(`Scaled "${campaignName}" +${(this.MAX_DAILY_BUDGET_INCREASE * 100).toFixed(0)}% (ROAS: ${roas.toFixed(2)})`);
            }
          }
        }

        // Check for creative fatigue (CTR declining 3+ consecutive days OR frequency > threshold)
        if (recentDays.length >= this.FATIGUE_CTR_DECLINE_DAYS) {
          const ctrDeclining = recentDays.every((d, i) =>
            i === 0 || d.ctr < (recentDays[i - 1]?.ctr ?? d.ctr)
          );

          if (ctrDeclining || frequency > this.FATIGUE_FREQUENCY_THRESHOLD) {
            const reason = ctrDeclining
              ? `CTR declining for 3 consecutive days (current: ${ctr.toFixed(2)}%)`
              : `Frequency ${frequency.toFixed(1)} exceeds threshold ${this.FATIGUE_FREQUENCY_THRESHOLD}`;

            this.eventBus.emit('ads:fatigue-detected', {
              floorId,
              adSetId: campaignId,
              reason,
              action: 'creative-refresh-queued',
            });
            actions.push(`Creative fatigue detected on "${campaignName}": ${reason}`);
          }
        }
      }

      // Emit daily report
      const summary = `Analyzed ${metaInsights.length} Meta campaigns + ${tikTokInsights.length} TikTok campaigns. Executed ${actions.length} optimizations.`;
      this.eventBus.emit('ads:daily-report', {
        floorId,
        summary,
        actionsExecuted: actions,
      });

      console.log(`[AdsPipeline] Daily optimization for floor ${floorId}: ${summary}`);
    } catch (err) {
      console.error(`[AdsPipeline] Daily optimization failed: ${(err as Error).message}`);
    }
  }

  // ── Private Helpers ──

  private async createCampaign(config: AdAccountConfig, plan: CampaignPlan): Promise<string> {
    const res = await fetch(`${GRAPH_API}/act_${config.adAccountId}/campaigns`, {
      method: 'POST',
      body: new URLSearchParams({
        name: plan.name,
        objective: plan.objective,
        status: 'PAUSED',
        daily_budget: String(plan.dailyBudgetCents),
        special_ad_categories: '[]',
        access_token: config.accessToken,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => 'unknown');
      throw new Error(`Campaign creation failed (${res.status}): ${err}`);
    }

    const data = await res.json() as { id: string };
    return data.id;
  }

  private async createAdSet(
    config: AdAccountConfig,
    campaignId: string,
    dailyBudgetCents: number,
    plan: AdSetPlan,
  ): Promise<string> {
    const targeting: Record<string, unknown> = {};
    if (plan.targeting.ageMin) targeting['age_min'] = plan.targeting.ageMin;
    if (plan.targeting.ageMax) targeting['age_max'] = plan.targeting.ageMax;
    if (plan.targeting.genders) targeting['genders'] = plan.targeting.genders;
    if (plan.targeting.interests) targeting['interests'] = plan.targeting.interests;
    if (plan.targeting.locations) {
      targeting['geo_locations'] = { countries: plan.targeting.locations.map(l => l.key) };
    }

    const params: Record<string, string> = {
      name: plan.name,
      campaign_id: campaignId,
      daily_budget: String(dailyBudgetCents),
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'OFFSITE_CONVERSIONS',
      targeting: JSON.stringify(targeting),
      status: 'PAUSED',
      access_token: config.accessToken,
    };

    const res = await fetch(`${GRAPH_API}/act_${config.adAccountId}/adsets`, {
      method: 'POST',
      body: new URLSearchParams(params),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => 'unknown');
      throw new Error(`AdSet creation failed (${res.status}): ${err}`);
    }

    const data = await res.json() as { id: string };
    return data.id;
  }

  private async createAd(config: AdAccountConfig, adSetId: string, plan: AdCreativePlan): Promise<string> {
    // First create the ad creative
    const creativeParams: Record<string, string> = {
      name: plan.name,
      object_story_spec: JSON.stringify({
        page_id: config.pageId,
        link_data: {
          message: plan.body,
          link: plan.linkUrl,
          name: plan.headline,
          call_to_action: { type: plan.callToAction, value: { link: plan.linkUrl } },
          ...(plan.imageUrl ? { image_url: plan.imageUrl } : {}),
        },
      }),
      access_token: config.accessToken,
    };

    const creativeRes = await fetch(`${GRAPH_API}/act_${config.adAccountId}/adcreatives`, {
      method: 'POST',
      body: new URLSearchParams(creativeParams),
    });

    if (!creativeRes.ok) {
      const err = await creativeRes.text().catch(() => 'unknown');
      throw new Error(`Ad creative creation failed (${creativeRes.status}): ${err}`);
    }

    const creative = await creativeRes.json() as { id: string };

    // Then create the ad linking creative to ad set
    const adRes = await fetch(`${GRAPH_API}/act_${config.adAccountId}/ads`, {
      method: 'POST',
      body: new URLSearchParams({
        name: plan.name,
        adset_id: adSetId,
        creative: JSON.stringify({ creative_id: creative.id }),
        status: 'PAUSED',
        access_token: config.accessToken,
      }),
    });

    if (!adRes.ok) {
      const err = await adRes.text().catch(() => 'unknown');
      throw new Error(`Ad creation failed (${adRes.status}): ${err}`);
    }

    const ad = await adRes.json() as { id: string };
    return ad.id;
  }

  private async adjustBudget(floorId: string, campaignId: string, multiplier: number): Promise<boolean> {
    const config = this.accountConfigs.get(floorId);
    if (!config) return false;

    try {
      // Get current budget
      const infoRes = await fetch(`${GRAPH_API}/${campaignId}?fields=daily_budget&access_token=${config.accessToken}`);
      if (!infoRes.ok) return false;

      const info = await infoRes.json() as { daily_budget?: string };
      const currentBudget = Number(info.daily_budget ?? 0);
      const newBudget = Math.round(currentBudget * multiplier);

      // Enforce cap
      if (newBudget > config.dailyBudgetCapCents) {
        console.log(`[AdsPipeline] Budget adjustment would exceed cap — capping at ${config.dailyBudgetCapCents}¢`);
        return false;
      }

      const updateRes = await fetch(`${GRAPH_API}/${campaignId}`, {
        method: 'POST',
        body: new URLSearchParams({
          daily_budget: String(newBudget),
          access_token: config.accessToken,
        }),
      });

      return updateRes.ok;
    } catch {
      return false;
    }
  }

  private extractConversions(insight: Record<string, unknown>): number {
    const actions = insight['actions'] as Array<{ action_type: string; value: string }> | undefined;
    if (!actions) return 0;
    const purchase = actions.find(a => a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase');
    return Number(purchase?.value ?? 0);
  }

  private extractRevenue(insight: Record<string, unknown>): number {
    const actionValues = insight['action_values'] as Array<{ action_type: string; value: string }> | undefined;
    if (!actionValues) return 0;
    const purchaseValue = actionValues.find(a => a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase');
    return Math.round(Number(purchaseValue?.value ?? 0) * 100);
  }
}
