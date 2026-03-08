/**
 * Data module — `/v1/data/latest`, `/v1/api/data/{token}`, `/v1/data/push/{requestId}`.
 *
 * - `getLatest()` — auth-gated, returns tier-appropriate data (bypasses CDN cache).
 * - `getTokenData(token)` — x402 or bundle deduction per token.
 * - `getDataPush(requestId)` — 72h snapshot, no auth needed.
 */

import type { AttaGoClient } from './index.js';

// ── Response types (minimal — expanded in Task 2.7) ─────────────────

/** Response from GET /v1/data/latest. */
export interface DataLatestResponse {
  assets: Record<string, Record<string, unknown>>;
  assetOrder: string[];
  market: Record<string, unknown>;
  sources: Array<Record<string, unknown>>;
  meta: Record<string, unknown>;
}

/** Response from GET /v1/api/data/{token}. */
export interface DataTokenResponse {
  token: string;
  composite: Record<string, unknown>;
  spot: Record<string, unknown>;
  perps: Record<string, unknown> | null;
  context: Record<string, unknown>;
  market: Record<string, unknown>;
  derivSymbols: string[];
  hasDerivatives: boolean;
  sources: Array<Record<string, unknown>>;
  meta: Record<string, unknown>;
  requestId: string;
  mode: 'test' | 'live';
  bundle?: { bundleId: string; remaining: number };
  includedPush?: { used: number; total: number; remaining: number };
}

/** Response from GET /v1/data/push/{requestId}. */
export interface DataPushResponse {
  requestId: string;
  tokenId: string;
  createdAt: string;
  data: Record<string, unknown>;
}

// ── Module ──────────────────────────────────────────────────────────

/**
 * Data access endpoints.
 *
 * @example
 * ```ts
 * // Tier-gated latest data (requires auth)
 * const latest = await client.data.getLatest();
 *
 * // Per-token data (x402 or bundle)
 * const btc = await client.data.getTokenData('BTC');
 *
 * // 72h snapshot (no auth, requestId is the bearer)
 * const snapshot = await client.data.getDataPush('2026-03-04T12-00-00-000Z-a1b2c3d4');
 * ```
 */
export class DataModule {
  /** @internal */
  constructor(private readonly _client: AttaGoClient) {}

  /**
   * Get latest market data for all tracked assets at the user's tier.
   *
   * Requires authentication (API key or Cognito JWT).
   * Returns tier-appropriate data bypassing the CDN cache.
   */
  async getLatest(): Promise<DataLatestResponse> {
    return this._client.request<DataLatestResponse>('GET', '/data/latest');
  }

  /**
   * Get derived scoring for a single token.
   *
   * Paid via x402, bundle deduction, or included monthly pushes.
   *
   * @param token — Token symbol (e.g. `"BTC"`).
   */
  async getTokenData(token: string): Promise<DataTokenResponse> {
    return this._client.request<DataTokenResponse>(
      'GET',
      `/api/data/${encodeURIComponent(token)}`,
    );
  }

  /**
   * Retrieve a 72-hour snapshot by request ID.
   *
   * No authentication needed — the requestId serves as a bearer token.
   *
   * @param requestId — Snapshot ID (from alert webhook or data-push response).
   */
  async getDataPush(requestId: string): Promise<DataPushResponse> {
    return this._client.request<DataPushResponse>(
      'GET',
      `/data/push/${encodeURIComponent(requestId)}`,
    );
  }
}
