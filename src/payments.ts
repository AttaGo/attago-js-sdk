/**
 * Payments module — subscription billing, upgrade quotes, and billing status.
 *
 * - `subscribe(opts)` — purchase or activate a subscription tier
 * - `status()` — current billing status, tier, and push usage
 * - `upgradeQuote(opts)` — get a pro-rated upgrade price quote
 */

import type { AttaGoClient } from './index.js';

// ── Types ───────────────────────────────────────────────────────────

/** Billing tier names. */
export type BillingTier = 'basic' | 'pro' | 'business';

/** Billing cycle options. */
export type BillingCycle = 'monthly' | 'yearly';

/** Options for subscribing to a tier. */
export interface SubscribeOptions {
  tier: BillingTier;
  billingCycle: BillingCycle;
  /** Whether to auto-renew. @defaultValue false */
  renew?: boolean;
}

/** Response from a successful subscription. */
export interface SubscribeResponse {
  tier: string;
  billingCycle: string;
  price: number;
  currency: string;
  expiresAt: string;
  payer: string;
  mode: string;
  message: string;
}

/** Included push usage within the billing period. */
export interface IncludedPushes {
  total: number;
  used: number;
  remaining: number;
  periodStart: string;
  periodEnd: string;
}

/** Current billing status. */
export interface BillingStatus {
  tier: string;
  tierName: string;
  billingCycle: string;
  expiresAt: string | null;
  maxSubs: number;
  apiAccess: boolean;
  freeDataPushes: number;
  mode: string;
  includedPushes?: IncludedPushes;
}

/** Pro-rated upgrade price quote. */
export interface UpgradeQuote {
  currentTier: string;
  currentCycle: string;
  currentExpiresAt: string;
  targetTier: string;
  targetCycle: string;
  basePrice: number;
  prorationCredit: number;
  finalPrice: number;
  currency: string;
  expiresAt: string;
}

// ── Module ──────────────────────────────────────────────────────────

export class PaymentsModule {
  /** @internal */
  constructor(private readonly _client: AttaGoClient) {}

  /**
   * Subscribe to a billing tier.
   *
   * In live mode, triggers a 402 x402 payment flow — the SDK auto-handles
   * this if a signer is configured, or throws `PaymentRequiredError` for
   * API-key-only clients to handle externally.
   *
   * Requires at least one registered wallet.
   *
   * @throws {PaymentRequiredError} 402 when payment is needed.
   * @throws {ApiError} 400 if no wallet registered or invalid tier/cycle.
   * @throws {ApiError} 409 if duplicate payment (replay protection).
   */
  async subscribe(options: SubscribeOptions): Promise<SubscribeResponse> {
    return this._client.request<SubscribeResponse>(
      'POST',
      '/payments/subscribe',
      {
        body: {
          tier: options.tier,
          billingCycle: options.billingCycle,
          renew: options.renew ?? false,
        },
      },
    );
  }

  /**
   * Get current billing status — tier, expiry, push usage, etc.
   */
  async status(): Promise<BillingStatus> {
    return this._client.request<BillingStatus>(
      'GET',
      '/payments/status',
    );
  }

  /**
   * Get a pro-rated upgrade quote.
   *
   * Shows the credit from the current subscription applied toward
   * the new tier price.
   *
   * @param tier — Target tier to upgrade to.
   * @param cycle — Target billing cycle.
   */
  async upgradeQuote(
    tier: BillingTier,
    cycle: BillingCycle,
  ): Promise<UpgradeQuote> {
    return this._client.request<UpgradeQuote>(
      'GET',
      '/payments/upgrade-quote',
      { query: { tier, cycle } },
    );
  }
}
