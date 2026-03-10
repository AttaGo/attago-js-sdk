# @attago/sdk

[![CI](https://github.com/AttaGo/attago-js-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/AttaGo/attago-js-sdk/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@attago/sdk)](https://www.npmjs.com/package/@attago/sdk)

TypeScript SDK for the [AttaGo](https://attago.bid) crypto trading dashboard API.

Zero runtime dependencies. Node.js 22+ required.

## Installation

```bash
npm install @attago/sdk
```

## Quick Start

### API Key (scripts, bots, CI)

```typescript
import { AttaGoClient } from '@attago/sdk';

const client = new AttaGoClient({ apiKey: 'ak_live_...' });

// Get a single asset score
const score = await client.agent.getScore('BTC');
console.log(score.composite.signal); // 'GO' | 'NO-GO' | 'NEUTRAL'

// Get all market data
const data = await client.agent.getData(['BTC', 'ETH']);
console.log(data.assetOrder); // ['BTC', 'ETH']
```

### x402 Signer (anonymous wallet agents)

```typescript
import { AttaGoClient } from '@attago/sdk';

const client = new AttaGoClient({
  signer: {
    address: '0x...',
    network: 'eip155:8453', // Base
    sign: async (requirements) => {
      // Sign x402 payment with your wallet
      return signedPaymentBase64;
    },
  },
});

// 402 responses are auto-signed and retried
const score = await client.agent.getScore('BTC');
```

### Cognito (account management)

```typescript
import { AttaGoClient } from '@attago/sdk';

const client = new AttaGoClient({
  email: 'you@example.com',
  password: 'your-password',
  cognitoClientId: 'your-client-id',
});

// Manage subscriptions
const subs = await client.subscriptions.list();
await client.subscriptions.create({
  tokenId: 'BTC',
  label: 'BTC spot bullish',
  groups: [[{ metricName: 'spot_score', thresholdOp: 'gt', thresholdVal: 5 }]],
});

// Check billing status
const status = await client.payments.status();
```

## API Reference

### Agent

| Method | Description | Auth |
|--------|-------------|------|
| `client.agent.getScore(symbol)` | Single asset Go/No-Go score | API key or x402 |
| `client.agent.getData(symbols?)` | Full market data for all or filtered assets | API key or x402 |

### Data

| Method | Description | Auth |
|--------|-------------|------|
| `client.data.getLatest()` | Latest tiered data snapshot | API key or JWT |
| `client.data.getTokenData(token)` | Single token data | API key or JWT |
| `client.data.getDataPush(requestId)` | 72h data-push snapshot | None |

### Subscriptions (alerts)

| Method | Description | Auth |
|--------|-------------|------|
| `client.subscriptions.catalog()` | Available tokens, metrics, tier limits | API key or JWT |
| `client.subscriptions.list()` | User's active subscriptions | API key or JWT |
| `client.subscriptions.create(opts)` | Create a new alert | API key or JWT |
| `client.subscriptions.update(id, opts)` | Update an alert | API key or JWT |
| `client.subscriptions.delete(id)` | Delete an alert | API key or JWT |

### Payments

| Method | Description | Auth |
|--------|-------------|------|
| `client.payments.subscribe(opts)` | Purchase a tier (x402 in live mode) | API key or JWT |
| `client.payments.status()` | Current tier, expiry, push usage | API key or JWT |
| `client.payments.upgradeQuote(tier, cycle)` | Pro-rated upgrade quote | API key or JWT |

### Wallets

| Method | Description | Auth |
|--------|-------------|------|
| `client.wallets.register(opts)` | Verify + register a wallet | API key or JWT |
| `client.wallets.list()` | List verified wallets | API key or JWT |
| `client.wallets.remove(address)` | Remove a wallet | API key or JWT |

### Webhooks

| Method | Description | Auth |
|--------|-------------|------|
| `client.webhooks.create(url)` | Register a webhook (Pro+) | API key or JWT |
| `client.webhooks.list()` | List webhooks (secrets stripped) | API key or JWT |
| `client.webhooks.delete(id)` | Remove a webhook | API key or JWT |
| `client.webhooks.sendTest(opts)` | SDK-side test delivery (local) | None |
| `client.webhooks.sendServerTest(id)` | Server-side test delivery | API key or JWT |

### MCP (Model Context Protocol)

| Method | Description | Auth |
|--------|-------------|------|
| `client.mcp.initialize()` | Negotiate protocol version | None |
| `client.mcp.listTools()` | Discover tools + pricing | None |
| `client.mcp.callTool(name, args)` | Execute a tool | x402 for paid tools |
| `client.mcp.ping()` | Health check | None |

### Other

| Method | Description | Auth |
|--------|-------------|------|
| `client.apiKeys.create(name)` | Create API key (JWT only) | JWT |
| `client.apiKeys.list()` | List API keys | API key or JWT |
| `client.apiKeys.revoke(id)` | Revoke an API key | API key or JWT |
| `client.bundles.list()` | List bundles + catalog | API key or JWT |
| `client.bundles.purchase(opts)` | Buy data-push credits | API key or JWT |
| `client.push.list()` | List push subscriptions | API key or JWT |
| `client.push.create(opts)` | Register push subscription | API key or JWT |
| `client.push.delete(id)` | Remove push subscription | API key or JWT |
| `client.redeem.redeem(code)` | Activate a redemption code | API key or JWT |

## Webhook Listener

Built-in HTTP server for receiving webhooks with HMAC-SHA256 verification:

```typescript
import { WebhookListener } from '@attago/sdk';

const listener = new WebhookListener({
  secret: 'wh_secret_from_creation',
  port: 4000,
});

listener.on('alert', (payload) => {
  console.log(`${payload.alert.token} ${payload.alert.state}`);
  // Fetch the full data snapshot
  const data = await client.data.getDataPush(extractRequestId(payload.data.url));
});

listener.on('test', (payload) => {
  console.log('Test delivery received!');
});

listener.on('error', (err) => {
  console.error('Listener error:', err);
});

await listener.start();
```

## Webhook Test Delivery

Verify your webhook receiver works before going live:

```typescript
// SDK-side test (local, no server involvement)
const result = await client.webhooks.sendTest({
  url: 'https://example.com/webhook',
  secret: 'wh_secret_from_creation',
  token: 'BTC',
  state: 'triggered',
});
console.log(result.success); // true if 2xx response

// Server-side test (through production pipeline)
const serverResult = await client.webhooks.sendServerTest('webhook-id');
```

## Signature Verification

For custom webhook receivers (without the built-in listener):

```typescript
import { verifySignature } from '@attago/sdk';

// In your Express/Fastify/etc. handler:
const isValid = verifySignature(
  rawBody,        // raw request body (string or Buffer)
  webhookSecret,  // from webhook creation
  req.headers['x-attago-signature'],
);
```

## Error Handling

```typescript
import { ApiError, PaymentRequiredError, RateLimitError } from '@attago/sdk';

try {
  await client.agent.getScore('BTC');
} catch (err) {
  if (err instanceof PaymentRequiredError) {
    // 402 — payment needed (x402 signer handles this automatically)
    console.log(err.paymentRequirements);
  } else if (err instanceof RateLimitError) {
    // 429 — wait and retry
    console.log(`Retry after ${err.retryAfter} seconds`);
  } else if (err instanceof ApiError) {
    // Other HTTP errors
    console.log(`${err.status}: ${err.message}`);
  }
}
```

## Requirements

- Node.js 22+
- Zero runtime dependencies
