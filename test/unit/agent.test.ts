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

const SCORE_RESPONSE = {
  token: 'BTC',
  composite: { score: 72, signal: 'GO', confidence: 0.85 },
  spot: { score: 65 },
  perps: { score: 78 },
  context: {},
  market: { regime: 'Risk-On' },
  derivSymbols: ['BTC', 'ETH'],
  hasDerivatives: true,
  sources: [{ provider: 'Coinglass' }],
  meta: { schemaVersion: '2.0' },
};

const DATA_RESPONSE = {
  assets: { BTC: { composite: { score: 72 } }, ETH: { composite: { score: 65 } } },
  assetOrder: ['BTC', 'ETH'],
  market: { regime: 'Risk-On' },
  sources: [{ provider: 'Coinglass' }],
  meta: { schemaVersion: '2.0' },
};

// ── Tests ───────────────────────────────────────────────────────────

describe('AgentModule', () => {
  describe('getScore', () => {
    it('should GET /v1/agent/score with symbol query param', async () => {
      const { fn, calls } = mockFetch(200, SCORE_RESPONSE);
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      const result = await client.agent.getScore('BTC');

      assert.equal(calls.length, 1);
      assert.ok(calls[0]!.url.includes('/v1/agent/score'));
      assert.ok(calls[0]!.url.includes('symbol=BTC'));
      assert.equal(calls[0]!.init.method, 'GET');

      assert.equal(result.token, 'BTC');
      assert.equal(result.composite.score, 72);
      assert.equal(result.composite.signal, 'GO');
    });

    it('should set X-API-Key header in apikey mode', async () => {
      const { fn, calls } = mockFetch(200, SCORE_RESPONSE);
      const client = new AttaGoClient({ apiKey: 'ak_live_mykey', fetch: fn });

      await client.agent.getScore('ETH');

      const headers = calls[0]!.init.headers as Record<string, string>;
      assert.equal(headers['X-API-Key'], 'ak_live_mykey');
    });
  });

  describe('getData', () => {
    it('should GET /v1/agent/data without params when no symbols', async () => {
      const { fn, calls } = mockFetch(200, DATA_RESPONSE);
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      const result = await client.agent.getData();

      assert.ok(calls[0]!.url.includes('/v1/agent/data'));
      assert.ok(!calls[0]!.url.includes('symbols'));
      assert.deepEqual(result.assetOrder, ['BTC', 'ETH']);
    });

    it('should pass comma-separated symbols when provided', async () => {
      const { fn, calls } = mockFetch(200, DATA_RESPONSE);
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      await client.agent.getData(['BTC', 'ETH']);

      assert.ok(
        calls[0]!.url.includes('symbols=BTC') ||
          calls[0]!.url.includes('symbols=BTC%2CETH'),
      );
    });
  });
});
