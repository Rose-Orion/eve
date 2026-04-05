/**
 * Meta (Facebook/Instagram) integration — Graph API + Marketing API.
 * Handles page publishing, ad campaign creation, and audience management.
 */

import { createHash } from 'node:crypto';

const GRAPH_API = 'https://graph.facebook.com/v21.0';

interface MetaConfig {
  accessToken: string;
  pageId: string;
  adAccountId: string;
}

function getMetaConfig(): MetaConfig | null {
  // These come from floor-level config after Meta OAuth
  return null; // Configured per-floor at runtime
}

export interface MetaPost {
  id: string;
  message: string;
  mediaUrl?: string;
}

export interface MetaCampaign {
  id: string;
  name: string;
  objective: string;
  status: string;
  dailyBudgetCents: number;
}

export async function publishPost(
  accessToken: string,
  pageId: string,
  message: string,
  imageUrl?: string,
): Promise<MetaPost> {
  const params = new URLSearchParams({ message, access_token: accessToken });
  if (imageUrl) params.set('url', imageUrl);

  const endpoint = imageUrl ? `${GRAPH_API}/${pageId}/photos` : `${GRAPH_API}/${pageId}/feed`;
  const res = await fetch(endpoint, { method: 'POST', body: params });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => 'unknown error');
    throw new Error(`Meta publishPost failed (${res.status}): ${errorBody}`);
  }

  const data = await res.json() as { id: string };
  return { id: data.id, message, mediaUrl: imageUrl };
}

