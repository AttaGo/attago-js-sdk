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

// ── Wallets ─────────────────────────────────────────────────────────

describe('WalletsModule', () => {
  it('should POST /v1/payments/wallet to register', async () => {
    const response = {
      userId: 'u1',
      walletAddress: '0xabc',
      chain: 'base',
      verifiedAt: '2026-03-08T00:00:00Z',
    };
    const { fn, calls } = mockFetch(201, response);
    const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

    const result = await client.wallets.register({
      walletAddress: '0xabc',
      chain: 'base',
      signature: '0xsig',
      timestamp: 1709553600,
    });

    assert.ok(calls[0]!.url.includes('/v1/payments/wallet'));
    assert.equal(calls[0]!.init.method, 'POST');
    assert.equal(result.walletAddress, '0xabc');
    assert.equal(result.chain, 'base');
  });

  it('should GET /v1/payments/wallets', async () => {
    const response = {
      wallets: [
        { userId: 'u1', walletAddress: '0xabc', chain: 'base', verifiedAt: '2026-01-01T00:00:00Z' },
        { userId: 'u1', walletAddress: '4AX...', chain: 'solana', verifiedAt: '2026-02-01T00:00:00Z' },
      ],
    };
    const { fn, calls } = mockFetch(200, response);
    const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

    const result = await client.wallets.list();

    assert.ok(calls[0]!.url.includes('/v1/payments/wallets'));
    assert.equal(result.length, 2);
    assert.equal(result[1]!.chain, 'solana');
  });

  it('should DELETE /v1/payments/wallet/{address}', async () => {
    const { fn, calls } = mockFetch(200, { deleted: true });
    const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

    await client.wallets.remove('0xabc');

    assert.ok(calls[0]!.url.includes('/v1/payments/wallet/0xabc'));
    assert.equal(calls[0]!.init.method, 'DELETE');
  });
});

// ── Bundles ─────────────────────────────────────────────────────────

describe('BundlesModule', () => {
  it('should GET /v1/api/bundles', async () => {
    const response = {
      bundles: [
        { bundleId: 'b1', userId: 'u1', walletAddress: '0x', bundleSize: 350, remaining: 200, purchasedAt: '2026-01-01T00:00:00Z', expiresAt: null },
      ],
      catalog: [
        { name: '$5 bundle', pushes: 60, price: 5 },
        { name: '$25 bundle', pushes: 350, price: 25 },
      ],
      perRequestPrice: 0.10,
    };
    const { fn, calls } = mockFetch(200, response);
    const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

    const result = await client.bundles.list();

    assert.ok(calls[0]!.url.includes('/v1/api/bundles'));
    assert.equal(result.bundles.length, 1);
    assert.equal(result.catalog.length, 2);
    assert.equal(result.perRequestPrice, 0.10);
  });

  it('should POST /v1/api/bundles to purchase', async () => {
    const response = {
      bundleId: 'b2',
      userId: 'u1',
      walletAddress: '0xabc',
      bundleName: '$25 bundle',
      totalPushes: 350,
      remaining: 350,
      price: 25,
      purchasedAt: '2026-03-08T00:00:00Z',
      payer: '0xabc',
      transactionId: '0xtx',
    };
    const { fn, calls } = mockFetch(201, response);
    const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

    const result = await client.bundles.purchase({
      bundleIndex: 1,
      walletAddress: '0xabc',
    });

    assert.equal(calls[0]!.init.method, 'POST');
    const body = JSON.parse(calls[0]!.init.body as string);
    assert.equal(body.bundleIndex, 1);
    assert.equal(result.totalPushes, 350);
    assert.equal(result.price, 25);
  });
});

// ── Push ────────────────────────────────────────────────────────────

