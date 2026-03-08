import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePaymentRequired,
  filterAcceptsByNetwork,
  fetchWithX402,
} from '../../src/x402.js';
import { PaymentRequiredError } from '../../src/errors.js';
import type { X402AcceptedPayment, X402Signer } from '../../src/types.js';

// ── Helpers ─────────────────────────────────────────────────────────

const SAMPLE_REQUIREMENTS = {
  x402Version: 2,
  resource: {
    url: '/agent/score?symbol=BTC',
    description: 'AttaGo full data for BTC',
    mimeType: 'application/json',
  },
  accepts: [
    {
      scheme: 'exact',
      network: 'eip155:8453',
      amount: '100000',
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b3EA6957D0F',
      payTo: '0xRecipient',
      maxTimeoutSeconds: 60,
      extra: { name: 'USD Coin', version: '2' },
    },
    {
      scheme: 'exact',
      network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      amount: '100000',
      asset: 'EPjFWaLb3odccxmLVGcMjMcV46sSUDEe3BQZ1Hi66m9w',
      payTo: 'TokenkegQfeZyiNwAJsyFbPVwwQkYk5ModQstBSo9qVV',
      maxTimeoutSeconds: 60,
      extra: { feePayer: '2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4' },
    },
  ],
};

function encodeRequirements(reqs: unknown): string {
  return Buffer.from(JSON.stringify(reqs)).toString('base64');
}

function make402Response(reqs: unknown): Response {
  return new Response(JSON.stringify({ error: 'Payment required' }), {
    status: 402,
    headers: {
      'Content-Type': 'application/json',
      'payment-required': encodeRequirements(reqs),
    },
  });
}

function makeSigner(network: string, signResult = 'signed-payment'): X402Signer {
  return {
    address: '0xTestWallet',
    network,
    sign: async () => signResult,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('x402', () => {
  describe('parsePaymentRequired', () => {
    it('should decode base64 PAYMENT-REQUIRED header', () => {
      const headers = new Headers({
        'payment-required': encodeRequirements(SAMPLE_REQUIREMENTS),
      });

      const result = parsePaymentRequired(headers);
      assert.ok(result);
      assert.equal(result.x402Version, 2);
      assert.equal(result.accepts.length, 2);
      assert.equal(result.accepts[0]!.network, 'eip155:8453');
    });

    it('should return null for missing header', () => {
      const result = parsePaymentRequired(new Headers());
      assert.equal(result, null);
    });

    it('should return null for malformed base64', () => {
      const headers = new Headers({ 'payment-required': '!!!invalid!!!' });
      const result = parsePaymentRequired(headers);
      assert.equal(result, null);
    });
  });

  describe('filterAcceptsByNetwork', () => {
    it('should find matching EVM network', () => {
      const accepts = SAMPLE_REQUIREMENTS.accepts as X402AcceptedPayment[];
      const result = filterAcceptsByNetwork(accepts, 'eip155:8453');
      assert.ok(result);
      assert.equal(result.network, 'eip155:8453');
    });

    it('should find matching Solana network', () => {
      const accepts = SAMPLE_REQUIREMENTS.accepts as X402AcceptedPayment[];
      const result = filterAcceptsByNetwork(
        accepts,
        'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      );
      assert.ok(result);
      assert.equal(result.network, 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
    });

    it('should return null for unmatched network', () => {
      const accepts = SAMPLE_REQUIREMENTS.accepts as X402AcceptedPayment[];
      const result = filterAcceptsByNetwork(accepts, 'eip155:1');
      assert.equal(result, null);
    });
  });

  describe('fetchWithX402', () => {
    it('should pass through non-402 responses unchanged', async () => {
      const fn = async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });

      const signer = makeSigner('eip155:8453');
      const res = await fetchWithX402(
        fn as typeof fetch,
        signer,
        'https://api.attago.bid/v1/agent/score',
        { method: 'GET' },
      );

      assert.equal(res.status, 200);
    });

    it('should auto-sign and retry on 402', async () => {
      let callCount = 0;
      const fn = async (_url: string | URL | Request, init?: RequestInit) => {
        callCount++;
        if (callCount === 1) {
          return make402Response(SAMPLE_REQUIREMENTS);
        }
        // Verify PAYMENT-SIGNATURE header is present on retry
        const headers = new Headers(init?.headers as HeadersInit);
        assert.equal(headers.get('PAYMENT-SIGNATURE'), 'signed-base-payment');
        return new Response(
          JSON.stringify({ token: 'BTC', composite: { score: 72 } }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      };

      const signer = makeSigner('eip155:8453', 'signed-base-payment');
      const res = await fetchWithX402(
        fn as typeof fetch,
        signer,
        'https://api.attago.bid/v1/agent/score?symbol=BTC',
        { method: 'GET', headers: { Accept: 'application/json' } },
      );

      assert.equal(res.status, 200);
      assert.equal(callCount, 2);
    });

    it('should throw PaymentRequiredError if no matching network', async () => {
      const fn = async () => make402Response(SAMPLE_REQUIREMENTS);
      const signer = makeSigner('eip155:1'); // Ethereum mainnet — not in accepts

      await assert.rejects(
        () =>
          fetchWithX402(
            fn as typeof fetch,
            signer,
            'https://api.attago.bid/v1/agent/score',
            { method: 'GET' },
          ),
        (err: unknown) => {
          assert.ok(err instanceof PaymentRequiredError);
          assert.ok(err.paymentRequirements);
          return true;
        },
      );
    });

    it('should throw PaymentRequiredError if retry also returns 402', async () => {
      const fn = async () => make402Response(SAMPLE_REQUIREMENTS);
      const signer = makeSigner('eip155:8453');

      await assert.rejects(
        () =>
          fetchWithX402(
            fn as typeof fetch,
            signer,
            'https://api.attago.bid/v1/agent/score',
            { method: 'GET' },
          ),
        (err: unknown) => {
          assert.ok(err instanceof PaymentRequiredError);
          return true;
        },
      );
    });

    it('should throw PaymentRequiredError if PAYMENT-REQUIRED header is missing', async () => {
      const fn = async () =>
        new Response(JSON.stringify({ error: 'Payment required' }), {
          status: 402,
          headers: { 'Content-Type': 'application/json' },
        });
      const signer = makeSigner('eip155:8453');

      await assert.rejects(
        () =>
          fetchWithX402(
            fn as typeof fetch,
            signer,
            'https://api.attago.bid/v1/agent/score',
            { method: 'GET' },
          ),
        (err: unknown) => {
          assert.ok(err instanceof PaymentRequiredError);
          assert.equal(err.paymentRequirements, null);
          return true;
        },
      );
    });

    it('should pass signer the full requirements object', async () => {
      let receivedReqs: unknown = null;
      const signer: X402Signer = {
        address: '0xTest',
        network: 'eip155:8453',
        sign: async (reqs) => {
          receivedReqs = reqs;
          return 'sig';
        },
      };

      let callCount = 0;
      const fn = async () => {
        callCount++;
        if (callCount === 1) return make402Response(SAMPLE_REQUIREMENTS);
        return new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      await fetchWithX402(
        fn as typeof fetch,
        signer,
        'https://api.attago.bid/v1/agent/score',
        { method: 'GET' },
      );

      assert.ok(receivedReqs);
      const reqs = receivedReqs as typeof SAMPLE_REQUIREMENTS;
      assert.equal(reqs.x402Version, 2);
      assert.equal(reqs.accepts.length, 2);
    });
  });
});
