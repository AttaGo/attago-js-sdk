/**
 * Redeem module — redemption code activation.
 *
 * Redemption codes grant tier access without payment (promotional, partnerships, etc.).
 *
 * - `redeem(code)` — activate a redemption code
 */

import type { AttaGoClient } from './index.js';

// ── Types ───────────────────────────────────────────────────────────

/** Response from a successful code redemption. */
export interface RedeemResponse {
  tier: string;
  expiresAt: string;
  message: string;
}

// ── Module ──────────────────────────────────────────────────────────

export class RedeemModule {
  /** @internal */
  constructor(private readonly _client: AttaGoClient) {}

  /**
   * Activate a redemption code.
   *
   * Grants tier access for the duration specified in the code.
   * Each code can only be used once.
   *
   * @param code — The redemption code string.
   * @throws {ApiError} 400 if code is invalid or already used.
   * @throws {ApiError} 404 if code not found.
   */
  async redeem(code: string): Promise<RedeemResponse> {
    return this._client.request<RedeemResponse>(
      'POST',
      '/user/redeem',
      { body: { code } },
    );
  }
}
