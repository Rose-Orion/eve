/**
 * TokenManager — manages OAuth token lifecycle for Meta and TikTok.
 * Stores tokens with expiry timestamps, refreshes automatically 7 days before expiry.
 *
 * WARNING: Tokens are currently in-memory only. On server restart, all stored
 * OAuth tokens (Meta, TikTok) are lost and floors lose their integrations
 * until manually reconnected.
 *
 * TODO: Persist tokens to Supabase floor_tokens table. On start(), load all
 * tokens from the table. On setToken(), write-through to Supabase. This ensures
 * tokens survive restarts and PM2 process cycling.
 */

import type { EventBus } from '../orchestrator/event-bus.js';

export type TokenProvider = 'meta' | 'tiktok';

interface StoredToken {
  provider: TokenProvider;
  floorId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  updatedAt: Date;
}

const REFRESH_BUFFER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days before expiry
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // Check every 6 hours

export class TokenManager {
  private tokens = new Map<string, StoredToken>(); // key: "{provider}:{floorId}"
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private eventBus: EventBus) {}

  private key(provider: TokenProvider, floorId: string): string {
    return `${provider}:${floorId}`;
  }

  /** Store a token (called after OAuth flow or manual config). */
  setToken(provider: TokenProvider, floorId: string, accessToken: string, expiresInSeconds: number, refreshToken?: string): void {
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    this.tokens.set(this.key(provider, floorId), {
      provider,
      floorId,
      accessToken,
      refreshToken,
      expiresAt,
      updatedAt: new Date(),
    });
    console.log(`[TokenManager] Stored ${provider} token for floor ${floorId.slice(0, 8)}, expires ${expiresAt.toISOString()}`);
  }

  /** Get a valid token, refreshing if needed. Returns null if no token or refresh fails. */
  async getToken(provider: TokenProvider, floorId: string): Promise<string | null> {
    const stored = this.tokens.get(this.key(provider, floorId));
    if (!stored) return null;

    // Check if refresh needed (within 7 days of expiry)
    if (this.needsRefresh(stored)) {
      const refreshed = await this.refreshToken(stored);
      if (!refreshed) return stored.accessToken; // Return current token, it might still work
    }

    return stored.accessToken;
  }

  private needsRefresh(token: StoredToken): boolean {
    return token.expiresAt.getTime() - Date.now() < REFRESH_BUFFER_MS;
  }

  /** Refresh a token based on provider. */
  private async refreshToken(stored: StoredToken): Promise<boolean> {
    try {
      if (stored.provider === 'meta') {
        return await this.refreshMetaToken(stored);
      } else if (stored.provider === 'tiktok') {
        return await this.refreshTikTokToken(stored);
      }
      return false;
    } catch (err) {
      console.error(`[TokenManager] Failed to refresh ${stored.provider} token for floor ${stored.floorId.slice(0, 8)}:`, (err as Error).message);
      this.eventBus.emit('token:refresh-failed', {
        provider: stored.provider,
        floorId: stored.floorId,
        error: (err as Error).message,
      });
      return false;
    }
  }

  /**
   * Meta token refresh — exchange long-lived token for a new long-lived token.
   * Meta long-lived tokens last ~60 days. Refresh returns a new one.
   * https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/
   */
  private async refreshMetaToken(stored: StoredToken): Promise<boolean> {
    // Note: In production, app_id and app_secret come from config.
    // This refresh endpoint exchanges an existing long-lived token for a new one.
    const { getConfig } = await import('../config/index.js');
    const config = getConfig();
    const appId = config.META_APP_ID;
    const appSecret = config.META_APP_SECRET;

    if (!appId || !appSecret) {
      console.warn('[TokenManager] Meta app credentials not configured — cannot refresh token');
      return false;
    }

    const url = `https://graph.facebook.com/v21.0/oauth/access_token?` +
      `grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}` +
      `&fb_exchange_token=${stored.accessToken}`;

    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => 'unknown');
      throw new Error(`Meta token refresh failed (${res.status}): ${body}`);
    }

    const data = await res.json() as { access_token: string; expires_in?: number };
    const newExpiresIn = data.expires_in ?? 5184000; // Default 60 days

    this.setToken('meta', stored.floorId, data.access_token, newExpiresIn);

    this.eventBus.emit('token:refreshed', {
      provider: 'meta',
      floorId: stored.floorId,
    });

    console.log(`[TokenManager] Meta token refreshed for floor ${stored.floorId.slice(0, 8)}`);
    return true;
  }

  /**
   * TikTok token refresh — use refresh_token to get new access_token.
   * https://developers.tiktok.com/doc/oauth-user-access-token-management/
   */
  private async refreshTikTokToken(stored: StoredToken): Promise<boolean> {
    if (!stored.refreshToken) {
      console.warn('[TokenManager] No TikTok refresh token available');
      return false;
    }

    const { getConfig } = await import('../config/index.js');
    const config = getConfig();
    const clientKey = config.TIKTOK_CLIENT_KEY;
    const clientSecret = config.TIKTOK_CLIENT_SECRET;

    if (!clientKey || !clientSecret) {
      console.warn('[TokenManager] TikTok client credentials not configured — cannot refresh token');
      return false;
    }

    const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: stored.refreshToken,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => 'unknown');
      throw new Error(`TikTok token refresh failed (${res.status}): ${body}`);
    }

    const data = await res.json() as {
      data?: { access_token: string; expires_in: number; refresh_token: string; refresh_expires_in: number };
    };

    if (!data.data?.access_token) {
      throw new Error('TikTok token refresh returned empty data');
    }

    this.setToken(
      'tiktok', stored.floorId,
      data.data.access_token,
      data.data.expires_in,
      data.data.refresh_token,
    );

    this.eventBus.emit('token:refreshed', {
      provider: 'tiktok',
      floorId: stored.floorId,
    });

    console.log(`[TokenManager] TikTok token refreshed for floor ${stored.floorId.slice(0, 8)}`);
    return true;
  }

  /** Start periodic token refresh checks (every 6 hours). */
  start(): void {
    this.checkInterval = setInterval(() => {
      this.checkAllTokens().catch(err => {
        console.error('[TokenManager] Periodic check failed:', (err as Error).message);
      });
    }, CHECK_INTERVAL_MS);

    // Run immediately on start
    this.checkAllTokens().catch(() => {});
    console.log('[TokenManager] Started — checking tokens every 6 hours');
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /** Check all stored tokens and refresh any that are near expiry. */
  private async checkAllTokens(): Promise<void> {
    for (const stored of this.tokens.values()) {
      if (this.needsRefresh(stored)) {
        console.log(`[TokenManager] ${stored.provider} token for floor ${stored.floorId.slice(0, 8)} needs refresh`);
        await this.refreshToken(stored);
      }
    }
  }

  /** Get token status for health checks. */
  getStatus(): Array<{ provider: TokenProvider; floorId: string; expiresAt: Date; needsRefresh: boolean }> {
    return [...this.tokens.values()].map(t => ({
      provider: t.provider,
      floorId: t.floorId,
      expiresAt: t.expiresAt,
      needsRefresh: this.needsRefresh(t),
    }));
  }
}
