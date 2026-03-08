import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { AttaGoClient } from '../../src/index.js';
import {
  buildTestPayload,
  signPayload,
  verifySignature,
} from '../../src/webhooks.js';

// ── Helpers ─────────────────────────────────────────────────────────

interface FetchCall {
  url: string;
  init: RequestInit;
}

function mockFetch(status: number, body: unknown) {
  const calls: FetchCall[] = [];
  const fn = async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ url: url.toString(), init: init ?? {} });
    // 204 No Content — null body status per Fetch spec
    if (status === 204) {
      return new Response(null, { status });
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fn: fn as typeof globalThis.fetch, calls };
}

/** Build a mock fetch that returns different responses per call. */
function mockFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  const calls: FetchCall[] = [];
  let callIndex = 0;
  const fn = async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ url: url.toString(), init: init ?? {} });
    const resp = responses[callIndex] ?? responses[responses.length - 1]!;
    callIndex++;
    return new Response(JSON.stringify(resp.body), {
      status: resp.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fn: fn as typeof globalThis.fetch, calls };
}

const WEBHOOK_SECRET = 'test-secret-uuid-1234';

// ── Tests ───────────────────────────────────────────────────────────

describe('WebhooksModule', () => {
  describe('CRUD', () => {
    it('should POST /v1/user/webhooks to create', async () => {
      const response = {
        webhookId: 'wh-123',
        url: 'https://example.com/hook',
        secret: 'sec-abc',
        createdAt: '2026-03-08T00:00:00Z',
      };
      const { fn, calls } = mockFetch(200, response);
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      const result = await client.webhooks.create('https://example.com/hook');

      assert.equal(calls.length, 1);
      assert.ok(calls[0]!.url.includes('/v1/user/webhooks'));
      assert.equal(calls[0]!.init.method, 'POST');
      const body = JSON.parse(calls[0]!.init.body as string);
      assert.equal(body.url, 'https://example.com/hook');
      assert.equal(result.webhookId, 'wh-123');
      assert.equal(result.secret, 'sec-abc');
    });

    it('should GET /v1/user/webhooks to list', async () => {
      const response = {
        items: [
          { webhookId: 'wh-1', url: 'https://a.com/hook', createdAt: '2026-01-01T00:00:00Z' },
          { webhookId: 'wh-2', url: 'https://b.com/hook', createdAt: '2026-02-01T00:00:00Z' },
        ],
      };
      const { fn, calls } = mockFetch(200, response);
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      const result = await client.webhooks.list();

      assert.ok(calls[0]!.url.includes('/v1/user/webhooks'));
      assert.equal(calls[0]!.init.method, 'GET');
      assert.equal(result.length, 2);
      assert.equal(result[0]!.webhookId, 'wh-1');
    });

    it('should DELETE /v1/user/webhooks/{id}', async () => {
      const { fn, calls } = mockFetch(204, null);
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      await client.webhooks.delete('wh-123');

      assert.ok(calls[0]!.url.includes('/v1/user/webhooks/wh-123'));
      assert.equal(calls[0]!.init.method, 'DELETE');
    });

    it('should URL-encode webhook IDs with special characters', async () => {
      const { fn, calls } = mockFetch(204, null);
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      await client.webhooks.delete('wh/special&id');

      assert.ok(calls[0]!.url.includes('wh%2Fspecial%26id'));
    });
  });

  describe('sendServerTest', () => {
    it('should POST /v1/user/webhooks/{id}/test', async () => {
      const response = { success: true, statusCode: 200, attempts: 1 };
      const { fn, calls } = mockFetch(200, response);
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      const result = await client.webhooks.sendServerTest('wh-456');

      assert.ok(calls[0]!.url.includes('/v1/user/webhooks/wh-456/test'));
      assert.equal(calls[0]!.init.method, 'POST');
      assert.equal(result.success, true);
      assert.equal(result.statusCode, 200);
      assert.equal(result.attempts, 1);
    });

    it('should return failure result from server', async () => {
      const response = {
        success: false,
        statusCode: 502,
        attempts: 4,
        error: 'HTTP 502',
      };
      const { fn } = mockFetch(200, response);
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      const result = await client.webhooks.sendServerTest('wh-789');

      assert.equal(result.success, false);
      assert.equal(result.statusCode, 502);
      assert.equal(result.attempts, 4);
      assert.equal(result.error, 'HTTP 502');
    });
  });
});

