# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## Project context

- [DESIGN.md](./DESIGN.md) — the architecture and reasoning; every other doc cites it by section
- [docs/phases/0-repo-tour.md](./docs/phases/0-repo-tour.md) — what every file in the repo is for
- [docs/phases/0-prebuild-decisions.md](./docs/phases/0-prebuild-decisions.md) — decisions already made, with the reasoning, before re-litigating one
- [docs/phases/1-auth-and-gateway.md](./docs/phases/1-auth-and-gateway.md) — how auth, the rate limiter and the schema boundary work, and how to demonstrate each
- [docs/phases/2-questions-bank.md](./docs/phases/2-questions-bank.md) — the question bank: cursor pagination, the read-through cache, and why `reference_md` never reaches a browser

### Comment style

- Plain sentences, not `->`/`→` arrow-chain shorthand. Write "cursor is the
  last id seen, so this returns rows after it," not "cursor=abc → rows after abc."
- API routes and other non-obvious logic (a query, an algorithm) get a short
  comment directly above with a concrete example — e.g. one example request
  above a route handler — so reading the code teaches how to call it. A line
  or two, not a paragraph.
- Skip inline citations (DESIGN.md section numbers, ADR numbers) in comments
  that explain *what to do* or *how to call something*. Save citations for
  comments whose whole point is *why* a decision was made.

### Working conventions established in phase 1

- **Postgres access is `pg` + hand-written parameterized SQL** (ADR-10). No ORM.
  Migrations are numbered `.sql` files in `packages/db/migrations`, applied by
  `pnpm --filter @deepcs/db migrate`. Drizzle is deferred, not rejected — it is
  item 1 in DESIGN.md §10's additive backlog. Don't introduce it ad hoc.
- **Every service connects as its own Postgres role** and queries are fully
  schema-qualified (`users.profiles`). A query that crosses a schema is a bug the
  database will reject, not a shortcut.
- **`X-User-Id` is set only by the Gateway**, which strips any inbound copy.
  Downstream, absent means *anonymous*, never "skip the check".
- **Shared code uses subpath exports, no barrel** (`@deepcs/shared/db`, not
  `@deepcs/shared`). The reason is in `packages/shared/src/service.ts`.
- **Tests use real Postgres and Redis, not mocks** (§8). CI provides both as
  service containers.
