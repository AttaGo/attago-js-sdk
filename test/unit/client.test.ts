import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AttaGoClient,
  ApiError,
  PaymentRequiredError,
  RateLimitError,
} from '../../src/index.js';

// ── Helpers ─────────────────────────────────────────────────────────

interface FetchCall {
  url: string;
  init: RequestInit;
}

/** Create a mock fetch that always returns the same response. */
function mockFetch(
  status: number,
  body: unknown,
  responseHeaders?: Record<string, string>,
) {
  const calls: FetchCall[] = [];

  const fn = async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ url: url.toString(), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...responseHeaders },
    });
  };

  return { fn: fn as typeof globalThis.fetch, calls };
}

/** Build a fake JWT with the given `exp` (unix seconds). */
function makeJwt(exp: number): string {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
  const p = Buffer.from(
    JSON.stringify({ exp, sub: 'u1', email: 'test@example.com' }),
  ).toString('base64url');
  const s = Buffer.from('sig').toString('base64url');
  return `${h}.${p}.${s}`;
}

/**
 * Create a mock fetch that routes Cognito requests and API requests
 * to different handlers.
 */
function cognitoAwareFetch(
  cognitoResponse: { status: number; body: unknown },
  apiResponse: { status: number; body: unknown },
) {
  const apiCalls: FetchCall[] = [];
  const cognitoCalls: FetchCall[] = [];

  const fn = async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const urlStr = url.toString();
    if (urlStr.includes('cognito-idp')) {
      cognitoCalls.push({ url: urlStr, init: init ?? {} });
      return new Response(JSON.stringify(cognitoResponse.body), {
        status: cognitoResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    apiCalls.push({ url: urlStr, init: init ?? {} });
    return new Response(JSON.stringify(apiResponse.body), {
      status: apiResponse.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return { fn: fn as typeof globalThis.fetch, apiCalls, cognitoCalls };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('AttaGoClient', () => {
  // ── Constructor ──

  describe('constructor', () => {
    it('should default to production base URL', () => {
      const { fn } = mockFetch(200, {});
      const client = new AttaGoClient({ apiKey: 'ak_live_test', fetch: fn });
      assert.equal(client.baseUrl, 'https://api.attago.bid');
    });

    it('should accept custom base URL', () => {
      const { fn } = mockFetch(200, {});
      const client = new AttaGoClient({
        baseUrl: 'https://api.staging.attago.io',
        apiKey: 'ak_test_abc',
        fetch: fn,
      });
      assert.equal(client.baseUrl, 'https://api.staging.attago.io');
    });

    it('should strip trailing slashes from base URL', () => {
      const { fn } = mockFetch(200, {});
      const client = new AttaGoClient({
        baseUrl: 'https://api.attago.bid/',
        apiKey: 'ak_live_abc',
        fetch: fn,
      });
      assert.equal(client.baseUrl, 'https://api.attago.bid');
    });

    it('should detect apikey auth mode', () => {
      const { fn } = mockFetch(200, {});
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });
      assert.equal(client.authMode, 'apikey');
      assert.equal(client.auth, null);
    });

    it('should detect cognito auth mode with email + clientId', () => {
      const { fn } = mockFetch(200, {});
      const client = new AttaGoClient({
        email: 'test@example.com',
        cognitoClientId: 'client-123',
        fetch: fn,
      });
      assert.equal(client.authMode, 'cognito');
      assert.ok(client.auth !== null);
    });

    it('should detect cognito auth mode with clientId alone', () => {
      const { fn } = mockFetch(200, {});
      const client = new AttaGoClient({
        cognitoClientId: 'client-123',
        fetch: fn,
      });
      assert.equal(client.authMode, 'cognito');
    });

    it('should detect x402 auth mode', () => {
      const { fn } = mockFetch(200, {});
      const client = new AttaGoClient({
        signer: {
          address: '0xabc',
          network: 'eip155:8453',
          sign: async () => 'signed',
        },
        fetch: fn,
      });
      assert.equal(client.authMode, 'x402');
    });

    it('should default to none auth mode', () => {
      const { fn } = mockFetch(200, {});
      const client = new AttaGoClient({ fetch: fn });
      assert.equal(client.authMode, 'none');
    });

    it('should reject multiple auth modes', () => {
      const { fn } = mockFetch(200, {});
      assert.throws(
        () =>
          new AttaGoClient({
            apiKey: 'ak_live_abc',
            email: 'test@example.com',
            cognitoClientId: 'client-123',
            fetch: fn,
          }),
        /Only one auth mode allowed/,
      );
    });

    it('should require cognitoClientId when email is provided', () => {
      const { fn } = mockFetch(200, {});
      assert.throws(
        () => new AttaGoClient({ email: 'test@example.com', fetch: fn }),
        /cognitoClientId is required/,
      );
    });
  });

  // ── Request — API key ──

  describe('request — API key auth', () => {
    it('should send X-API-Key header', async () => {
      const { fn, calls } = mockFetch(200, { ok: true });
      const client = new AttaGoClient({ apiKey: 'ak_live_mykey', fetch: fn });

      await client.request('GET', '/user/profile');

      assert.equal(calls.length, 1);
      const headers = calls[0]!.init.headers as Record<string, string>;
      assert.equal(headers['X-API-Key'], 'ak_live_mykey');
    });

    it('should auto-prefix /v1 to path', async () => {
      const { fn, calls } = mockFetch(200, { ok: true });
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      await client.request('GET', '/user/profile');
      assert.ok(calls[0]!.url.includes('/v1/user/profile'));
    });

    it('should not double-prefix /v1', async () => {
      const { fn, calls } = mockFetch(200, { ok: true });
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      await client.request('GET', '/v1/user/profile');
      assert.ok(calls[0]!.url.includes('/v1/user/profile'));
      assert.ok(!calls[0]!.url.includes('/v1/v1/'));
    });

    it('should handle paths without leading slash', async () => {
      const { fn, calls } = mockFetch(200, { ok: true });
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      await client.request('GET', 'user/profile');
      assert.ok(calls[0]!.url.includes('/v1/user/profile'));
    });

    it('should include query parameters', async () => {
      const { fn, calls } = mockFetch(200, { ok: true });
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      await client.request('GET', '/agent/score', {
        query: { symbol: 'BTC' },
      });

      assert.ok(calls[0]!.url.includes('symbol=BTC'));
    });

    it('should skip undefined query parameters', async () => {
      const { fn, calls } = mockFetch(200, { ok: true });
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      await client.request('GET', '/agent/score', {
        query: { symbol: 'BTC', limit: undefined },
      });

      assert.ok(calls[0]!.url.includes('symbol=BTC'));
      assert.ok(!calls[0]!.url.includes('limit'));
    });
  });

  // ── Request — Cognito auth ──

  describe('request — Cognito auth', () => {
    it('should send Authorization Bearer header after lazy sign-in', async () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const jwt = makeJwt(exp);

      const { fn, apiCalls } = cognitoAwareFetch(
        {
          status: 200,
          body: {
            AuthenticationResult: {
              IdToken: jwt,
              AccessToken: 'a',
              RefreshToken: 'r',
            },
          },
        },
        { status: 200, body: { userId: 'u1' } },
      );

      const client = new AttaGoClient({
        email: 'test@example.com',
        password: 'Test1234!',
        cognitoClientId: 'client-123',
        fetch: fn,
      });

      await client.request('GET', '/user/profile');

      assert.equal(apiCalls.length, 1);
      const headers = apiCalls[0]!.init.headers as Record<string, string>;
      assert.equal(headers['Authorization'], `Bearer ${jwt}`);
    });
  });

  // ── Request — x402 auth ──

  describe('request — x402 auth', () => {
    it('should not send any auth header', async () => {
      const { fn, calls } = mockFetch(200, { ok: true });
      const client = new AttaGoClient({
        signer: {
          address: '0xabc',
          network: 'eip155:8453',
          sign: async () => 'signed',
        },
        fetch: fn,
      });

      await client.request('GET', '/agent/score', {
        query: { symbol: 'BTC' },
      });

      const headers = calls[0]!.init.headers as Record<string, string>;
      assert.equal(headers['X-API-Key'], undefined);
      assert.equal(headers['Authorization'], undefined);
    });
  });

  // ── Request — POST body ──

  describe('request — POST with body', () => {
    it('should serialize body as JSON and set Content-Type', async () => {
      const { fn, calls } = mockFetch(200, { subId: 'BTC#composite_score' });
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      await client.request('POST', '/subscriptions', {
        body: { tokenId: 'BTC', label: 'My alert' },
      });

      assert.equal(calls[0]!.init.method, 'POST');
      const headers = calls[0]!.init.headers as Record<string, string>;
      assert.equal(headers['Content-Type'], 'application/json');

      const body = JSON.parse(calls[0]!.init.body as string);
      assert.equal(body.tokenId, 'BTC');
      assert.equal(body.label, 'My alert');
    });
  });

  // ── Error handling ──

  describe('error handling', () => {
    it('should throw ApiError on 404', async () => {
      const { fn } = mockFetch(404, { error: 'Not found' });
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      await assert.rejects(
        () => client.request('GET', '/user/profile'),
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.status, 404);
          assert.equal(err.message, 'Not found');
          return true;
        },
      );
    });

    it('should throw ApiError on 500', async () => {
      const { fn } = mockFetch(500, { error: 'Internal server error' });
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      await assert.rejects(
        () => client.request('GET', '/user/profile'),
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.status, 500);
          return true;
        },
      );
    });

    it('should throw PaymentRequiredError on 402 with decoded requirements', async () => {
      const paymentReqs = {
        x402Version: 2,
        resource: { url: '/agent/score', description: 'Score' },
        accepts: [
          { scheme: 'exact', network: 'eip155:8453', amount: '100000' },
        ],
      };
      const encoded = Buffer.from(JSON.stringify(paymentReqs)).toString(
        'base64',
      );

      const { fn } = mockFetch(402, { error: 'Payment required' }, {
        'payment-required': encoded,
      });
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      await assert.rejects(
        () => client.request('GET', '/agent/score'),
        (err: unknown) => {
          assert.ok(err instanceof PaymentRequiredError);
          assert.equal(err.status, 402);
          assert.ok(err.paymentRequirements);
          const reqs = err.paymentRequirements as typeof paymentReqs;
          assert.equal(reqs.x402Version, 2);
          assert.equal(reqs.accepts.length, 1);
          return true;
        },
      );
    });

    it('should handle 402 without payment-required header', async () => {
      const { fn } = mockFetch(402, { error: 'Payment required' });
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      await assert.rejects(
        () => client.request('GET', '/agent/score'),
        (err: unknown) => {
          assert.ok(err instanceof PaymentRequiredError);
          assert.equal(err.paymentRequirements, null);
          return true;
        },
      );
    });

    it('should throw RateLimitError on 429 with Retry-After', async () => {
      const { fn } = mockFetch(429, { error: 'Rate limit exceeded' }, {
        'retry-after': '60',
      });
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      await assert.rejects(
        () => client.request('GET', '/agent/score'),
        (err: unknown) => {
          assert.ok(err instanceof RateLimitError);
          assert.equal(err.status, 429);
          assert.equal(err.retryAfter, 60);
          return true;
        },
      );
    });

    it('should throw RateLimitError on 429 without Retry-After', async () => {
      const { fn } = mockFetch(429, { error: 'Too many requests' });
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      await assert.rejects(
        () => client.request('GET', '/agent/score'),
        (err: unknown) => {
          assert.ok(err instanceof RateLimitError);
          assert.equal(err.retryAfter, undefined);
          return true;
        },
      );
    });

    it('should include body in ApiError', async () => {
      const { fn } = mockFetch(403, {
        error: 'Forbidden',
        message: 'Tier too low',
      });
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      await assert.rejects(
        () => client.request('GET', '/data/latest'),
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.body?.error, 'Forbidden');
          assert.equal(err.body?.message, 'Tier too low');
          return true;
        },
      );
    });

    it('should use error field from body as message', async () => {
      const { fn } = mockFetch(400, { error: 'Bad request: missing tokenId' });
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      await assert.rejects(
        () => client.request('POST', '/subscriptions', { body: {} }),
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.message, 'Bad request: missing tokenId');
          return true;
        },
      );
    });
  });

  // ── Error hierarchy ──

  describe('error hierarchy', () => {
    it('PaymentRequiredError should be instanceof ApiError', () => {
      const err = new PaymentRequiredError(
        'pay',
        new Headers(),
        {},
        null,
      );
      assert.ok(err instanceof ApiError);
      assert.ok(err instanceof Error);
    });

    it('RateLimitError should be instanceof ApiError', () => {
      const err = new RateLimitError('slow', new Headers(), {});
      assert.ok(err instanceof ApiError);
    });
  });

  // ── Static helpers ──

  describe('static registration methods', () => {
    it('signUp should delegate to CognitoAuth.signUp', async () => {
      const { fn, calls } = mockFetch(200, { UserSub: 'sub-123' });

      const result = await AttaGoClient.signUp({
        email: 'test@example.com',
        password: 'Test1234!',
        cognitoClientId: 'client-123',
        fetch: fn,
      });

      assert.equal(result.userSub, 'sub-123');
      assert.equal(calls.length, 1);
    });

    it('confirmSignUp should delegate to CognitoAuth', async () => {
      const { fn, calls } = mockFetch(200, {});

      await AttaGoClient.confirmSignUp({
        email: 'test@example.com',
        code: '123456',
        cognitoClientId: 'client-123',
        fetch: fn,
      });

      assert.equal(calls.length, 1);
    });
  });
});
