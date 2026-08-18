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

`make up` starts the stack and applies migrations. `make web` runs the frontend
on :5173. `make test` needs the stack up, because the suites use real Postgres
and Redis. `make load` is the six-minute k6 run.

The other way to run it is a local cluster: `make k8s-up` (gateway on :8090, so
both can be up at once), `make k8s-check` for the disruption measurements,
`make k8s-down`. After a code change re-run `make k8s-up`, never `kubectl
apply` — a rebuilt image does not reach the node without `kind load`.

## Project context

Finished, not building. It runs under `docker compose` and on a local
Kubernetes cluster, and there is no deployment. **Docs describe how things work
now**: if you find yourself writing "this used to be X", it belongs in an ADR or
nowhere.

- [docs/system/](./docs/system/) — **read this first.** `00-overview.md` is the
  whole system; `01`–`10` are one page per part, each with that part's failure
  modes, measured numbers and code pointers.
- [docs/adr/](./docs/adr/) — the decisions, one file each, numbered 01–11.
- [docs/learning/](./docs/learning/) — how the tooling works. `explaining-it.md`
  is study material for explaining the system from memory, not documentation of
  it.
- [docs/future/](./docs/future/) — `cost.md`, the exploration that decided
  against deploying.

### Comment style

- Plain sentences, not `->`/`→` arrow-chain shorthand. Write "cursor is the last
  id seen, so this returns rows after it".
- API routes and other non-obvious logic get a short comment above with a
  concrete example, so reading the code teaches how to call it. A line or two.
- Skip citations in comments that explain *what to do*. Save them for comments
  whose whole point is *why* a decision was made.
- **A citation names its document.** `docs/system/08-data.md §6`, never a bare
  `§6`, which is unresolvable from where the reader stands and goes stale
  silently.
- **One fact, one home.** A comment carries the mechanism and the consequence,
  then points at the page. If the same reasoning is in a comment *and* in
  `docs/`, the copy nobody updates is the one in the comment.

### Conventions

**Data**

- **`pg` + hand-written parameterized SQL** (ADR-10). No ORM. Migrations are
  numbered `.sql` in `packages/db/migrations`, applied by `pnpm --filter
  @deepcs/db migrate`. Drizzle is deferred, not rejected; don't add it ad hoc.
- **Every service connects as its own role**, queries fully schema-qualified
  (`users.profiles`). A cross-schema query is a bug the database rejects.
- **Fix content at the source, never at render time.** Wrong stored text means
  changing the seed and re-running the migration. A render-time fix has to be
  remembered everywhere that text appears, and the forgotten place is the one
  nobody looks at.
- **Migrations must be idempotent**, because they get re-applied by hand:
  changing an applied file is a no-op until its `public.schema_migrations` row
  is deleted.

  ```bash
  docker compose exec -T postgres psql -U deepcs -d deepcs \
    -c "DELETE FROM public.schema_migrations WHERE filename LIKE '%012%';"
  DATABASE_URL="postgresql://deepcs:deepcs@127.0.0.1:5432/deepcs" \
    pnpm --filter @deepcs/db migrate
  ```

  Prove it by applying twice and diffing. When a migration edits seeded prose,
  **cut it in SQL** (`split_part`, `substring`) rather than pasting a copy, or
  the same text has two homes. Questions caches the roadmap in Redis for 60s, so
  `redis-cli DEL questions:roadmap` before believing the API.

**Identity and access**

- **`X-User-Id` is set only by the Gateway**, which strips any inbound copy.
  Downstream, absent means *anonymous*, never "skip the check".
- **A name may be shown; a uid never leaves.** The uid is what every service
  keys on, so handing one to a browser lets a client address or impersonate
  somebody. A display name identifies a person to their partner and is good for
  nothing else. Server-asserted, never carried in Yjs awareness, which any peer
  could forge. Cross-service lookups sit under `/internal`, which the Gateway
  proxies nothing to — access control by unreachability, not by a check.
- **Adding an HTTP method means adding it to the Gateway's CORS `methods`.**
  The default is `GET,HEAD,POST`, and a missing method is refused by the
  *browser* in the preflight, so nothing reaches a log and **curl still passes**.
  `frontend/src/cors.test.ts` guards it.

**The browser**

- **Every screen is a URL** (`frontend/src/App.tsx`). *A URL is a promise the
  page can be rebuilt from it*, so a route refetches rather than trusting handed
  state. The exception is `/summary`, which has no endpoint and travels in
  history state. Navigation is `<NavLink className="navlink">`.
- **Interactive elements do not nest.** A `<button>` inside an `<a>`, or an
  `<h3>` inside a `<button>`, is invalid markup React builds through the DOM:
  nothing looks broken, then clicks land unpredictably. Both shipped here. A
  clickable card is a `<button>` containing spans.
- **Colours live in `:root` custom properties only**, so light and dark are two
  lists of variables rather than two stylesheets.
- **No em dashes in anything a reader sees**, including seeded text. A test
  asserts it against the database. Code comments and these docs are exempt.
- **Every poll is bounded on three sides.** HTTP gives a server no way to speak
  first and a held-open response pins a client to one process (ADR-11), so
  clients poll — but only while there is something to wait for, only until they
  give up, and at an interval inside the Gateway's per-user budget. The match
  poll asks `/match/status` every 3s while queued and stops at 60s; Matching
  expires the queue entry at the same age, so both halves end together. An
  unbounded poll kept the database awake for people who were only reading.

**Events and testing**

- **Events go through `@deepcs/shared/events`, never a log line.** Six types,
  one Redis stream, fire-and-forget so stats can never fail a user's request. A
  seventh means `EventType`, the `switch` in `services/stats/src/consumer.ts`,
  and a table keyed so reprocessing changes nothing.
- **Tests use real Postgres and Redis, not mocks**, because the properties under
  test are a Lua script's atomicity and a role being refused a schema.
- **A Redis-backed suite must pass `{ enableOfflineQueue: true }`.** The default
  fails a command issued before the socket is ready, so a `beforeAll` ping
  throws, the suite's `reachable` flag stays false, and every test returns early
  **while reporting as passed**. Both suites were in that state for months. The
  tell is the timing: five tests against real Redis in 11 ms.

**Claims and measurement**

- **Nothing is deployed, and nothing should be.** If a change would reintroduce
  a cloud dependency it is out of scope (ADR-05, priced in `docs/future/cost.md`).
- **Claims have to be checkable.** Load numbers travel with the machine that
  produced them, and the k6 figures are laptop figures. This rule has already
  had to correct a CV draft.
- **Two harnesses, two questions.** `load/` holds 250 sockets and measures edit
  propagation; it *cannot* measure dropped requests, because it sends its HTTP in
  `setup()`/`teardown()`. That is what `k8s/disruption-check.sh` is for. No run
  may make a capacity claim. Zero dropped requests during a rolling update is
  claimable, being a property of the readiness probes.
- **Nothing configures a concurrency limit, so do not describe one.** "250
  sockets" is what one laptop held, not a setting. The only real ceilings are the
  replica count and the rate limiter.
- **`edit_latency` is meaningful only against one Collab replica.** With two, a
  pod re-broadcasts a whole document fetched from Redis and the script counts old
  markers as fresh edits (p95 18.72s against a 5ms median, `edits_received`
  exceeding `edits_sent` as the tell). Check the replica count before quoting it.
- **The cluster is raw YAML in `k8s/`**, no Helm or Kustomize, because the
  directory exists to be read. Results and their conditions are in
  [docs/system/09-running-it.md](./docs/system/09-running-it.md).