describe('buildTestPayload', () => {
  it('should produce a v2 test payload with defaults', () => {
    const payload = buildTestPayload({});

    assert.equal(payload.event, 'test');
    assert.equal(payload.version, '2');
    assert.equal(payload.environment, 'production');

    const alert = payload.alert as Record<string, unknown>;
    assert.equal(alert.id, 'test');
    assert.equal(alert.label, 'Test webhook delivery');
    assert.equal(alert.token, 'BTC');
    assert.equal(alert.state, 'triggered');

    const data = payload.data as Record<string, unknown>;
    assert.equal(data.url, null);
    assert.ok(typeof data.expiresAt === 'string');
    assert.ok((data.fallbackUrl as string).includes('attago.bid'));
    assert.ok(typeof payload.timestamp === 'string');
  });

  it('should allow overriding token, state, and environment', () => {
    const payload = buildTestPayload({
      token: 'ETH',
      state: 'resolved',
      environment: 'staging',
    });

    assert.equal(payload.environment, 'staging');
    const alert = payload.alert as Record<string, unknown>;
    assert.equal(alert.token, 'ETH');
    assert.equal(alert.state, 'resolved');
  });

  it('should allow overriding domain for fallback URL', () => {
    const payload = buildTestPayload({ domain: 'staging.attago.io' });

    const data = payload.data as Record<string, unknown>;
    assert.ok((data.fallbackUrl as string).includes('staging.attago.io'));
  });

  it('should set expiresAt ~72 hours in the future', () => {
    const before = Date.now();
    const payload = buildTestPayload({});
    const after = Date.now();

    const data = payload.data as Record<string, unknown>;
    const expiresAt = new Date(data.expiresAt as string).getTime();
    const hours72 = 72 * 3600_000;

    // expiresAt should be ~72h from now (within 2s tolerance)
    assert.ok(expiresAt >= before + hours72 - 2000);
    assert.ok(expiresAt <= after + hours72 + 2000);
  });
});

describe('signPayload', () => {
  it('should produce HMAC-SHA256 hex digest', () => {
    const payload = { event: 'test', version: '2' };
    const sig = signPayload(payload, WEBHOOK_SECRET);

    // Verify manually
    const expected = createHmac('sha256', WEBHOOK_SECRET)
      .update(JSON.stringify(payload))
      .digest('hex');
    assert.equal(sig, expected);
    assert.equal(sig.length, 64); // 256-bit = 32 bytes = 64 hex chars
  });

  it('should produce different signatures for different payloads', () => {
    const sig1 = signPayload({ event: 'test' }, WEBHOOK_SECRET);
    const sig2 = signPayload({ event: 'alert' }, WEBHOOK_SECRET);
    assert.notEqual(sig1, sig2);
  });

  it('should produce different signatures for different secrets', () => {
    const payload = { event: 'test' };
    const sig1 = signPayload(payload, 'secret-a');
    const sig2 = signPayload(payload, 'secret-b');
    assert.notEqual(sig1, sig2);
  });
});

describe('verifySignature', () => {
  it('should return true for a valid signature', () => {
    const body = JSON.stringify({ event: 'test', version: '2' });
    const sig = createHmac('sha256', WEBHOOK_SECRET)
      .update(body)
      .digest('hex');

    assert.equal(verifySignature(body, WEBHOOK_SECRET, sig), true);
  });

  it('should return false for an invalid signature', () => {
    const body = JSON.stringify({ event: 'test' });
    assert.equal(
      verifySignature(body, WEBHOOK_SECRET, 'a'.repeat(64)),
      false,
    );
  });

  it('should return false for wrong secret', () => {
    const body = JSON.stringify({ event: 'test' });
    const sig = createHmac('sha256', WEBHOOK_SECRET)
      .update(body)
      .digest('hex');

    assert.equal(verifySignature(body, 'wrong-secret', sig), false);
  });

  it('should return false for mismatched length', () => {
    const body = JSON.stringify({ event: 'test' });
    assert.equal(verifySignature(body, WEBHOOK_SECRET, 'short'), false);
  });

  it('should accept Buffer input', () => {
    const body = Buffer.from(JSON.stringify({ event: 'test' }));
    const sig = createHmac('sha256', WEBHOOK_SECRET)
      .update(body)
      .digest('hex');

    assert.equal(verifySignature(body, WEBHOOK_SECRET, sig), true);
  });
});

