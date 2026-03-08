import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AttaGoClient } from '../../src/index.js';

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
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fn: fn as typeof globalThis.fetch, calls };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('DataModule', () => {
  describe('getLatest', () => {
    it('should GET /v1/data/latest with auth', async () => {
      const response = {
        assets: { BTC: {} },
        assetOrder: ['BTC'],
        market: {},
        sources: [],
        meta: {},
      };
      const { fn, calls } = mockFetch(200, response);
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      const result = await client.data.getLatest();

      assert.equal(calls.length, 1);
      assert.ok(calls[0]!.url.includes('/v1/data/latest'));
      assert.deepEqual(result.assetOrder, ['BTC']);
    });
  });

  describe('getTokenData', () => {
    it('should GET /v1/api/data/{token}', async () => {
      const response = {
        token: 'BTC',
        composite: { score: 72 },
        spot: {},
        perps: null,
        context: {},
        market: {},
        derivSymbols: ['BTC'],
        hasDerivatives: true,
        sources: [],
        meta: {},
        requestId: '2026-03-04T12-00-00-a1b2',
        mode: 'live',
      };
      const { fn, calls } = mockFetch(200, response);
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      const result = await client.data.getTokenData('BTC');

      assert.ok(calls[0]!.url.includes('/v1/api/data/BTC'));
      assert.equal(result.token, 'BTC');
      assert.equal(result.requestId, '2026-03-04T12-00-00-a1b2');
    });

    it('should URL-encode token names', async () => {
      const { fn, calls } = mockFetch(200, { token: 'AVAX' });
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      await client.data.getTokenData('AVAX');

      assert.ok(calls[0]!.url.includes('/v1/api/data/AVAX'));
    });
  });

  describe('getDataPush', () => {
    it('should GET /v1/data/push/{requestId} without auth header', async () => {
      const response = {
        requestId: 'req-123',
        tokenId: 'BTC',
        createdAt: '2026-03-04T12:00:00Z',
        data: { composite: { score: 72 } },
      };
      const { fn, calls } = mockFetch(200, response);
      // No auth needed for data-push snapshots
      const client = new AttaGoClient({ fetch: fn });

      const result = await client.data.getDataPush('req-123');

      assert.ok(calls[0]!.url.includes('/v1/data/push/req-123'));
      assert.equal(result.requestId, 'req-123');
      assert.equal(result.tokenId, 'BTC');

      // Should NOT have any auth header
      const headers = calls[0]!.init.headers as Record<string, string>;
      assert.equal(headers['X-API-Key'], undefined);
      assert.equal(headers['Authorization'], undefined);
    });
  });
});