export async function createCampaign(
  accessToken: string,
  adAccountId: string,
  name: string,
  objective: string,
  dailyBudgetCents: number,
): Promise<MetaCampaign> {
  const res = await fetch(`${GRAPH_API}/act_${adAccountId}/campaigns`, {
    method: 'POST',
    body: new URLSearchParams({
      name,
      objective,
      status: 'PAUSED',
      daily_budget: String(dailyBudgetCents),
      access_token: accessToken,
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => 'unknown error');
    throw new Error(`Meta createCampaign failed (${res.status}): ${errorBody}`);
  }

  const data = await res.json() as { id: string };
  return { id: data.id, name, objective, status: 'PAUSED', dailyBudgetCents };
}

export async function getAdInsights(
  accessToken: string,
  adAccountId: string,
  dateRange: { since: string; until: string },
): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({
    fields: 'campaign_name,impressions,clicks,spend,actions,cost_per_action_type',
    time_range: JSON.stringify(dateRange),
    access_token: accessToken,
  });
  const res = await fetch(`${GRAPH_API}/act_${adAccountId}/insights?${params}`);

  if (!res.ok) {
    console.warn(`[Meta] getAdInsights failed (${res.status})`);
    return [];
  }

  const data = await res.json() as { data?: Record<string, unknown>[] };
  return data.data ?? [];
}

export async function checkConnection(accessToken?: string): Promise<boolean> {
  if (!accessToken) return false;
  try {
    const res = await fetch(`${GRAPH_API}/me?access_token=${accessToken}`);
    return res.ok;
  } catch { return false; }
}

// --- Meta Conversions API (CAPI) — Server-Side Event Tracking ---

/**
 * Hash user data fields with SHA256 for Meta CAPI.
 * Meta requires lowercase, trimmed, SHA256-hashed PII fields.
 */
function hashForCAPI(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

export interface CAPIUserData {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
  fbp?: string; // Facebook browser pixel cookie
  fbc?: string; // Facebook click ID cookie
}

export interface CAPIEvent {
  eventName: 'PageView' | 'ViewContent' | 'AddToCart' | 'InitiateCheckout' | 'Purchase' | 'Lead' | 'CompleteRegistration';
  eventTime: number; // Unix timestamp in seconds
  eventId: string; // For deduplication with browser Pixel
  eventSourceUrl: string;
  userData: CAPIUserData;
  customData?: Record<string, unknown>;
  actionSource: 'website' | 'server';
}

// Event batch for efficient CAPI calls
const eventBatches = new Map<string, CAPIEvent[]>(); // keyed by pixelId
const BATCH_SIZE = 100;
const BATCH_FLUSH_INTERVAL_MS = 15_000;
let batchFlushTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Queue a server-side conversion event for Meta CAPI.
 * Events are batched and flushed every 15 seconds or at 100 events.
 */
export function queueConversionEvent(pixelId: string, event: CAPIEvent): void {
  const batch = eventBatches.get(pixelId) ?? [];
  batch.push(event);
  eventBatches.set(pixelId, batch);

  if (batch.length >= BATCH_SIZE) {
    flushEventBatch(pixelId).catch(err => {
      console.error(`[CAPI] Flush failed for pixel ${pixelId}:`, (err as Error).message);
    });
  }
}

/**
 * Flush queued events to Meta Conversions API.
 * Access token should be retrieved from floor config (OAuth) before calling.
 */
export async function flushEventBatch(pixelId: string, accessToken?: string): Promise<{ eventsReceived: number; fbtrace?: string }> {
  const batch = eventBatches.get(pixelId) ?? [];
  if (batch.length === 0) return { eventsReceived: 0 };

  eventBatches.set(pixelId, []);

  if (!accessToken) {
    console.warn('[CAPI] No access token provided — events discarded');
    return { eventsReceived: 0 };
  }

  const data = batch.map(event => ({
    event_name: event.eventName,
    event_time: event.eventTime,
    event_id: event.eventId,
    event_source_url: event.eventSourceUrl,
    action_source: event.actionSource,
    user_data: {
      ...(event.userData.email && { em: [hashForCAPI(event.userData.email)] }),
      ...(event.userData.phone && { ph: [hashForCAPI(event.userData.phone)] }),
      ...(event.userData.firstName && { fn: [hashForCAPI(event.userData.firstName)] }),
      ...(event.userData.lastName && { ln: [hashForCAPI(event.userData.lastName)] }),
      ...(event.userData.city && { ct: [hashForCAPI(event.userData.city)] }),
      ...(event.userData.state && { st: [hashForCAPI(event.userData.state)] }),
      ...(event.userData.zip && { zp: [hashForCAPI(event.userData.zip)] }),
      ...(event.userData.country && { country: [hashForCAPI(event.userData.country)] }),
      ...(event.userData.clientIpAddress && { client_ip_address: event.userData.clientIpAddress }),
      ...(event.userData.clientUserAgent && { client_user_agent: event.userData.clientUserAgent }),
      ...(event.userData.fbp && { fbp: event.userData.fbp }),
      ...(event.userData.fbc && { fbc: event.userData.fbc }),
    },
    ...(event.customData && { custom_data: event.customData }),
  }));

  // Use test_event_code in non-production for debugging
  const testCode = process.env['META_TEST_EVENT_CODE'];
  const body: Record<string, unknown> = { data };
  if (testCode) body.test_event_code = testCode;

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${pixelId}/events?access_token=${accessToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[CAPI] Failed to send events: ${res.status} ${errText}`);
    return { eventsReceived: 0 };
  }

  const result = await res.json() as { events_received?: number; fbtrace_id?: string };
  console.log(`[CAPI] Sent ${batch.length} events to pixel ${pixelId} — received: ${result.events_received}`);
  return { eventsReceived: result.events_received ?? 0, fbtrace: result.fbtrace_id };
}

/**
 * Start the batch flush timer. Call once at Orchestrator boot.
 * Caller must ensure access tokens are available for each pixel when flushing.
 */
export function startCAPIBatchFlush(tokenProvider?: (pixelId: string) => string | undefined): void {
  if (batchFlushTimer) return;
  batchFlushTimer = setInterval(() => {
    for (const pixelId of eventBatches.keys()) {
      const token = tokenProvider?.(pixelId);
      flushEventBatch(pixelId, token).catch(err => {
        console.error(`[CAPI] Periodic flush failed:`, (err as Error).message);
      });
    }
  }, BATCH_FLUSH_INTERVAL_MS);
}

/**
 * Stop the batch flush timer and flush remaining events.
 */
export async function stopCAPIBatchFlush(tokenProvider?: (pixelId: string) => string | undefined): Promise<void> {
  if (batchFlushTimer) {
    clearInterval(batchFlushTimer);
    batchFlushTimer = null;
  }
  // Flush remaining events
  for (const pixelId of eventBatches.keys()) {
    const token = tokenProvider?.(pixelId);
    await flushEventBatch(pixelId, token);
  }
}

// --- Full Ad Creation Hierarchy ---

export interface MetaTargeting {
  ageMin?: number;
  ageMax?: number;
  genders?: number[]; // 1=male, 2=female
  geoLocations?: { countries?: string[]; cities?: Array<{ key: string }> };
  interests?: Array<{ id: string; name: string }>;
  customAudiences?: Array<{ id: string }>;
}

export interface MetaAdSetParams {
  campaignId: string;
  name: string;
  dailyBudgetCents: number;
  targeting: MetaTargeting;
  optimizationGoal: 'OFFSITE_CONVERSIONS' | 'LINK_CLICKS' | 'IMPRESSIONS' | 'REACH';
  billingEvent: 'IMPRESSIONS' | 'LINK_CLICKS';
  startTime?: string; // ISO 8601
  status?: 'ACTIVE' | 'PAUSED';
}

export async function createAdSet(
  accessToken: string,
  adAccountId: string,
  params: MetaAdSetParams,
): Promise<{ id: string } | null> {
  if (!accessToken) return null;

  const body = {
    campaign_id: params.campaignId,
    name: params.name,
    daily_budget: params.dailyBudgetCents, // Meta API uses cents
    targeting: {
      ...(params.targeting.ageMin && { age_min: params.targeting.ageMin }),
      ...(params.targeting.ageMax && { age_max: params.targeting.ageMax }),
      ...(params.targeting.genders && { genders: params.targeting.genders }),
      ...(params.targeting.geoLocations && { geo_locations: params.targeting.geoLocations }),
      ...(params.targeting.interests?.length && {
        flexible_spec: [{ interests: params.targeting.interests }],
      }),
      ...(params.targeting.customAudiences?.length && {
        custom_audiences: params.targeting.customAudiences,
      }),
    },
    optimization_goal: params.optimizationGoal,
    billing_event: params.billingEvent,
    status: params.status ?? 'PAUSED',
    ...(params.startTime && { start_time: params.startTime }),
  };

  const res = await fetch(
    `https://graph.facebook.com/v21.0/act_${adAccountId}/adsets`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) return null;
  const data = await res.json() as { id?: string };
  return data.id ? { id: data.id } : null;
}

export async function uploadAdImage(
  accessToken: string,
  adAccountId: string,
  imageUrl: string,
  name?: string,
): Promise<{ hash: string; url: string } | null> {
  // Download image and upload to Meta
  if (!accessToken) return null;

  const res = await fetch(
    `https://graph.facebook.com/v21.0/act_${adAccountId}/adimages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        url: imageUrl,
        name: name ?? `ad-image-${Date.now()}`,
      }),
    },
  );

  if (!res.ok) return null;
  const data = await res.json() as { images?: Record<string, { hash: string; url: string }> };
  const firstImage = data.images ? Object.values(data.images)[0] : undefined;
  return firstImage ? { hash: firstImage.hash, url: firstImage.url } : null;
}

export async function createAdCreative(
  accessToken: string,
  adAccountId: string,
  params: {
    name: string;
    pageId: string;
    imageHash?: string;
    videoId?: string;
    headline: string;
    body: string;
    callToAction: string;
    link: string;
  },
): Promise<{ id: string } | null> {
  if (!accessToken) return null;

  const objectStorySpec: Record<string, unknown> = {
    page_id: params.pageId,
    link_data: {
      message: params.body,
      link: params.link,
      name: params.headline,
      call_to_action: { type: params.callToAction, value: { link: params.link } },
      ...(params.imageHash && { image_hash: params.imageHash }),
      ...(params.videoId && { video_id: params.videoId }),
    },
  };

  const res = await fetch(
    `https://graph.facebook.com/v21.0/act_${adAccountId}/adcreatives`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        name: params.name,
        object_story_spec: objectStorySpec,
      }),
    },
  );

  if (!res.ok) return null;
  const data = await res.json() as { id?: string };
  return data.id ? { id: data.id } : null;
}

