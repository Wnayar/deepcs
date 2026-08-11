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

## Running it

`make up` starts the stack and applies migrations (compose has a one-shot
`migrate` service every other service waits on). `make web` starts the frontend
on :5173. `make test` needs the stack up, because the suites use real Postgres
and Redis rather than mocks. `make load` needs it up too, and takes about six
minutes: it is the phase 7 k6 run against the running stack.

## Project context

- [DESIGN.md](./DESIGN.md) — the architecture and reasoning; every other doc cites it by section
- [docs/phases/0-repo-tour.md](./docs/phases/0-repo-tour.md) — what every file in the repo is for
- [docs/phases/0-prebuild-decisions.md](./docs/phases/0-prebuild-decisions.md) — decisions already made, with the reasoning, before re-litigating one
- [docs/phases/1-auth-and-gateway.md](./docs/phases/1-auth-and-gateway.md) — how auth, the rate limiter and the schema boundary work, and how to demonstrate each
- [docs/phases/2-questions-bank.md](./docs/phases/2-questions-bank.md) — the question bank: cursor pagination, the read-through cache, and why `reference_md` never reaches a browser
- [docs/phases/3-matching.md](./docs/phases/3-matching.md) — the atomic pair claim, why external calls run before any mutation, and idempotent join/retry
- [docs/phases/4-collab.md](./docs/phases/4-collab.md) — collab: why two instances have to agree on a document's *identity* and not just its text, the pre-await frame queue, and snapshot/reconnect
- [docs/phases/5-frontend.md](./docs/phases/5-frontend.md) — the React app, and the reveal rule: why the answer and the authority to release it live in different services
- [docs/phases/5b-roadmap.md](./docs/phases/5b-roadmap.md) — the roadmap that replaced Learn and the bank, and the standing rule it came from: fix content in the seed, never at render time
- [docs/phases/6-events.md](./docs/phases/6-events.md) — the event log: why acking after the commit is the whole safety argument, and the two different ways an event is made safe to reprocess
- [docs/phases/7-load-and-soak.md](./docs/phases/7-load-and-soak.md) — the load run: why edit latency is read at the partner and not the sender, and which of its numbers a laptop is allowed to claim
- [docs/cost.md](./docs/cost.md) — the cost exploration that decided this project stays local: how cloud billing meters actually work, why an open WebSocket rather than a page view is what spends the budget, and every line item priced in one table
- [docs/frontend.md](./docs/frontend.md) — how the frontend works from nothing: the empty HTML shell, what the build actually produces, the two backends the browser talks to, and the three rules that break in a browser but not in curl

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

### Working conventions established later

- **Fix content at the source, never at render time.** If stored text is in the
  wrong shape, change the seed and re-run the migration. A fix applied while
  rendering has to be remembered at every place that text is displayed, and the
  place that gets forgotten is the one nobody looks at. This rule is why
  `frontend/src/reference.ts` no longer exists; see
  [docs/phases/5b-roadmap.md](./docs/phases/5b-roadmap.md) thing 1.
- **No em dashes in anything a reader sees**, including seeded lesson and
  question text. A test asserts this against the database. Code comments and
  these docs are exempt.
- **Colours live in `:root` custom properties only.** No component names a
  colour, so light and dark are two lists of variables rather than two
  stylesheets.
- **Every screen is a URL** (`react-router`, `frontend/src/App.tsx`). The rule a
  new route is held to: *a URL is a promise that the page can be rebuilt from
  it*, so a route refetches rather than relying on state it was handed. The one
  exception is `/summary`, which is assembled from what the session page knew
  and has no endpoint behind it, so it travels in history state and a refresh
  goes to the roadmap. Navigation is `<NavLink className="navlink">`, never a
  `<button>` inside it.
- **Interactive elements do not nest.** A `<button>` inside an `<a>`, or an
  `<h3>` inside a `<button>`, is invalid markup: React builds it through the DOM
  so nothing visibly breaks, and then clicks land unpredictably and assistive
  tech reads it wrong. Both shipped here before being caught. A clickable card
  is a `<button>` containing spans.
- **Editing a seeded migration means re-applying it by hand.** Migrations are
  recorded in `public.schema_migrations`, so changing an already-applied file is
  a no-op until its row is deleted:

  ```bash
  docker compose exec -T postgres psql -U deepcs -d deepcs \
    -c "DELETE FROM public.schema_migrations WHERE filename LIKE '%009%';"
  DATABASE_URL="postgresql://deepcs:deepcs@127.0.0.1:5432/deepcs" \
    pnpm --filter @deepcs/db migrate
  ```

  The seeds are written to be re-runnable (`ON CONFLICT DO UPDATE`) precisely so
  this is safe. Questions caches its list in Redis for 60s, so also
  `redis-cli DEL questions:roadmap` or wait a minute before believing the API.

- **The browser is told, not asked.** A client that needs to know about an event
  another user caused subscribes to `GET /match/events` rather than polling.
  Polling kept the database awake and every service warm for people who were
  only waiting, and slowing it down enough to afford made the news late. The one
  remaining timer is the crash-recovery check in `Match.tsx`, which detects a
  lost pair claim, not a match.
- **Events go through `@deepcs/shared/events`, never a log line.** Six types,
  one Redis stream, appended fire-and-forget so a statistics pipeline can never
  fail a user's request. Adding a seventh means adding it to `EventType`, to the
  `switch` in `services/stats/src/consumer.ts`, and to a table keyed so that
  reprocessing it changes nothing.
- **Phase numbers are identities, not positions.** They are cited by every doc,
  comment and commit message, so a reordering moves the sequence and leaves the
  numbers alone. Phases 0 to 7 were built in numeric order.
- **The project ends at phase 8, and nothing is deployed.** Phase 8 is
  Kubernetes locally and it is the last phase. The repo was stripped of
  deployment material on 2026-08-12: no cloud provider, no hosted anything, two
  ways to run it (docker compose, and `kind`). The deployment reasoning survives
  in DESIGN.md §7, ADR-05 and [docs/cost.md](./docs/cost.md), which is the
  exploration that produced the decision rather than a plan waiting to be
  executed. If a change would reintroduce a cloud dependency, it is out of
  scope.
- **Claims about this project have to be checkable**, because the whole repo is
  built on stating what was measured and in which environment. Nothing is
  "deployed" until it is, load numbers travel with the machine that produced
  them, and the k6 figures are laptop figures. This rule has already had to
  correct a CV draft.
- **The k6 script is written once, in phase 7, and re-run in phase 8** during a
  rolling update and a pod kill. No run here may make a capacity claim, because
  every run measures this laptop. What a local run can claim is zero dropped
  requests during a rolling update, which is a property of the readiness probes
  and is hardware-independent.