describe('sendTest (SDK-side delivery)', () => {
  it('should deliver with correct headers on success', async () => {
    const { fn: receiverFn, calls: receiverCalls } = mockFetch(200, { ok: true });

    // Use a separate mock for the client (not used by sendTest)
    const { fn: clientFn } = mockFetch(200, {});
    const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: clientFn });

    const result = await client.webhooks.sendTest({
      url: 'https://example.com/hook',
      secret: WEBHOOK_SECRET,
      fetch: receiverFn,
    });

    assert.equal(result.success, true);
    assert.equal(result.statusCode, 200);
    assert.equal(result.attempts, 1);

    // Verify request sent to receiver
    assert.equal(receiverCalls.length, 1);
    assert.equal(receiverCalls[0]!.url, 'https://example.com/hook');

    const headers = receiverCalls[0]!.init.headers as Record<string, string>;
    assert.equal(headers['Content-Type'], 'application/json');
    assert.equal(headers['X-AttaGo-Event'], 'test');
    assert.equal(headers['User-Agent'], 'AttaGo-Webhook/1.0');
    assert.ok(headers['X-AttaGo-Signature']);
    assert.equal(headers['X-AttaGo-Signature']!.length, 64);
  });

  it('should produce a valid HMAC signature', async () => {
    let capturedBody: string | undefined;
    let capturedSignature: string | undefined;

    const receiverFn = async (
      _url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      capturedBody = init?.body as string;
      const h = init?.headers as Record<string, string>;
      capturedSignature = h['X-AttaGo-Signature'];
      return new Response('{}', { status: 200 });
    };

    const { fn: clientFn } = mockFetch(200, {});
    const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: clientFn });

    await client.webhooks.sendTest({
      url: 'https://example.com/hook',
      secret: WEBHOOK_SECRET,
      fetch: receiverFn as typeof globalThis.fetch,
    });

    // Verify the signature matches the body
    assert.ok(capturedBody);
    assert.ok(capturedSignature);
    const expected = createHmac('sha256', WEBHOOK_SECRET)
      .update(capturedBody!)
      .digest('hex');
    assert.equal(capturedSignature, expected);
  });

  it('should include configurable token and state in payload', async () => {
    let capturedBody: string | undefined;
    const receiverFn = async (
      _url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      capturedBody = init?.body as string;
      return new Response('{}', { status: 200 });
    };

    const { fn: clientFn } = mockFetch(200, {});
    const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: clientFn });

    await client.webhooks.sendTest({
      url: 'https://example.com/hook',
      secret: WEBHOOK_SECRET,
      token: 'ETH',
      state: 'resolved',
      environment: 'staging',
      fetch: receiverFn as typeof globalThis.fetch,
    });

    const payload = JSON.parse(capturedBody!);
    assert.equal(payload.event, 'test');
    assert.equal(payload.alert.token, 'ETH');
    assert.equal(payload.alert.state, 'resolved');
    assert.equal(payload.environment, 'staging');
  });

  it('should return failure on 4xx (no retry)', async () => {
    const { fn: receiverFn, calls } = mockFetch(403, { error: 'Forbidden' });
    const { fn: clientFn } = mockFetch(200, {});
    const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: clientFn });

    const result = await client.webhooks.sendTest({
      url: 'https://example.com/hook',
      secret: WEBHOOK_SECRET,
      fetch: receiverFn,
      _backoffMs: [0, 0, 0],
    });

    assert.equal(result.success, false);
    assert.equal(result.statusCode, 403);
    assert.equal(result.attempts, 1); // No retry for 4xx
    assert.equal(result.error, 'HTTP 403');
    assert.equal(calls.length, 1);
  });

  it('should return failure with attempts on 5xx after retries', async () => {
    // All attempts return 500 — should exhaust retries
    const calls: Array<{ url: string }> = [];
    const receiverFn = async (
      url: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => {
      calls.push({ url: url.toString() });
      return new Response('{}', { status: 500 });
    };

    const { fn: clientFn } = mockFetch(200, {});
    const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: clientFn });

    const result = await client.webhooks.sendTest({
      url: 'https://example.com/hook',
      secret: WEBHOOK_SECRET,
      fetch: receiverFn as typeof globalThis.fetch,
      _backoffMs: [0, 0, 0],
    });

    assert.equal(result.success, false);
    assert.equal(result.statusCode, 500);
    assert.equal(result.attempts, 4); // 1 initial + 3 retries
    assert.equal(calls.length, 4);
  });

  it('should retry on 429 Too Many Requests', async () => {
    const responses = [
      { status: 429, body: {} },
      { status: 200, body: { ok: true } },
    ];
    const { fn: receiverFn, calls } = mockFetchSequence(responses);
    const { fn: clientFn } = mockFetch(200, {});
    const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: clientFn });

    const result = await client.webhooks.sendTest({
      url: 'https://example.com/hook',
      secret: WEBHOOK_SECRET,
      fetch: receiverFn,
      _backoffMs: [0, 0, 0],
    });

    assert.equal(result.success, true);
    assert.equal(result.attempts, 2);
    assert.equal(calls.length, 2);
  });

  it('should handle network errors gracefully', async () => {
    const receiverFn = async (): Promise<Response> => {
      throw new Error('ECONNREFUSED');
    };

    const { fn: clientFn } = mockFetch(200, {});
    const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: clientFn });

    const result = await client.webhooks.sendTest({
      url: 'https://example.com/hook',
      secret: WEBHOOK_SECRET,
      fetch: receiverFn as typeof globalThis.fetch,
      _backoffMs: [0, 0, 0],
    });

    assert.equal(result.success, false);
    assert.equal(result.statusCode, null);
    assert.equal(result.attempts, 4); // Exhausted all retries
    assert.equal(result.error, 'ECONNREFUSED');
  });
});
