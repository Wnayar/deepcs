# ADR-011: Signing in inside the e2e browser

**Status:** Accepted, 2026-08-24. Supersedes the end-to-end tooling line of
ADR-010.

## Context

ADR-010 planned the e2e layer as Playwright against `wrangler dev` plus the
Firebase Auth emulator. By the time it was built, two things had settled that
the emulator does not survive:

- Sign-in is Google and GitHub popups only, no passwords. A popup needs the
  network and a provider account, so no offline browser can complete one.
- The Worker verifies RS256 signatures against a JWKS and rejects everything
  else. The emulator mints unsigned tokens (`alg: none`), so a suite built on
  it can only pass if the Worker stops verifying, which is the one thing the
  suite exists to prove it does.

## Decision

No emulator. A test seeds the Firebase SDK's stored session, the one a
returning reader has restored for them, with a real RS256 token minted from
the committed throwaway key pair by the same helper the integration suite
uses. The Worker verifies it exactly as in production.

## Alternatives considered

| Option | Verdict |
|---|---|
| **Seed the stored session with a real token** | ✅ chosen: the app's own auth path runs, the Worker's verification runs, nothing is faked but Google's login screen |
| Firebase Auth emulator | ❌ its tokens are unsigned; the Worker would have to stop verifying to accept them |
| Add a test-only sign-in to `src/app` | ❌ a door in production code that exists to be walked through |
| Attach the token in a Playwright route handler | ❌ the app would still believe it was signed out, so no signed-in screen would render |
| Real provider sign-in against real accounts | ❌ networked, credentialed, and rate limited by someone else |

## Consequences

The seam depends on how the Firebase SDK stores a session (a JSON blob under
`firebase:authUser:<apiKey>:[DEFAULT]`). An SDK upgrade that changes that
shape breaks the suite loudly, in tests that then show a signed-out screen,
rather than quietly weakening anything.

Two things stay unreachable offline and are covered by the soft launch
instead: real Google and GitHub sign-in, and Stripe's hosted checkout. The
purchase flow therefore resumes at the signed webhook, which is where the
entitlement is actually decided.
