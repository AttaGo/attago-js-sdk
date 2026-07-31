# Architecture

Subsystems, capabilities, and components. Tracked entities live in
`docs/subsystems/` and `docs/features/` with frontmatter that declares the
Project DAG; this doc is the prose overview.

## Subsystems

ESM-only (`"type": "module"`), ES2024 target, NodeNext resolution, one file
per concern under `src/`:

- **Client core** (`src/index.ts`) — `AttaGoClient` class + re-exports.
  Three mutually exclusive auth modes: `apiKey` (X-API-Key header), `signer`
  (x402 anonymous wallet), `email`/`password`/`cognitoClientId` (Cognito
  JWT). Namespaced services: `client.agent`, `client.data`,
  `client.subscriptions`, `client.payments`, `client.wallets`,
  `client.webhooks`, `client.mcp`, `client.apiKeys`, `client.bundles`,
  `client.push`, `client.redeem` (one module each).
- **Types** (`src/types.ts`) — all TypeScript types for requests/responses.
- **x402** (`src/x402.ts`) — 402 handling and the signer abstraction: a 402
  response is auto-signed and retried.
- **Auth** (`src/auth.ts`) — Cognito REST calls (signup, login, refresh).
- **Webhooks** (`src/webhooks.ts`, `src/webhook-listener.ts`) — CRUD, local
  + server-side test delivery, HMAC-SHA256 `verifySignature`, and
  `WebhookListener`, a local HTTP server emitting `alert`/`test`/`error`
  events.
- **MCP** (`src/mcp.ts`) — JSON-RPC 2.0 client (initialize, listTools,
  callTool, ping).

## Capabilities

- **Conformance**: `npm run test:conformance` replays `attago-spec` fixtures
  against a live API; runs in this repo's CI (which fetches the latest spec)
  and in the spec repo's weekly matrix.
- **Reference lineage**: sibling SDKs (`attago-go-sdk`, `attago-py-sdk`,
  `attago-rb-sdk`) treat this repo as the behavioral reference. Origin plan:
  `attago` repo, `docs/plans/2026-03-07-sdk-plan.md` (Phase 2); design doc
  `docs/plans/2026-03-07-sdk-design.md`.
