# Decisions

Project-wide architectural decision records (ADRs). Append-only. Numbered `D-NNN`.
Each entry carries a `**Status**` (`active` | `superseded` | `deprecated`). When a
decision supersedes another, the predecessor stays in the record — annotated in place
with a `**Superseded by**: D-NNN` back-ref and `**Status**: superseded` — so the
lifecycle is navigable and the current decision is the one that surfaces.

## Decisions

_(Add entries with `cz_add_decision`.)_

### D-001 — This SDK is the reference implementation for the AttaGo SDK family

**Context**: Four hand-written SDKs need one canonical behavioral answer that is not a spec-by-committee.
**Decision**: attago-js-sdk is the complete reference: sibling SDKs (go, py, rb) match its behavior and consult it plus attago-spec fixtures to settle drift questions.
**Consequences**: Changes here are family-wide decisions: a behavior change without a spec fixture silently strands three siblings.
**Evidence**: attago-go-sdk CLAUDE.md (Reference: 'complete reference implementation'); attago repo docs/plans/2026-03-07-sdk-plan.md
**Status**: active (2026-07-31)

### D-002 — Zero runtime dependencies on Node 22+ built-ins, ESM only

**Context**: Node 22+ ships fetch, http, crypto, and a test runner natively; every dependency is an audit and upgrade liability for SDK consumers.
**Decision**: No runtime dependencies; ESM only ('type': 'module', ES2024, NodeNext); tests on node:test + node:assert/strict via tsx.
**Consequences**: Node 22+ floor for consumers; no CommonJS require() support; nothing below the SDK to patch.
**Evidence**: CLAUDE.md (Overview, Code Standards); README.md (Requirements)
**Status**: active (2026-07-31)

### D-003 — Three mutually exclusive auth modes on one client

**Context**: The API serves keyed scripts, anonymous x402 wallet agents, and Cognito account holders.
**Decision**: AttaGoClient accepts exactly one of {apiKey}, {signer}, {email+password+cognitoClientId}.
**Consequences**: Auth intent is explicit per instance; dual-mode callers hold two clients.
**Evidence**: CLAUDE.md (Architecture); README.md (Quick Start)
**Status**: active (2026-07-31)
