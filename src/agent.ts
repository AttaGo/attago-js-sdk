/**
 * Agent module — `/v1/agent/score` and `/v1/agent/data`.
 *
 * These endpoints are x402-gated (no Cognito auth). When the client
 * has an API key, it's sent as `X-API-Key`. When the client has an
 * x402 signer, payment is handled transparently via the x402 module.
 */

import type { AttaGoClient } from './index.js';

// ── Response types (minimal for now — expanded in Task 2.7) ────────

/** Composite score summary. */
export interface CompositeScore {
  score: number;
  signal: 'GO' | 'NO-GO' | 'NEUTRAL';
  confidence: number;
}

/** Single-asset score response from GET /v1/agent/score. */
export interface AgentScoreResponse {
  token: string;
  composite: CompositeScore;
  spot: Record<string, unknown>;
  perps: Record<string, unknown> | null;
  context: Record<string, unknown>;
  market: Record<string, unknown>;
  derivSymbols: string[];
  hasDerivatives: boolean;
  sources: Array<Record<string, unknown>>;
  meta: Record<string, unknown>;
  requestId?: string;
}

/** Multi-asset data response from GET /v1/agent/data. */
export interface AgentDataResponse {
  assets: Record<string, Record<string, unknown>>;
  assetOrder: string[];
  market: Record<string, unknown>;
  sources: Array<Record<string, unknown>>;
  meta: Record<string, unknown>;
  requestId?: string;
}

// ── Module ──────────────────────────────────────────────────────────

/**
 * Agent endpoints — Go/No-Go scores and full market data.
 *
 * @example
 * ```ts
 * const score = await client.agent.getScore('BTC');
 * console.log(score.composite.signal); // 'GO' | 'NO-GO' | 'NEUTRAL'
 * ```
 */
export class AgentModule {
  /** @internal */
  constructor(private readonly _client: AttaGoClient) {}

  /**
   * Get the Go/No-Go score for a single asset.
   *
   * @param symbol — Token symbol (e.g. `"BTC"`, `"ETH"`).
   * @returns Derived scoring with composite, spot, perps, context, and market.
   */
  async getScore(symbol: string): Promise<AgentScoreResponse> {
    return this._client.request<AgentScoreResponse>('GET', '/agent/score', {
      query: { symbol },
    });
  }

  /**
   * Get full market data for all tracked assets.
   *
   * @param symbols — Optional array of symbols to filter. Omit for all.
   * @returns Multi-asset scoring keyed by symbol.
   */
  async getData(symbols?: string[]): Promise<AgentDataResponse> {
    return this._client.request<AgentDataResponse>('GET', '/agent/data', {
      query: symbols?.length ? { symbols: symbols.join(',') } : {},
    });
  }
}
