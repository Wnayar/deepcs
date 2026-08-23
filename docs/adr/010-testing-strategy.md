# ADR-010: Testing — the pyramid and its tooling

**Status:** Accepted, 2026-08-23.

## Context

A test suite should be a pyramid — many fast unit tests, fewer integration
tests, a handful of end-to-end flows — and every test should pin a specific
way the system can fail. A coverage target does the opposite: it pushes effort
toward whatever is easiest to cover, rarely where a system breaks.

## Decision

- **Unit** (Vitest): pure logic with no I/O — layout, section splitting,
  markdown, the access-policy matrix, token-claims policy, webhook-signature
  verification, the content validators.
- **Integration** (`@cloudflare/vitest-pool-workers`): the real Worker in
  workerd, the production runtime, against a real local D1 with the real
  migrations. No coverage target.
- **End-to-end** (Playwright): a few whole-stack flows against `wrangler dev`
  and the Firebase emulator, offline, no cloud credentials.

## Alternatives considered

For the integration layer:

| Option | Fidelity | Verdict |
|---|---|---|
| **vitest-pool-workers** | the actual Worker, SQLite engine, and asset config, in-process | ✅ chosen |
| Mock the D1 binding | a mock only agrees with itself | ❌ would pass the bug the test exists to catch |
| A deployed preview | production-true but networked, credentialed, flaky, offline-hostile | ❌ as the suite; a post-deploy smoke ping is fine |

Playwright over Cypress: first-class multi-browser, no proprietary runner,
trivially CI-parallel.

## Consequences

**Verification is never stubbed.** Integration and unit tests mint real RS256
tokens against a committed throwaway key pair and really-sign webhook payloads;
the Worker verifies both exactly as in production. Because verification code
is what a mock would fake, faking it would test nothing. CI runs unit +
integration on the sample fixtures with zero secrets; the private content
repo's deploy re-runs the content validators against real content.
