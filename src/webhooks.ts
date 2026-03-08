/**
 * Webhooks module — CRUD + test delivery.
 *
 * - `create(url)` — register a new webhook endpoint (Pro+ tier)
 * - `list()` — list registered webhooks (secrets stripped)
 * - `delete(webhookId)` — remove a webhook
 * - `sendTest(opts)` — client-side test delivery (HMAC-sign + POST + retry)
 * - `sendServerTest(webhookId)` — trigger server-side test delivery
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AttaGoClient } from './index.js';

// ── Response types ──────────────────────────────────────────────────

/** Webhook returned on creation (includes secret — shown only once). */
export interface WebhookCreateResponse {
  webhookId: string;
  url: string;
  secret: string;
  createdAt: string;
}

/** Webhook returned on list (secret stripped). */
export interface WebhookListItem {
  webhookId: string;
  url: string;
  createdAt: string;
}

/** Result of a test delivery (SDK-side or server-side). */
export interface WebhookTestResult {
  success: boolean;
  statusCode: number | null;
  attempts: number;
  error?: string;
}

/** Options for SDK-side test delivery. */
export interface SendTestOptions {
  /** Webhook endpoint URL. */
  url: string;
  /** HMAC signing secret (from webhook creation response). */
  secret: string;
  /** Token symbol for the test payload. @defaultValue `"BTC"` */
  token?: string;
  /** Alert state. @defaultValue `"triggered"` */
  state?: 'triggered' | 'resolved';
  /** Environment label. @defaultValue `"production"` */
  environment?: string;
  /** Custom fetch for testing. Uses global fetch if omitted. */
  fetch?: typeof globalThis.fetch;
  /** @internal Backoff delays for retry (ms). Override in tests. */
  _backoffMs?: number[];
}

// ── v2 test payload builder ─────────────────────────────────────────

/** Build a v2 test webhook payload. */
export function buildTestPayload(options: {
  token?: string;
  state?: 'triggered' | 'resolved';
  environment?: string;
  domain?: string;
}): Record<string, unknown> {
  const now = new Date().toISOString();
  const domain = options.domain ?? 'attago.bid';
  return {
    event: 'test',
    version: '2',
    environment: options.environment ?? 'production',
    alert: {
      id: 'test',
      label: 'Test webhook delivery',
      token: options.token ?? 'BTC',
      state: options.state ?? 'triggered',
    },
    data: {
      url: null,
      expiresAt: new Date(Date.now() + 72 * 3600_000).toISOString(),
      fallbackUrl: `https://${domain}/data/latest.json`,
    },
    timestamp: now,
  };
}

/** HMAC-SHA256 sign a payload with the given secret. Returns hex digest. */
export function signPayload(
  payload: Record<string, unknown>,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
}

/**
 * Verify an incoming webhook signature (timing-safe comparison).
 * Useful for webhook receivers to validate authenticity.
 */
