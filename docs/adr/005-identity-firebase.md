# ADR-005: Identity — Firebase Auth, verified in-Worker

**Status:** Accepted, 2026-08-23.

## Context

Users need accounts so progress and a purchase have somewhere to live.
Identity is a solved, security-critical problem with no design insight left in
it — the category to buy, not build.

## Decision

Firebase Auth for sign-in and token issuance. The Worker verifies the ID
token in-process with `jose` against Google's published JWKS; it holds no
service-account credential, so nothing in the system can mint a token, only
check one.

## Alternatives considered

| Option | Security ownership | Verdict |
|---|---|---|
| **Firebase Auth** | Google owns credentials, hashing, resets, issuance; free to 50k MAU | ✅ chosen |
| Clerk / Auth0 | vendor; tighter free tiers, steeper cliffs | ❌ buys nothing Firebase does not, needs a new integration |
| Hand-rolled sessions | yours: hashing, resets, breach response | ❌ maximum risk, zero insight — worse now that an account holds a purchase |

## Consequences

The load-bearing check is `audience: projectId`: Google signs every project's
tokens with the same key set, so without it a token minted in a stranger's
project would verify. The JWKS is held in module scope (fetched once per
isolate). A stolen ID token stays valid up to an hour and nothing here detects
it; accepted, because only checkbox state and paid prose sit behind it, never
money. Deploy note: the domain must be on Firebase's authorized-domains list.
