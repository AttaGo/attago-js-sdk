# Testing

## Test Discipline

Unit tests run on Node's built-in runner (`node:test` +
`node:assert/strict`) via tsx — no test framework dependency. CI (`ci.yml`)
runs build + lint (type check) + unit suite on every push. Conformance tests
are a separate script (`npm run test:conformance`) replaying `attago-spec`
fixtures against a live API; CI fetches the latest spec rather than pinning
a copy.

```bash
npm run build             # TypeScript compile
npm test                  # unit suite (node:test via tsx)
npm run lint              # type check only
npm run test:conformance  # conformance against live API
```

## Runner & Baseline

- Runner: `node:test` via tsx (`npm test`)
- Baseline test count: 136 tests / 58 suites, 0 fail (2026-07-31)

## Coverage Policy

Every service module has a unit suite against a local mock; x402, webhook
signature, and error paths are covered explicitly. As the reference
implementation, a behavior change here without tests is a drift risk for
three sibling SDKs — new surface lands with unit tests plus an
`attago-spec` fixture so the siblings inherit a checkable contract, not a
changelog entry.
