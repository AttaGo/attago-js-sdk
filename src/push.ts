/**
 * Push module — Web Push notification subscription management.
 *
 * Push subscriptions enable browser-based alert delivery via the Web Push protocol.
 * Subscriptions auto-expire after 90 days (DynamoDB TTL).
 *
 * - `list()` — list registered push subscriptions
 * - `create(opts)` — register a push subscription
 * - `delete(subscriptionId)` — remove a push subscription
 */

import type { AttaGoClient } from './index.js';

// ── Types ───────────────────────────────────────────────────────────

/** Web Push subscription keys (from PushSubscription.getKey()). */
export interface PushKeys {
  /** P-256 ECDH public key, base64url-encoded. */
  p256dh: string;
  /** Auth secret, base64url-encoded. */
  auth: string;
}

/** Options for creating a push subscription. */
export interface CreatePushOptions {
  /** Push endpoint URL (from PushSubscription.endpoint). */
  endpoint: string;
  /** Encryption keys for the subscription. */
  keys: PushKeys;
}

/** Push subscription returned by the API. */
export interface PushSubscription {
  subscriptionId: string;
  endpoint: string;
  createdAt: string;
}

// ── Module ──────────────────────────────────────────────────────────

export class PushModule {
  /** @internal */
  constructor(private readonly _client: AttaGoClient) {}

  /**
   * List registered push subscriptions.
   *
   * Tier limits: Basic=3, Pro=5, Business=10. Free=0.
   */
  async list(): Promise<PushSubscription[]> {
    const res = await this._client.request<{ items: PushSubscription[] }>(
      'GET',
      '/user/push-subscriptions',
    );
    return res.items;
  }

  /**
   * Register a Web Push subscription.
   *
   * Re-registering the same endpoint is idempotent (upsert).
   * The subscriptionId is a deterministic SHA-256 hash of the endpoint.
   *
   * @throws {ApiError} 403 if tier limit reached or free tier.
   */
  async create(options: CreatePushOptions): Promise<PushSubscription> {
    return this._client.request<PushSubscription>(
      'POST',
      '/user/push-subscriptions',
      { body: options },
    );
  }

  /**
   * Remove a push subscription.
   *
   * @param subscriptionId — Deterministic subscription ID.
   */
  async delete(subscriptionId: string): Promise<void> {
    await this._client.request(
      'DELETE',
      `/user/push-subscriptions/${encodeURIComponent(subscriptionId)}`,
    );
  }
}
