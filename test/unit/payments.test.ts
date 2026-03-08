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

describe('PaymentsModule', () => {
  describe('subscribe', () => {
    it('should POST /v1/payments/subscribe', async () => {
      const response = {
        tier: 'pro',
        billingCycle: 'monthly',
        price: 20,
        currency: 'USDC',
        expiresAt: '2026-04-08T00:00:00Z',
        payer: '0xabc',
        mode: 'test',
        message: 'Subscription activated: pro (monthly)',
      };
      const { fn, calls } = mockFetch(200, response);
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      const result = await client.payments.subscribe({
        tier: 'pro',
        billingCycle: 'monthly',
      });

      assert.ok(calls[0]!.url.includes('/v1/payments/subscribe'));
      assert.equal(calls[0]!.init.method, 'POST');
      const body = JSON.parse(calls[0]!.init.body as string);
      assert.equal(body.tier, 'pro');
      assert.equal(body.billingCycle, 'monthly');
      assert.equal(body.renew, false); // default
      assert.equal(result.price, 20);
      assert.equal(result.tier, 'pro');
    });

    it('should pass renew flag when true', async () => {
      const { fn, calls } = mockFetch(200, { tier: 'basic' });
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      await client.payments.subscribe({
        tier: 'basic',
        billingCycle: 'yearly',
        renew: true,
      });

      const body = JSON.parse(calls[0]!.init.body as string);
      assert.equal(body.renew, true);
      assert.equal(body.billingCycle, 'yearly');
    });
  });

  describe('status', () => {
    it('should GET /v1/payments/status', async () => {
      const response = {
        tier: 'pro',
        tierName: 'Pro',
        billingCycle: 'monthly',
        expiresAt: '2026-04-08T00:00:00Z',
        maxSubs: 25,
        apiAccess: true,
        freeDataPushes: 100,
        mode: 'test',
        includedPushes: {
          total: 100,
          used: 23,
          remaining: 77,
          periodStart: '2026-03-08T00:00:00Z',
          periodEnd: '2026-04-07T00:00:00Z',
        },
      };
      const { fn, calls } = mockFetch(200, response);
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      const result = await client.payments.status();

      assert.ok(calls[0]!.url.includes('/v1/payments/status'));
      assert.equal(result.tier, 'pro');
      assert.equal(result.maxSubs, 25);
      assert.equal(result.includedPushes?.remaining, 77);
    });
  });

  describe('upgradeQuote', () => {
    it('should GET /v1/payments/upgrade-quote with query params', async () => {
      const response = {
        currentTier: 'basic',
        currentCycle: 'monthly',
        currentExpiresAt: '2026-04-08T00:00:00Z',
        targetTier: 'pro',
        targetCycle: 'monthly',
        basePrice: 20,
        prorationCredit: 3.5,
        finalPrice: 16.5,
        currency: 'USDC',
        expiresAt: '2026-04-08T00:00:00Z',
      };
      const { fn, calls } = mockFetch(200, response);
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      const result = await client.payments.upgradeQuote('pro', 'monthly');

      assert.ok(calls[0]!.url.includes('/v1/payments/upgrade-quote'));
      assert.ok(calls[0]!.url.includes('tier=pro'));
      assert.ok(calls[0]!.url.includes('cycle=monthly'));
      assert.equal(result.finalPrice, 16.5);
      assert.equal(result.prorationCredit, 3.5);
    });
  });
});
