import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { WebhookListener, type WebhookPayload } from '../../src/index.js';

// ── Helpers ─────────────────────────────────────────────────────────

const SECRET = 'test-webhook-secret';

function signBody(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

function makePayload(event: 'alert' | 'test' = 'alert'): WebhookPayload {
  return {
    event,
    version: '2',
    environment: 'production',
    alert: {
      id: event === 'test' ? 'test' : 'BTC#spot_score',
      label: event === 'test' ? 'Test webhook delivery' : 'BTC spot bullish',
      token: 'BTC',
      state: 'triggered',
    },
    data: {
      url: event === 'test' ? null : 'https://api.attago.bid/v1/data/push/req-123',
      expiresAt: '2026-03-11T00:00:00Z',
    },
    timestamp: new Date().toISOString(),
  };
}

async function sendWebhook(
  port: number,
  body: string,
  signature?: string,
  path = '/webhook',
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-AttaGo-Event': 'alert',
    'User-Agent': 'AttaGo-Webhook/1.0',
  };
  if (signature) {
    headers['X-AttaGo-Signature'] = signature;
  }
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers,
    body,
  });
}

// ── Tests ───────────────────────────────────────────────────────────

let listener: WebhookListener | null = null;

afterEach(async () => {
  if (listener?.listening) {
    await listener.stop();
  }
  listener = null;
});

describe('WebhookListener', () => {
  it('should start and stop', async () => {
    listener = new WebhookListener({ secret: SECRET, port: 0 });

    // Use port 0 to let OS assign a free port
    await listener.start();
    assert.equal(listener.listening, true);

    await listener.stop();
    assert.equal(listener.listening, false);
  });

  it('should reject starting twice', async () => {
    listener = new WebhookListener({ secret: SECRET, port: 0 });
    await listener.start();

    await assert.rejects(
      () => listener!.start(),
      { message: 'Listener already started' },
    );
  });

  it('should accept valid signed webhooks', async () => {
    const received: WebhookPayload[] = [];
    listener = new WebhookListener({ secret: SECRET, port: 14000 });
    listener.on('alert', (payload) => received.push(payload));
    await listener.start();

    const payload = makePayload('alert');
    const body = JSON.stringify(payload);
    const sig = signBody(body);

    const res = await sendWebhook(14000, body, sig);
    assert.equal(res.status, 200);

    const json = await res.json();
    assert.equal(json.received, true);
    assert.equal(received.length, 1);
    assert.equal(received[0]!.alert.token, 'BTC');
    assert.equal(received[0]!.event, 'alert');
  });

  it('should emit test event for test deliveries', async () => {
    const alerts: WebhookPayload[] = [];
    const tests: WebhookPayload[] = [];
    listener = new WebhookListener({ secret: SECRET, port: 14001 });
    listener.on('alert', (p) => alerts.push(p));
    listener.on('test', (p) => tests.push(p));
    await listener.start();

    const payload = makePayload('test');
    const body = JSON.stringify(payload);
    const sig = signBody(body);

    const res = await sendWebhook(14001, body, sig);
    assert.equal(res.status, 200);
    assert.equal(alerts.length, 0); // Not an alert
    assert.equal(tests.length, 1);
    assert.equal(tests[0]!.event, 'test');
  });

  it('should reject missing signature with 401', async () => {
    listener = new WebhookListener({ secret: SECRET, port: 14002 });
    await listener.start();

    const body = JSON.stringify(makePayload());
    const res = await sendWebhook(14002, body); // No signature

    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.error, 'Invalid signature');
  });

  it('should reject invalid signature with 401', async () => {
    listener = new WebhookListener({ secret: SECRET, port: 14003 });
    await listener.start();

    const body = JSON.stringify(makePayload());
    const res = await sendWebhook(14003, body, 'a'.repeat(64));

    assert.equal(res.status, 401);
  });

  it('should reject wrong secret signature with 401', async () => {
    listener = new WebhookListener({ secret: SECRET, port: 14004 });
    await listener.start();

    const body = JSON.stringify(makePayload());
    const wrongSig = createHmac('sha256', 'wrong-secret').update(body).digest('hex');
    const res = await sendWebhook(14004, body, wrongSig);

    assert.equal(res.status, 401);
  });

  it('should return 404 for wrong path', async () => {
    listener = new WebhookListener({ secret: SECRET, port: 14005 });
    await listener.start();

    const body = JSON.stringify(makePayload());
    const sig = signBody(body);
    const res = await sendWebhook(14005, body, sig, '/wrong-path');

    assert.equal(res.status, 404);
  });

  it('should support custom path', async () => {
    listener = new WebhookListener({ secret: SECRET, port: 14006, path: '/hooks/attago' });
    await listener.start();

    const payload = makePayload();
    const body = JSON.stringify(payload);
    const sig = signBody(body);

    const res = await sendWebhook(14006, body, sig, '/hooks/attago');
    assert.equal(res.status, 200);
  });

  it('should emit error for handler exceptions', async () => {
    const errors: Error[] = [];
    listener = new WebhookListener({ secret: SECRET, port: 14007 });
    listener.on('alert', () => { throw new Error('handler crash'); });
    listener.on('error', (err) => errors.push(err));
    await listener.start();

    const body = JSON.stringify(makePayload());
    const sig = signBody(body);

    // Should still return 200 (delivery acknowledged)
    const res = await sendWebhook(14007, body, sig);
    assert.equal(res.status, 200);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.message, 'handler crash');
  });

  it('should support on/off for handler management', () => {
    listener = new WebhookListener({ secret: SECRET });
    const handler = () => {};

    listener.on('alert', handler);
    listener.off('alert', handler);
    // No assertion needed — just verifying it doesn't throw
  });
});
