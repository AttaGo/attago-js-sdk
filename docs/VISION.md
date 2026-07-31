# Vision

## What & Why

`@attago/sdk` — the TypeScript SDK for the AttaGo crypto trading dashboard
API, and the **reference implementation** among the four hand-written AttaGo
SDKs (TypeScript, Python, Go, Ruby): when a behavioral question arises in a
sibling SDK, this repo plus the `attago-spec` fixtures are the answer.

It gives Node.js agents, bots, and services the full API surface — Go/No-Go
scores, market data, alert subscriptions, payments, wallets, webhooks, and
the MCP JSON-RPC surface — through a zero-dependency ESM client built on
Node 22+ built-ins (fetch, http, crypto).

## Differentiation

- **Reference status**: sibling SDKs match this repo's behavior; changes
  here ripple to three other codebases and must be deliberate.
- **Zero runtime dependencies**: nothing to audit or update below the SDK
  itself; Node's built-ins carry HTTP, crypto, and the test runner.
- Strict TypeScript (`noUncheckedIndexedAccess`, `noUnusedLocals`) — the
  types are part of the product.

## Scope Boundaries

- Not the API: the backend lives in the `attago` repo.
- Not the contract: schemas and fixtures live in `attago-spec`; CI fetches
  the latest spec rather than vendoring it.
- Not a browser bundle: ESM for Node 22+, not a browser/edge distribution.
