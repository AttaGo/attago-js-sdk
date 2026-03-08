/**
 * Wallets module — verified wallet management.
 *
 * Wallets are required for subscriptions, bundles, and refunds.
 *
 * - `register(opts)` — register + verify a wallet (challenge-response)
 * - `list()` — list verified wallets
 * - `remove(address)` — unregister a wallet
 */

import type { AttaGoClient } from './index.js';

// ── Types ───────────────────────────────────────────────────────────

/** Supported blockchain networks. */
export type WalletChain =
  | 'base'
  | 'avax'
  | 'polygon'
  | 'arbitrum'
  | 'optimism'
  | 'solana';

/** Options for registering a wallet. */
export interface RegisterWalletOptions {
  walletAddress: string;
  chain: WalletChain;
  /** Signature of the challenge message. */
  signature: string;
  /** Unix timestamp (seconds) used in the challenge. */
  timestamp: number;
}

/** Verified wallet returned by the API. */
export interface Wallet {
  userId: string;
  walletAddress: string;
  chain: string;
  verifiedAt: string;
}

// ── Module ──────────────────────────────────────────────────────────

export class WalletsModule {
  /** @internal */
  constructor(private readonly _client: AttaGoClient) {}

  /**
   * Register and verify a wallet via challenge-response.
   *
   * The client must sign a challenge message before calling this:
   * ```
   * AttaGo wallet verification
   * User: {userId}
   * Timestamp: {unix_seconds}
   * ```
   *
   * The challenge expires after 5 minutes.
   *
   * @throws {ApiError} 400 if signature invalid or challenge expired.
   * @throws {ApiError} 409 if wallet already registered.
   */
  async register(options: RegisterWalletOptions): Promise<Wallet> {
    return this._client.request<Wallet>(
      'POST',
      '/payments/wallet',
      { body: options },
    );
  }

  /**
   * List all verified wallets for the current user.
   */
  async list(): Promise<Wallet[]> {
    const res = await this._client.request<{ wallets: Wallet[] }>(
      'GET',
      '/payments/wallets',
    );
    return res.wallets;
  }

  /**
   * Remove a verified wallet.
   *
   * @param address — The wallet address to remove.
   */
  async remove(address: string): Promise<void> {
    await this._client.request(
      'DELETE',
      `/payments/wallet/${encodeURIComponent(address)}`,
    );
  }
}
