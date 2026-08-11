# Firebase Auth instead of self-hosted auth

Context: the first draft built
auth directly — bcrypt, RS256 signing, opaque refresh tokens rotated in Redis.
Decision: buy it. Identity is security-critical, fully solved, and the flows
that make a managed provider worth its integration cost (password reset, OAuth
providers, MFA) are all out of scope (§2) — but so is the *risk* they carry,
and Google's credential-stuffing detection, leaked-password checks and
signing-key rotation are not things a solo project reproduces. Rejected:
self-hosting for the learning value — real, but it's the one component here
with no concurrency or distributed-systems problem inside it, so the learning
is procedural. Tradeoffs accepted: vendor lock-in on identity (mitigated — the
app keys off an opaque `firebase_uid`, so migration is a re-registration flow,
not a rewrite); a revoked token stays valid up to an hour (§6); local dev and
CI depend on the Auth emulator (§7); and login no longer traverses the
Gateway, so its rate limiter no longer protects that endpoint — Google's abuse
controls do instead, which is an upgrade, but it moves part of the threat
surface off this diagram. **An unplanned benefit worth naming:** bcrypt was
the only CPU-bound work anywhere on a request path here, and Node runs all
application JS on one thread, so ~250 ms of hashing would stall every other
request on that instance — buying auth deleted that hazard, and it's part of
why `--concurrency=80` is a safe number (§7). **Deliberately kept:** the
Gateway verifies tokens itself against a JWKS rather than delegating to an
SDK, so the property that mattered — the edge can verify but cannot mint —
survives the switch.