export function verifySignature(
  rawBody: string | Buffer,
  secret: string,
  signature: string,
): boolean {
  const expected = createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// ── Retry logic ─────────────────────────────────────────────────────

const BACKOFF_MS = [1000, 4000, 16000];
const REQUEST_TIMEOUT_MS = 5000;

/**
 * Deliver a signed payload to a URL with retry + backoff.
 * Same retry strategy as the production AttaGo backend.
 */
async function deliverWithRetry(
  fetchFn: typeof globalThis.fetch,
  url: string,
  body: string,
  headers: Record<string, string>,
  backoffMs: number[] = BACKOFF_MS,
): Promise<WebhookTestResult> {
  let lastStatusCode: number | null = null;
  let lastError: string | null = null;

  for (let attempt = 0; attempt < backoffMs.length + 1; attempt++) {
    if (attempt > 0) {
      await sleep(backoffMs[attempt - 1]!);
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS,
      );

      const res = await fetchFn(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);
      lastStatusCode = res.status;

      if (res.status >= 200 && res.status < 300) {
        return { success: true, statusCode: res.status, attempts: attempt + 1 };
      }

      // 4xx (except 429) = permanent failure, no retry
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        return {
          success: false,
          statusCode: res.status,
          attempts: attempt + 1,
          error: `HTTP ${res.status}`,
        };
      }

      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError =
        err instanceof Error
          ? err.name === 'AbortError'
            ? 'timeout'
            : err.message
          : 'Unknown error';
    }
  }

  return {
    success: false,
    statusCode: lastStatusCode,
    attempts: backoffMs.length + 1,
    error: lastError ?? 'Delivery failed',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Module ──────────────────────────────────────────────────────────

/**
 * Webhook management + test delivery.
 *
 * @example
 * ```ts
 * // Register a webhook
 * const hook = await client.webhooks.create('https://example.com/hook');
 * console.log(hook.secret); // save this — shown only once!
 *
 * // Test it locally (SDK-side)
 * const result = await client.webhooks.sendTest({
 *   url: hook.url,
 *   secret: hook.secret,
 * });
 * console.log(result.success); // true if receiver responded 2xx
 *
 * // Test it via the server (production pipeline)
 * const serverResult = await client.webhooks.sendServerTest(hook.webhookId);
 * ```
 */
export class WebhooksModule {
  /** @internal */
  constructor(
    private readonly _client: AttaGoClient,
    private readonly _fetch: typeof globalThis.fetch,
  ) {}

  /**
   * Register a new webhook URL.
   *
   * Requires Pro+ tier. The `secret` in the response is shown **only once**.
   *
   * @param url — HTTPS endpoint URL for webhook delivery.
   */
  async create(url: string): Promise<WebhookCreateResponse> {
    return this._client.request<WebhookCreateResponse>(
      'POST',
      '/user/webhooks',
      { body: { url } },
    );
  }

  /**
   * List registered webhooks (secrets stripped).
   */
  async list(): Promise<WebhookListItem[]> {
    const res = await this._client.request<{ items: WebhookListItem[] }>(
      'GET',
      '/user/webhooks',
    );
    return res.items;
  }

  /**
   * Delete a webhook by ID.
   *
   * @param webhookId — UUID of the webhook to remove.
   */
  async delete(webhookId: string): Promise<void> {
    await this._client.request(
      'DELETE',
      `/user/webhooks/${encodeURIComponent(webhookId)}`,
    );
  }

  /**
   * Send a test webhook from the client machine.
   *
   * Builds a v2 test payload (`event: "test"`), HMAC-signs it, and POSTs
   * to the given URL with retry. No server involvement — runs entirely
   * client-side. Perfect for local dev and CI.
   *
   * @returns Delivery result with success/failure, status code, and attempts.
   */
  async sendTest(options: SendTestOptions): Promise<WebhookTestResult> {
    const payload = buildTestPayload({
      token: options.token,
      state: options.state,
      environment: options.environment,
    });

    const body = JSON.stringify(payload);
    const signature = signPayload(payload, options.secret);
    const fetchFn = options.fetch ?? this._fetch;

    return deliverWithRetry(fetchFn, options.url, body, {
      'Content-Type': 'application/json',
      'X-AttaGo-Signature': signature,
      'X-AttaGo-Event': 'test',
      'User-Agent': 'AttaGo-Webhook/1.0',
    }, options._backoffMs);
  }

  /**
   * Trigger a server-side test delivery for a registered webhook.
   *
   * The AttaGo backend looks up the webhook, builds a test payload,
   * signs it with the stored secret, and delivers through the production
   * pipeline. Returns the delivery result.
   *
   * Requires Pro+ tier.
   *
   * @param webhookId — UUID of the registered webhook.
   */
  async sendServerTest(webhookId: string): Promise<WebhookTestResult> {
    return this._client.request<WebhookTestResult>(
      'POST',
      `/user/webhooks/${encodeURIComponent(webhookId)}/test`,
    );
  }
}