export async function createAd(
  accessToken: string,
  adAccountId: string,
  params: {
    name: string;
    adSetId: string;
    creativeId: string;
    status?: 'ACTIVE' | 'PAUSED';
  },
): Promise<{ id: string } | null> {
  if (!accessToken) return null;

  const res = await fetch(
    `https://graph.facebook.com/v21.0/act_${adAccountId}/ads`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        name: params.name,
        adset_id: params.adSetId,
        creative: { creative_id: params.creativeId },
        status: params.status ?? 'PAUSED',
      }),
    },
  );

  if (!res.ok) return null;
  const data = await res.json() as { id?: string };
  return data.id ? { id: data.id } : null;
}

// --- Instagram Media Container API (Reels, Stories, Carousels) ---

export interface MediaContainerOptions {
  children?: string[]; // Child container IDs for carousel
  shareToFeed?: boolean;
  coverUrl?: string;
}

export interface MediaContainerResult {
  id: string;
  status?: string;
}

export interface ContainerStatusResult {
  status_code: string;
}

/**
 * Create an Instagram media container (Image, Reel, Carousel, or Story).
 * Returns the container ID; call publishMediaContainer after polling status.
 */
export async function createMediaContainer(
  igAccountId: string,
  mediaType: 'IMAGE' | 'REELS' | 'CAROUSEL' | 'STORIES',
  mediaUrl: string,
  caption: string,
  options?: MediaContainerOptions,
  accessToken?: string,
): Promise<MediaContainerResult> {
  if (!accessToken) throw new Error('Access token required for media container creation');

  const body: Record<string, unknown> = {
    caption,
    access_token: accessToken,
  };

  switch (mediaType) {
    case 'IMAGE':
      body.image_url = mediaUrl;
      break;
    case 'REELS':
      body.video_url = mediaUrl;
      body.media_type = 'REELS';
      body.share_to_feed = options?.shareToFeed ?? true;
      break;
    case 'CAROUSEL':
      body.children = options?.children ?? [];
      body.media_type = 'CAROUSEL';
      break;
    case 'STORIES':
      body.video_url = mediaUrl;
      body.media_type = 'STORIES';
      break;
  }

  const params = new URLSearchParams(
    Object.entries(body).reduce((acc, [k, v]) => {
      if (Array.isArray(v)) {
        v.forEach((item, i) => acc[`${k}[${i}]`] = String(item));
      } else if (v !== undefined) {
        acc[k] = String(v);
      }
      return acc;
    }, {} as Record<string, string>),
  );

  const res = await fetch(`${GRAPH_API}/${igAccountId}/media`, {
    method: 'POST',
    body: params,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'unknown error');
    throw new Error(`Failed to create media container: ${res.status} ${errText}`);
  }

  const data = await res.json() as { id?: string };
  if (!data.id) throw new Error('No container ID returned from Meta API');

  return { id: data.id };
}

