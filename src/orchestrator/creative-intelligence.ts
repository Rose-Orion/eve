/**
 * Creative Intelligence — fatigue detection, winner tracking, cross-floor creative learning.
 */

import type { EventBus } from './event-bus.js';

export interface CreativePerformance {
  adId: string;
  floorId: string;
  dailyCTR: number[];  // Last N days
  frequency: number;
  impressions: number;
  conversions: number;
  roas: number;
}

export interface WinningCreative {
  floorId: string;
  creativeType: 'headline' | 'image' | 'video' | 'audience' | 'hook';
  content: string;
  performance: { roas: number; ctr: number; conversionRate: number };
  recordedAt: Date;
}

export class CreativeIntelligence {
  private performanceHistory = new Map<string, CreativePerformance>();
  private winners: WinningCreative[] = [];

  constructor(private eventBus: EventBus) {}

  /**
   * Detect creative fatigue based on CTR decline or high frequency.
   */
  detectFatigue(adId: string, dailyMetrics: { ctr: number; frequency: number }[]): {
    fatigued: boolean;
    reason?: string;
  } {
    if (dailyMetrics.length < 3) return { fatigued: false };

    // Check CTR decline for 3+ consecutive days
    const recent = dailyMetrics.slice(-3);
    const ctrDeclining = recent.every((m, i) =>
      i === 0 || m.ctr < (recent[i - 1]?.ctr ?? m.ctr)
    );

    if (ctrDeclining) {
      return { fatigued: true, reason: `CTR declining ${recent.length} consecutive days` };
    }

    // Check frequency threshold
    const latestFrequency = dailyMetrics[dailyMetrics.length - 1]?.frequency ?? 0;
    if (latestFrequency > 3.0) {
      return { fatigued: true, reason: `Frequency ${latestFrequency.toFixed(1)} exceeds 3.0 threshold` };
    }

    return { fatigued: false };
  }

  /**
   * Record a winning creative element for the Winners Hub.
   */
  recordWinner(winner: WinningCreative): void {
    this.winners.push(winner);
    this.eventBus.emit('ads:winner-recorded' as any, {
      floorId: winner.floorId,
      type: winner.creativeType,
      roas: winner.performance.roas,
    });
  }

  /**
   * Get winning patterns for a floor (or cross-floor if no floor specified).
   */
  getWinningPatterns(floorId?: string): WinningCreative[] {
    if (floorId) {
      return this.winners.filter(w => w.floorId === floorId);
    }
    return [...this.winners];
  }

  /**
   * Trigger a creative refresh for a fatigued ad.
   */
  triggerCreativeRefresh(floorId: string, adSetId: string, reason: string): void {
    this.eventBus.emit('ads:fatigue-detected' as any, {
      floorId,
      adSetId,
      reason,
      action: 'creative-refresh-queued',
    });
  }

  /**
   * Analyze creative performance and identify winners/losers.
   */
  analyzeCreatives(floorId: string, performances: CreativePerformance[]): {
    winners: CreativePerformance[];
    fatigued: CreativePerformance[];
    normal: CreativePerformance[];
  } {
    const winners: CreativePerformance[] = [];
    const fatigued: CreativePerformance[] = [];
    const normal: CreativePerformance[] = [];

    for (const perf of performances) {
      // Winner: ROAS > 3x and CTR above average
      if (perf.roas >= 3.0) {
        winners.push(perf);
        continue;
      }

      // Fatigued: CTR declining or frequency too high
      const fatigueCheck = this.detectFatigue(perf.adId,
        perf.dailyCTR.map((ctr, i) => ({ ctr, frequency: i === perf.dailyCTR.length - 1 ? perf.frequency : 0 }))
      );
      if (fatigueCheck.fatigued) {
        fatigued.push(perf);
        continue;
      }

      normal.push(perf);
    }

    return { winners, fatigued, normal };
  }
}