describe('PushModule', () => {
  it('should GET /v1/user/push-subscriptions', async () => {
    const response = {
      items: [
        { subscriptionId: 'ps-1', endpoint: 'https://fcm.googleapis.com/abc', createdAt: '2026-01-01T00:00:00Z' },
      ],
    };
    const { fn, calls } = mockFetch(200, response);
    const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

    const result = await client.push.list();

    assert.ok(calls[0]!.url.includes('/v1/user/push-subscriptions'));
    assert.equal(result.length, 1);
    assert.equal(result[0]!.subscriptionId, 'ps-1');
  });

  it('should POST /v1/user/push-subscriptions', async () => {
    const response = {
      subscriptionId: 'ps-new',
      endpoint: 'https://fcm.googleapis.com/new',
      createdAt: '2026-03-08T00:00:00Z',
    };
    const { fn, calls } = mockFetch(201, response);
    const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

    const result = await client.push.create({
      endpoint: 'https://fcm.googleapis.com/new',
      keys: { p256dh: 'key1', auth: 'key2' },
    });

    assert.equal(calls[0]!.init.method, 'POST');
    const body = JSON.parse(calls[0]!.init.body as string);
    assert.equal(body.endpoint, 'https://fcm.googleapis.com/new');
    assert.ok(body.keys.p256dh);
    assert.equal(result.subscriptionId, 'ps-new');
  });

  it('should DELETE /v1/user/push-subscriptions/{id}', async () => {
    const { fn, calls } = mockFetch(200, { deleted: true });
    const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

    await client.push.delete('ps-1');

    assert.ok(calls[0]!.url.includes('/v1/user/push-subscriptions/ps-1'));
    assert.equal(calls[0]!.init.method, 'DELETE');
  });
});

// ── API Keys ────────────────────────────────────────────────────────

describe('ApiKeysModule', () => {
  it('should POST /v1/user/api-keys', async () => {
    const response = {
      keyId: 'k1',
      name: 'my-bot',
      prefix: 'ak_live_a1b2',
      key: 'ak_live_a1b2_full_key',
      createdAt: '2026-03-08T00:00:00Z',
    };
    const { fn, calls } = mockFetch(201, response);
    const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

    const result = await client.apiKeys.create('my-bot');

    assert.ok(calls[0]!.url.includes('/v1/user/api-keys'));
    assert.equal(calls[0]!.init.method, 'POST');
    const body = JSON.parse(calls[0]!.init.body as string);
    assert.equal(body.name, 'my-bot');
    assert.equal(result.key, 'ak_live_a1b2_full_key');
  });

  it('should GET /v1/user/api-keys', async () => {
    const response = {
      items: [
        { keyId: 'k1', name: 'my-bot', prefix: 'ak_live_a1b2', createdAt: '2026-01-01T00:00:00Z', lastUsedAt: null, revokedAt: null },
      ],
    };
    const { fn, calls } = mockFetch(200, response);
    const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

    const result = await client.apiKeys.list();

    assert.ok(calls[0]!.url.includes('/v1/user/api-keys'));
    assert.equal(result.length, 1);
    assert.equal(result[0]!.name, 'my-bot');
    assert.equal(result[0]!.revokedAt, null);
  });

  it('should DELETE /v1/user/api-keys/{id}', async () => {
    const { fn, calls } = mockFetch(200, { deleted: true });
    const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

    await client.apiKeys.revoke('k1');

    assert.ok(calls[0]!.url.includes('/v1/user/api-keys/k1'));
    assert.equal(calls[0]!.init.method, 'DELETE');
  });
});

// ── Redeem ──────────────────────────────────────────────────────────

describe('RedeemModule', () => {
  it('should POST /v1/user/redeem', async () => {
    const response = {
      tier: 'pro',
      expiresAt: '2026-06-08T00:00:00Z',
      message: 'Redemption code activated: pro for 90 days',
    };
    const { fn, calls } = mockFetch(200, response);
    const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

    const result = await client.redeem.redeem('PROMO-2026');

    assert.ok(calls[0]!.url.includes('/v1/user/redeem'));
    assert.equal(calls[0]!.init.method, 'POST');
    const body = JSON.parse(calls[0]!.init.body as string);
    assert.equal(body.code, 'PROMO-2026');
    assert.equal(result.tier, 'pro');
  });
});
