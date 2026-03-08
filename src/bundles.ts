/**
 * Bundles module — prepaid data-push credit bundles.
 *
 * Bundles are one-off credit purchases that never expire.
 * Consumption order: included monthly pushes → bundles (FIFO) → per-request x402.
 *
 * - `list()` — list purchased bundles + catalog
 * - `purchase(opts)` — buy a bundle (triggers x402 payment in live mode)
 */

import type { AttaGoClient } from './index.js';

// ── Types ───────────────────────────────────────────────────────────

/** A purchased bundle. */
export interface Bundle {
  bundleId: string;
  userId: string;
  walletAddress: string;
  bundleSize: number;
  remaining: number;
  purchasedAt: string;
  expiresAt: string | null;
}

/** Bundle catalog entry showing available packages. */
export interface BundleCatalogEntry {
  name: string;
  pushes: number;
  price: number;
}

/** Response from listing bundles — includes user's bundles and available catalog. */
export interface BundleListResponse {
  bundles: Bundle[];
  catalog: BundleCatalogEntry[];
  perRequestPrice: number;
}

/** Options for purchasing a bundle. */
export interface PurchaseBundleOptions {
  /**
   * Index into the bundle catalog:
   * - 0 = $5 (60 pushes)
   * - 1 = $25 (350 pushes)
   * - 2 = $50 (800 pushes)
   */
  bundleIndex: number;
  /** Wallet address for the purchase. Must be a registered wallet. */
  walletAddress: string;
}

/** Response from a successful bundle purchase. */
export interface BundlePurchaseResponse {
  bundleId: string;
  userId: string;
  walletAddress: string;
  bundleName: string;
  totalPushes: number;
  remaining: number;
  price: number;
  purchasedAt: string;
  payer: string;
  transactionId: string;
}

// ── Module ──────────────────────────────────────────────────────────

export class BundlesModule {
  /** @internal */
  constructor(private readonly _client: AttaGoClient) {}

  /**
   * List purchased bundles and the available catalog.
   *
   * Returns both the user's existing bundles (with remaining credits)
   * and the catalog of available bundle packages.
   */
  async list(): Promise<BundleListResponse> {
    return this._client.request<BundleListResponse>(
      'GET',
      '/api/bundles',
    );
  }

  /**
   * Purchase a data-push credit bundle.
   *
   * In live mode, triggers a 402 x402 payment flow.
   * Requires Pro+ tier and at least one registered wallet.
   *
   * @throws {PaymentRequiredError} 402 when payment is needed.
   * @throws {ApiError} 400 if invalid bundleIndex or no wallet registered.
   * @throws {ApiError} 403 if tier does not have API access.
   * @throws {ApiError} 409 if duplicate payment (replay protection).
   */
  async purchase(
    options: PurchaseBundleOptions,
  ): Promise<BundlePurchaseResponse> {
    return this._client.request<BundlePurchaseResponse>(
      'POST',
      '/api/bundles',
      { body: options },
    );
  }
}
