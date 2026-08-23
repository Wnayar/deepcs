# ADR-003: Content ships as static files in git

**Status:** Accepted, 2026-08-23.

## Context

Content is ~420 KB of prose (10 topics, ~30 lessons, the question bank),
identical for every reader of a tier and changing only when the author writes
more. It is code, not data.

## Decision

Ship content as files in git, split by tier at build time:
`content/roadmap.json` and free lessons/questions to public asset paths; paid
lessons/questions under `/content/paid/*`, served only through the Worker's
entitlement gate.

## Alternatives considered

| Option | Read cost per view | Fixing a typo | Idle requirement | Verdict |
|---|---|---|---|---|
| **Files in git as static assets** | free tier $0 (edge cache); paid tier one Worker request then the file | a commit + deploy | none | ✅ chosen |
| Content in the DB behind the API | a compute invocation + row reads, per view, for a constant | edit SQL, bust cache — several steps | the DB must be awake for anonymous readers | ❌ |
| Headless CMS | a fetch or build-time pull | a web UI | another vendor, auth, ceiling | ❌ solves non-git editors, a problem this project does not have |

## Consequences

Content changes require a deploy — the right trade for prose written in an
editor anyway. Free reference answers are public files, which is fine because
progress is self-reported (no integrity property to protect). Paid answers
never appear in any public file. `lesson-sections.ts` splits markdown on `##`
headings at runtime, so the shipped format stays plain markdown.
