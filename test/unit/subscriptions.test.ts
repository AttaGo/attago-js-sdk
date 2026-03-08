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
    if (status === 204) return new Response(null, { status });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fn: fn as typeof globalThis.fetch, calls };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('SubscriptionsModule', () => {
  describe('catalog', () => {
    it('should GET /v1/subscriptions/catalog', async () => {
      const response = {
        tokens: ['BTC', 'ETH'],
        metrics: { spot_score: { label: 'Spot Score', type: 'number' } },
        tier: 'pro',
        maxSubscriptions: 25,
        mode: 'custom',
      };
      const { fn, calls } = mockFetch(200, response);
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      const result = await client.subscriptions.catalog();

      assert.ok(calls[0]!.url.includes('/v1/subscriptions/catalog'));
      assert.equal(calls[0]!.init.method, 'GET');
      assert.deepEqual(result.tokens, ['BTC', 'ETH']);
      assert.equal(result.tier, 'pro');
      assert.equal(result.maxSubscriptions, 25);
    });
  });

  describe('list', () => {
    it('should GET /v1/user/subscriptions and unwrap array', async () => {
      const response = {
        subscriptions: [
          {
            userId: 'u1',
            subId: 'sub-1',
            tokenId: 'BTC',
            label: 'BTC spot bullish',
            groups: [[{ metricName: 'spot_score', thresholdOp: 'gt', thresholdVal: 5 }]],
            cooldownMinutes: 5,
            bucketHash: 'abc123',
            isActive: true,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      };
      const { fn, calls } = mockFetch(200, response);
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      const result = await client.subscriptions.list();

      assert.ok(calls[0]!.url.includes('/v1/user/subscriptions'));
      assert.equal(result.length, 1);
      assert.equal(result[0]!.tokenId, 'BTC');
      assert.equal(result[0]!.groups[0]![0]!.metricName, 'spot_score');
    });
  });

  describe('create', () => {
    it('should POST /v1/user/subscriptions with groups format', async () => {
      const sub = {
        userId: 'u1',
        subId: 'sub-new',
        tokenId: 'ETH',
        label: 'ETH composite GO',
        groups: [[{ metricName: 'composite_score', thresholdOp: 'gt', thresholdVal: 50 }]],
        cooldownMinutes: 10,
        bucketHash: 'def456',
        isActive: true,
        createdAt: '2026-03-08T00:00:00Z',
        updatedAt: '2026-03-08T00:00:00Z',
      };
      const { fn, calls } = mockFetch(201, sub);
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      const result = await client.subscriptions.create({
        tokenId: 'ETH',
        label: 'ETH composite GO',
        groups: [[{ metricName: 'composite_score', thresholdOp: 'gt', thresholdVal: 50 }]],
        cooldownMinutes: 10,
      });

      assert.equal(calls[0]!.init.method, 'POST');
      const body = JSON.parse(calls[0]!.init.body as string);
      assert.equal(body.tokenId, 'ETH');
      assert.equal(body.cooldownMinutes, 10);
      assert.equal(result.subId, 'sub-new');
    });

    it('should default cooldownMinutes to 5', async () => {
      const { fn, calls } = mockFetch(201, { subId: 'sub-new' });
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      await client.subscriptions.create({
        tokenId: 'BTC',
        label: 'test',
        groups: [[{ metricName: 'spot_score', thresholdOp: 'gt', thresholdVal: 0 }]],
      });

      const body = JSON.parse(calls[0]!.init.body as string);
      assert.equal(body.cooldownMinutes, 5);
    });
  });

  describe('update', () => {
    it('should PUT /v1/user/subscriptions/{id}', async () => {
      const { fn, calls } = mockFetch(200, { subId: 'sub-1', label: 'Updated' });
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      const result = await client.subscriptions.update('sub-1', {
        label: 'Updated',
        cooldownMinutes: 15,
      });

      assert.ok(calls[0]!.url.includes('/v1/user/subscriptions/sub-1'));
      assert.equal(calls[0]!.init.method, 'PUT');
      assert.equal(result.label, 'Updated');
    });
  });

  describe('delete', () => {
    it('should DELETE /v1/user/subscriptions/{id}', async () => {
      const { fn, calls } = mockFetch(200, { deleted: true });
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      await client.subscriptions.delete('sub-1');

      assert.ok(calls[0]!.url.includes('/v1/user/subscriptions/sub-1'));
      assert.equal(calls[0]!.init.method, 'DELETE');
    });
  });
});
