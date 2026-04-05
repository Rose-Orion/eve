/**
 * TikTok integration — Content Publishing API + Marketing API.
 */

import { getConfig } from '../config/index.js';

const TIKTOK_API = 'https://open.tiktokapis.com/v2';

export interface TikTokVideo {
  publishId: string;
  status: string;
}

export async function initVideoUpload(
  accessToken: string,
  title: string,
): Promise<{ uploadUrl: string; publishId: string }> {
  const res = await fetch(`${TIKTOK_API}/post/publish/inbox/video/init/`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      post_info: { title, privacy_level: 'SELF_ONLY' },
      source_info: { source: 'FILE_UPLOAD' },
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => 'unknown error');
    throw new Error(`TikTok initVideoUpload failed (${res.status}): ${errorBody}`);
  }

  const data = await res.json() as { data?: { publish_id: string; upload_url: string } };
  return {
    uploadUrl: data.data?.upload_url ?? '',
    publishId: data.data?.publish_id ?? '',
  };
}

export async function getPublishStatus(
  accessToken: string,
  publishId: string,
): Promise<TikTokVideo> {
  const res = await fetch(`${TIKTOK_API}/post/publish/status/fetch/`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ publish_id: publishId }),
  });

  if (!res.ok) {
    console.warn(`[TikTok] getPublishStatus failed (${res.status})`);
    return { publishId, status: 'unknown' };
  }

  const data = await res.json() as { data?: { status: string } };
  return { publishId, status: data.data?.status ?? 'unknown' };
}

export async function checkConnection(accessToken?: string): Promise<boolean> {
  if (!accessToken) return false;
  try {
    const res = await fetch(`${TIKTOK_API}/user/info/`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    return res.ok;
  } catch { return false; }
}

// --- TikTok Marketing API ---

export async function createTikTokCampaign(
  advertiserId: string,
  params: {
    name: string;
    objective: 'TRAFFIC' | 'CONVERSIONS' | 'REACH' | 'VIDEO_VIEWS';
    budgetCents: number;
    budgetMode: 'BUDGET_MODE_DAY' | 'BUDGET_MODE_TOTAL';
  },
): Promise<{ campaignId: string } | null> {
  const config = getConfig();
  const accessToken = config.TIKTOK_ACCESS_TOKEN;
  if (!accessToken) return null;

  const res = await fetch('https://business-api.tiktok.com/open_api/v1.3/campaign/create/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Access-Token': accessToken,
    },
    body: JSON.stringify({
      advertiser_id: advertiserId,
      campaign_name: params.name,
      objective_type: params.objective,
      budget: params.budgetCents / 100, // TikTok uses dollars
      budget_mode: params.budgetMode,
    }),
  });

  if (!res.ok) return null;
  const data = await res.json() as { data?: { campaign_id?: string } };
  return data.data?.campaign_id ? { campaignId: data.data.campaign_id } : null;
}

export async function createTikTokAdGroup(
  advertiserId: string,
  params: {
    campaignId: string;
    name: string;
    placements: string[];
    dailyBudgetCents: number;
    schedule: { startTime: string; endTime?: string };
    targeting: {
      ageGroups?: string[];
      genders?: string[];
      locations?: string[];
      interests?: string[];
    };
    optimizationGoal: 'CLICK' | 'CONVERT' | 'IMPRESSION' | 'REACH';
  },
): Promise<{ adGroupId: string } | null> {
  const config = getConfig();
  const accessToken = config.TIKTOK_ACCESS_TOKEN;
  if (!accessToken) return null;

  const res = await fetch('https://business-api.tiktok.com/open_api/v1.3/adgroup/create/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Access-Token': accessToken,
    },
    body: JSON.stringify({
      advertiser_id: advertiserId,
      campaign_id: params.campaignId,
      adgroup_name: params.name,
      placement_type: 'PLACEMENT_TYPE_NORMAL',
      placements: params.placements,
      budget: params.dailyBudgetCents / 100,
      budget_mode: 'BUDGET_MODE_DAY',
      schedule_type: 'SCHEDULE_START_END',
      schedule_start_time: params.schedule.startTime,
      ...(params.schedule.endTime && { schedule_end_time: params.schedule.endTime }),
      optimization_goal: params.optimizationGoal,
      bid_type: 'BID_TYPE_NO_BID',
      ...(params.targeting.ageGroups && { age_groups: params.targeting.ageGroups }),
      ...(params.targeting.genders && { gender: params.targeting.genders }),
      ...(params.targeting.locations && { location_ids: params.targeting.locations }),
      ...(params.targeting.interests && { interest_category_ids: params.targeting.interests }),
    }),
  });

  if (!res.ok) return null;
  const data = await res.json() as { data?: { adgroup_id?: string } };
  return data.data?.adgroup_id ? { adGroupId: data.data.adgroup_id } : null;
}

