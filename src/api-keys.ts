/**
 * API Keys module — programmatic access key management.
 *
 * API keys are an alternative to Cognito JWT for authenticating SDK requests.
 * Key creation requires Cognito JWT (bootstrap), subsequent operations accept
 * either JWT or API key.
 *
 * - `create(name)` — create a new API key (JWT only)
 * - `list()` — list API keys (active + revoked)
 * - `revoke(keyId)` — soft-revoke an API key
 */

import type { AttaGoClient } from './index.js';

// ── Types ───────────────────────────────────────────────────────────

/** API key returned on creation (includes raw key — shown only once). */
export interface ApiKeyCreateResponse {
  keyId: string;
  name: string;
  prefix: string;
  /** Full raw API key. Shown **only on creation** — save immediately. */
  key: string;
  createdAt: string;
}

/** API key in a list response (raw key never shown). */
export interface ApiKeyListItem {
  keyId: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

// ── Module ──────────────────────────────────────────────────────────

export class ApiKeysModule {
  /** @internal */
  constructor(private readonly _client: AttaGoClient) {}

  /**
   * Create a new API key.
   *
   * **Requires Cognito JWT authentication** — API keys cannot create other
   * API keys. This is the bootstrap endpoint.
   *
   * Max 5 keys per user. Requires Basic+ tier.
   * The raw key is shown **only once** in the response — save it immediately.
   *
   * @param name — A label for the key (e.g., `"my-trading-bot"`).
   * @throws {ApiError} 403 if free tier or key limit reached.
   */
  async create(name: string): Promise<ApiKeyCreateResponse> {
    return this._client.request<ApiKeyCreateResponse>(
      'POST',
      '/user/api-keys',
      { body: { name } },
    );
  }

  /**
   * List all API keys (active and revoked, for audit trail).
   *
   * Raw keys and hashes are never exposed.
   */
  async list(): Promise<ApiKeyListItem[]> {
    const res = await this._client.request<{ items: ApiKeyListItem[] }>(
      'GET',
      '/user/api-keys',
    );
    return res.items;
  }

  /**
   * Soft-revoke an API key. The key immediately stops working.
   *
   * This is irreversible. The key remains visible in the list for audit.
   *
   * @param keyId — UUID of the key to revoke.
   */
  async revoke(keyId: string): Promise<void> {
    await this._client.request(
      'DELETE',
      `/user/api-keys/${encodeURIComponent(keyId)}`,
    );
  }
}
