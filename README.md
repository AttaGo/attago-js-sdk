# @attago/sdk

TypeScript SDK for the [AttaGo](https://attago.bid) crypto trading dashboard API.

> **Status**: Under active development. Not yet published to npm.

## Installation

```bash
npm install @attago/sdk
```

## Quick Start

```typescript
import { AttaGoClient } from '@attago/sdk';

// API key auth (scripts, bots)
const client = new AttaGoClient({ apiKey: 'your-api-key' });
const score = await client.agent.getScore('BTC');

// x402 signer auth (anonymous agents)
const client = new AttaGoClient({ signer: yourWalletSigner });
const data = await client.agent.getData(['BTC', 'ETH']);

// Cognito auth (account management)
const client = new AttaGoClient({ email: 'you@example.com', password: '...' });
const subs = await client.subscriptions.list();
```

## License

MIT
