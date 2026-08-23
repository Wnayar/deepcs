# End-to-end tests — not built yet

Placeholder, deliberately. The e2e layer is designed but deferred.

**The flows to build** are specified in DESIGN.md §11 and ADR-010: Playwright
against `wrangler dev` plus the Firebase Auth emulator, offline, with the
purchase flow's webhook posted and signed by the test itself. Four flows: the
anonymous reader, progress across a session boundary, the purchase journey,
and the degraded-write-path promise.

**When building them,** add a `test:e2e` script to package.json and an e2e
step to `.github/workflows/ci.yml` (after integration). Until then the suite
is unit + integration, both green with no secrets.

Tracked in TODO.md under "before real money".