/**
 * Check the status of a media container.
 * Returns { status_code: 'FINISHED' | 'IN_PROGRESS' | 'ERROR' }
 */
export async function checkContainerStatus(
  containerId: string,
  accessToken?: string,
): Promise<ContainerStatusResult> {
  if (!accessToken) throw new Error('Access token required for status check');

  const res = await fetch(
    `${GRAPH_API}/${containerId}?fields=status_code&access_token=${accessToken}`,
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => 'unknown error');
    throw new Error(`Failed to check container status: ${res.status} ${errText}`);
  }

  const data = await res.json() as ContainerStatusResult;
  return data;
}

/**
 * Publish a media container to Instagram feed.
 */
export async function publishMediaContainer(
  igAccountId: string,
  containerId: string,
  accessToken?: string,
): Promise<{ id: string }> {
  if (!accessToken) throw new Error('Access token required for publishing');

  const res = await fetch(
    `${GRAPH_API}/${igAccountId}/media_publish`,
    {
      method: 'POST',
      body: new URLSearchParams({
        creation_id: containerId,
        access_token: accessToken,
      }),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => 'unknown error');
    throw new Error(`Failed to publish media container: ${res.status} ${errText}`);
  }

  const data = await res.json() as { id?: string };
  if (!data.id) throw new Error('No media ID returned from publish');

  return { id: data.id };
}

/**
 * High-level function: Create → Poll Status → Publish Instagram content.
 * Retries up to 20 times with 5-second delay for video processing.
 */
export async function publishInstagramContent(
  igAccountId: string,
  mediaType: 'IMAGE' | 'REELS' | 'CAROUSEL' | 'STORIES',
  mediaUrl: string,
  caption: string,
  options?: MediaContainerOptions & { accessToken?: string },
): Promise<{ mediaId: string; containerId: string }> {
  const accessToken = options?.accessToken;
  if (!accessToken) throw new Error('Access token required for Instagram publishing');

  // Step 1: Create container
  const containerResult = await createMediaContainer(
    igAccountId,
    mediaType,
    mediaUrl,
    caption,
    options,
    accessToken,
  );

  // Step 2: Poll status until FINISHED (max 20 retries, 5 second delay)
  let statusResult: ContainerStatusResult | null = null;
  let attempts = 0;
  const maxAttempts = 20;
  const delayMs = 5000;

  while (attempts < maxAttempts) {
    try {
      statusResult = await checkContainerStatus(containerResult.id, accessToken);

      if (statusResult.status_code === 'FINISHED') {
        break;
      } else if (statusResult.status_code === 'ERROR') {
        throw new Error('Container processing failed with ERROR status');
      }
      // IN_PROGRESS — wait and retry
    } catch (err) {
      // Network/API error — retry
      console.warn(
        `[Meta] Status check attempt ${attempts + 1}/${maxAttempts} failed: ${(err as Error).message}`,
      );
    }

    attempts++;
    if (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  if (!statusResult || statusResult.status_code !== 'FINISHED') {
    throw new Error(
      `Container ${containerResult.id} did not finish processing after ${maxAttempts} retries`,
    );
  }

  // Step 3: Publish
  const publishResult = await publishMediaContainer(igAccountId, containerResult.id, accessToken);

  return {
    mediaId: publishResult.id,
    containerId: containerResult.id,
  };
}
