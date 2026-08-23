# ADR-004: Database — D1 (SQLite)

**Status:** Accepted, 2026-08-23.

## Context

The entire persistent state is which steps a uid has ticked or starred (~30
rows per user) and who has paid (at most one row per user). Tiny, write-rare,
and scattered single-query visits — so the meter, not the feature set,
decides.

## Decision

Cloudflare D1. Reached through a binding, no connection string, no pool.

## Alternatives considered

| Option | Idle meter | Wake-up | At the ceiling | Verdict |
|---|---|---|---|---|
| **D1 (SQLite)** | none — bills per row, so a silent month is $0 | none | 5M reads/day, 100k writes/day, then refused | ✅ chosen |
| Neon (Postgres) | 100 CU-hours/mo ≈ 400 awake-hours; suspends after 5 idle min | sub-second, but each scattered visit burns the 5-min floor → ~160 visits/day then the DB stops | suspension mid-month | ❌ a per-hour meter is wrong for isolated single-query visits |
| Firestore | none | none | generous | ❌ not SQL; the data becomes vendor-shaped for nothing gained |
| Workers KV | none | none | generous | ❌ eventually consistent: tick a box, reload, it is gone, then returns |

## Consequences

SQLite limits (no Postgres extensions, no arrays; the one array in the old
schema moved into `roadmap.json`). No server to keep up: the data is bytes in
Cloudflare's replicated storage, queries run on demand, nothing can be "down"
independently of Cloudflare. Entitlements are a cache of Stripe's ledger and
rebuildable from it (ADR-006), so losing the table is an inconvenience, not a
broken promise.
