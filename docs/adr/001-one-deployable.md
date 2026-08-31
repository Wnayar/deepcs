# ADR-001: One deployable, not many

**Status:** Accepted, 2026-08-23.

## Context

The workload (DESIGN.md §2) is a portfolio-scale reader site: mostly
anonymous reads, rare small writes, a few purchases. It has no component with
a scaling profile of its own and no long-lived connection anywhere.

## Decision

Ship one Cloudflare Worker plus static assets — one script, two tables, one
deploy.

## Alternatives considered

| Option | Idle cost | Complexity | Failure surface | Verdict |
|---|---|---|---|---|
| **One Worker + static assets** | $0 — nothing exists between requests | ~7 routes, 2 tables, 1 deploy | one vendor's edge, one script | ✅ chosen |
| Several independent services | each bills or idles separately | many images, a gateway, a service-to-service auth boundary, shared Redis | a request chained across processes; nothing the product needs justifies it | ❌ |
| Modular monolith on a VM | ~$4–5/mo at full price during the 99% idle | one process, but TLS, patching, backups are yours | unpatched box, disk full, cert expiry | ❌ pays for absence |
| Serverless function per route | $0 idle | many functions to version and deploy coherently | split-brain deploys | ❌ these routes do not need independent deployment |

## Consequences

With no replicas, everything that existed only to coordinate replicas is
unnecessary: a shared rate-limit bucket, cross-instance pub/sub, a gateway as
the trust boundary. Per-uid rate limiting instead lives in the one Worker
(ADR-008).
