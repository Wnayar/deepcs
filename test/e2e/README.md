# End-to-end tests

Playwright against `wrangler dev`: the built SPA and free content served as
assets, the real Worker over a real local D1. Offline, no secrets, no
emulator.

```bash
pnpm test:e2e    # builds, applies the local migrations, then runs the flows
```

`playwright.config.ts` starts the server itself on port 8790 (8787 and 8788
are where a person runs the stack by hand), handing the Worker the public
half of `test/fixtures/test-jwks.json` as its JWKS.

**The four flows** (DESIGN.md §11), one file each:

| File | What it pins |
|---|---|
| `reader.spec.ts` | The map opens a topic, a lesson pages through its sections to the key summary; a deep link rebuilds that screen cold; a signed-out reader is refused paid content, on the page and in the bytes. |
| `progress.spec.ts` | A mark made in one page load is still there after a reload, so it reached D1 rather than living in React state. |
| `purchase.spec.ts` | An unpaid reader who opens a Pro lesson lands on the offer, and a test-signed webhook unlocks the lesson for that buyer. |
| `degraded.spec.ts` | Every `/api/*` call failing leaves the free site readable, and a failed write puts the tick back. |

**Verification is never stubbed.** The browser cannot really sign in: the
only doors are the Google and GitHub popups, which need the network and a
provider account. So `session.ts` seeds the session a returning reader would
have restored, carrying a real RS256 token minted from the committed
throwaway key by the same helper the integration suite uses. The Worker
verifies that token exactly as in production, and webhook payloads are
really signed. What the seam skips is Google's login screen, not the trust
boundary.

**What these flows cannot reach:** Stripe's hosted checkout, which needs the
network and a secret key, so the purchase journey resumes at the webhook.
Real Google and GitHub sign-in is out of reach for the same reason; it is
covered by the soft launch in TODO.md.
