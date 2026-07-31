# Invariants

Rules that hold across all work. Append-only. Numbered `INVARIANT-NN`.

## Invariants

_(Add entries with `cz_add_invariant`.)_

### INVARIANT-01 — Zero runtime dependencies: package.json never gains a runtime dep — Node 22+ built-ins (fetch, http, crypto) carry everything.
**Introduced by**: CLAUDE.md (Code Standards); README.md (Requirements)
**Audience**: engineering

Zero runtime dependencies: package.json never gains a runtime dep — Node 22+ built-ins (fetch, http, crypto) carry everything.

### INVARIANT-02 — ESM only — 'type': 'module', ES2024 target, NodeNext resolution; no CommonJS surface is published.
**Introduced by**: CLAUDE.md (Architecture)
**Audience**: engineering

ESM only — 'type': 'module', ES2024 target, NodeNext resolution; no CommonJS surface is published.

### INVARIANT-03 — Incoming webhook payloads are authenticated ONLY by HMAC-SHA256 over the raw body against the x-attago-signature header (verifySignature); failed verification is a rejection.
**Introduced by**: README.md (Signature Verification)
**Audience**: engineering

Incoming webhook payloads are authenticated ONLY by HMAC-SHA256 over the raw body against the x-attago-signature header (verifySignature); failed verification is a rejection.

### INVARIANT-04 — Behavior changes land with an attago-spec fixture: as the reference implementation, an untested behavior change here strands the go/py/rb siblings.
**Introduced by**: attago repo docs/plans/2026-03-07-sdk-plan.md; CLAUDE.md (Spec conformance)
**Audience**: engineering

Behavior changes land with an attago-spec fixture: as the reference implementation, an untested behavior change here strands the go/py/rb siblings.