export async function createTikTokAd(
  advertiserId: string,
  params: {
    adGroupId: string;
    name: string;
    videoId?: string;
    imageIds?: string[];
    text: string;
    callToAction: string;
    landingPageUrl: string;
  },
): Promise<{ adId: string } | null> {
  const config = getConfig();
  const accessToken = config.TIKTOK_ACCESS_TOKEN;
  if (!accessToken) return null;

  const res = await fetch('https://business-api.tiktok.com/open_api/v1.3/ad/create/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Access-Token': accessToken,
    },
    body: JSON.stringify({
      advertiser_id: advertiserId,
      adgroup_id: params.adGroupId,
      ad_name: params.name,
      ad_text: params.text,
      call_to_action: params.callToAction,
      landing_page_url: params.landingPageUrl,
      ...(params.videoId && { video_id: params.videoId }),
      ...(params.imageIds && { image_ids: params.imageIds }),
    }),
  });

  if (!res.ok) return null;
  const data = await res.json() as { data?: { ad_id?: string } };
  return data.data?.ad_id ? { adId: data.data.ad_id } : null;
}

export async function getTikTokAdInsights(
  advertiserId: string,
  campaignIds: string[],
  dateRange: { start: string; end: string },
): Promise<Array<{
  campaignId: string;
  impressions: number;
  clicks: number;
  spendCents: number;
  conversions: number;
  ctr: number;
}>> {
  const config = getConfig();
  const accessToken = config.TIKTOK_ACCESS_TOKEN;
  if (!accessToken) return [];

  const res = await fetch('https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Access-Token': accessToken,
    },
    body: JSON.stringify({
      advertiser_id: advertiserId,
      report_type: 'BASIC',
      data_level: 'AUCTION_CAMPAIGN',
      dimensions: ['campaign_id'],
      metrics: ['spend', 'impressions', 'clicks', 'conversion', 'ctr'],
      start_date: dateRange.start,
      end_date: dateRange.end,
      filtering: {
        campaign_ids: campaignIds,
      },
    }),
  });

  if (!res.ok) return [];
  const data = await res.json() as {
    data?: {
      list?: Array<{
        dimensions?: { campaign_id?: string };
        metrics?: {
          spend?: string;
          impressions?: string;
          clicks?: string;
          conversion?: string;
          ctr?: string;
        };
      }>;
    };
  };

  return (data.data?.list ?? []).map(row => ({
    campaignId: row.dimensions?.campaign_id ?? '',
    impressions: parseInt(row.metrics?.impressions ?? '0', 10),
    clicks: parseInt(row.metrics?.clicks ?? '0', 10),
    spendCents: Math.round(parseFloat(row.metrics?.spend ?? '0') * 100),
    conversions: parseInt(row.metrics?.conversion ?? '0', 10),
    ctr: parseFloat(row.metrics?.ctr ?? '0'),
  }));
}

export async function enableSparkAd(
  advertiserId: string,
  videoId: string,
): Promise<{ authCode: string } | null> {
  const config = getConfig();
  const accessToken = config.TIKTOK_ACCESS_TOKEN;
  if (!accessToken) return null;

  const res = await fetch('https://business-api.tiktok.com/open_api/v1.3/tt_video/authorize/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Access-Token': accessToken,
    },
    body: JSON.stringify({
      advertiser_id: advertiserId,
      video_id: videoId,
    }),
  });

  if (!res.ok) return null;
  const data = await res.json() as { data?: { auth_code?: string } };
  return data.data?.auth_code ? { authCode: data.data.auth_code } : null;
}
