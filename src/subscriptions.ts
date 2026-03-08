/**
 * Subscriptions module — alert configuration CRUD + catalog.
 *
 * - `catalog()` — available tokens, metrics, tier limits
 * - `list()` — user's active subscriptions
 * - `create(opts)` — create a new alert subscription
 * - `update(subId, opts)` — update an existing subscription
 * - `delete(subId)` — remove a subscription
 */

import type { AttaGoClient } from './index.js';

// ── Types ───────────────────────────────────────────────────────────

/** A single alert condition (metric + operator + threshold). */
export interface SubscriptionCondition {
  metricName: string;
  thresholdOp: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
  thresholdVal: number | string;
}

/** Subscription object returned by the API. */
export interface Subscription {
  userId: string;
  subId: string;
  tokenId: string;
  label: string;
  /** OR-of-ANDs: outer = OR groups, inner = AND conditions. */
  groups: SubscriptionCondition[][];
  cooldownMinutes: number;
  bucketHash: string;
  isActive: boolean;
  activeTokenShard?: string;
  createdAt: string;
  updatedAt: string;
}

/** Metric definition from the catalog. */
export interface CatalogMetric {
  label: string;
  type: 'number' | 'enum';
  unit?: string;
  operators: string[];
  min?: number;
  max?: number;
  values?: string[];
}

/** Catalog response — available tokens, metrics, and tier info. */
export interface CatalogResponse {
  tokens: string[];
  metrics: Record<string, CatalogMetric>;
  tier: string;
  maxSubscriptions: number;
  mode: string;
}

/** Options for creating a subscription (composite groups format). */
export interface CreateSubscriptionOptions {
  tokenId: string;
  label: string;
  /** OR-of-ANDs condition groups. */
  groups: SubscriptionCondition[][];
  /** Cooldown between alerts in minutes (0–1440). @defaultValue 5 */
  cooldownMinutes?: number;
}

/** Options for updating a subscription (all fields optional). */
export interface UpdateSubscriptionOptions {
  label?: string;
  groups?: SubscriptionCondition[][];
  cooldownMinutes?: number;
  isActive?: boolean;
}

// ── Module ──────────────────────────────────────────────────────────

export class SubscriptionsModule {
  /** @internal */
  constructor(private readonly _client: AttaGoClient) {}

  /**
   * Get the subscription catalog — available tokens, metrics, and tier limits.
   *
   * Free tier returns empty tokens/metrics.
   */
  async catalog(): Promise<CatalogResponse> {
    return this._client.request<CatalogResponse>(
      'GET',
      '/subscriptions/catalog',
    );
  }

  /**
   * List the user's active subscriptions.
   *
   * Excludes lifecycle-disabled subscriptions (tier_insufficient, token_delisted).
   */
  async list(): Promise<Subscription[]> {
    const res = await this._client.request<{ subscriptions: Subscription[] }>(
      'GET',
      '/user/subscriptions',
    );
    return res.subscriptions;
  }

  /**
   * Create a new alert subscription.
   *
   * @param options — Token, label, condition groups, and cooldown.
   * @throws {ApiError} 400 if validation fails (contradictory conditions, etc.)
   * @throws {ApiError} 403 if tier limit reached or free tier.
   * @throws {ApiError} 409 if duplicate subscription for same token.
   */
  async create(options: CreateSubscriptionOptions): Promise<Subscription> {
    return this._client.request<Subscription>(
      'POST',
      '/user/subscriptions',
      {
        body: {
          tokenId: options.tokenId,
          label: options.label,
          groups: options.groups,
          cooldownMinutes: options.cooldownMinutes ?? 5,
        },
      },
    );
  }

  /**
   * Update an existing subscription.
   *
   * @param subId — Subscription UUID.
   * @param options — Fields to update (all optional).
   */
  async update(
    subId: string,
    options: UpdateSubscriptionOptions,
  ): Promise<Subscription> {
    return this._client.request<Subscription>(
      'PUT',
      `/user/subscriptions/${encodeURIComponent(subId)}`,
      { body: options },
    );
  }

  /**
   * Delete a subscription.
   *
   * @param subId — Subscription UUID.
   */
  async delete(subId: string): Promise<void> {
    await this._client.request(
      'DELETE',
      `/user/subscriptions/${encodeURIComponent(subId)}`,
    );
  }
}
