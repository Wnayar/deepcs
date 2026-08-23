# ADR-007: The free/paid line, history rewrite, two repos

**Status:** Accepted, 2026-08-23. Executed the same day.

## Context

3 topics free, 7 paid, carried as `access: "free" | "paid"` per topic in
`roadmap.json`. But the code repo is public (used for interviews), and the
content originally sat in seed SQL in public git history. Facts on
2026-08-23: public since 2026-07-22, **zero forks, stars, or watchers**.

## Decision

Rewrite public history to remove every content-bearing file, take the old
repo private, and start the public repo fresh. Keep real content in a private
`deepcs-content` repo that joins the code only at deploy time.

## Alternatives considered

| Option | Effectiveness | Cost | Verdict |
|---|---|---|---|
| **Rewrite history + fresh public repo** | airtight going forward: content absent from tree, history, and SHA access | every SHA changes; the old tag rewritten | ✅ chosen — the zero-fork window made it nearly free, and it closes at launch |
| Soft gate: move content out of the tree, leave history | commercial, not cryptographic: excavatable at an old tag | none | ❌ initially chosen, then superseded |
| Only new content is paid | airtight | nothing to sell at launch | ❌ contradicts the 3-free framing |

## How it was executed

Full history pushed to a private archive first, then `git filter-repo`
stripped seven files across all 147 commits — the six content migrations
present in the tree plus one renamed-away predecessor found by enumerating
every path that ever existed under `migrations/`. Verified: no commit
references a stripped path; a grep for lesson phrases across every revision
returns nothing. The old repo was renamed and made private; v2 began in a new
public repo, so no pre-rewrite object is publicly fetchable.

## Consequences

The one rule that holds the paywall: **real content never enters the public
repo again**, enforced structurally by the split — the public repo carries
only code plus sample fixtures (one fixture topic paid, so the gate is
testable there). Deploy joins the two: the workflow lives in the private repo
(it reads the public one for free; the Cloudflare token lives where no one can
see it). Residual: content spent ~a month public, so a scrape from that
window keeps what it took — accepted, response is a takedown, not a redesign.
