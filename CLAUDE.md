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
minutes: it is the k6 load run against the running stack.

The other way to run it is a local Kubernetes cluster: `make k8s-up` (gateway on
:8090, so compose and the cluster can be up at once), `make k8s-check` for the
rolling-update and pod-kill measurements, `make k8s-down` to delete it. After a
code change re-run `make k8s-up`, not `kubectl apply` — a rebuilt image does not
reach the node without `kind load`, and `k8s-up` does both.

## Project context

The repo is in a finished state, not a building one: it runs locally under
`docker compose` and on a local Kubernetes cluster, and there is no deployment.
Documentation describes how things work now. If you find yourself writing "this
used to be X", it belongs in a decision file or nowhere.

- [docs/system/](./docs/system/) — **read this to understand the repo.**
  `00-overview.md` is the whole system: the six services, what each owns, how a
  request travels through them, and how it is run and tested. Then one page per
  part — `01-gateway` through `06-events-and-stats`, plus `07-frontend`,
  `08-data`, `09-running-it` and `10-the-workspace` (packages, the lockfile and
  every config file) — each holding that part's failure modes, measured numbers
  and code pointers.
- [docs/adr/](./docs/adr/) — the decisions worth knowing, one file each: why the
  split is six services, why a CRDT rather than OT, why identity is bought and
  the gateway is built, why one database with a schema and role per service, and
  why it runs on Kubernetes locally rather than being deployed.
- [docs/learning/](./docs/learning/) — how the tooling works, for reference
  rather than for decisions: Docker, Kubernetes, CI, and the code-level idioms
  this repo leans on. Also `explaining-it.md`, a guide to explaining the system
  from memory rather than to how it works; it is study material, not system
  documentation.
- [docs/future/](./docs/future/) — things not built. `cost.md` is the exploration
  that decided against deploying, and it is the record of what it would cost.

### Comment style

- Plain sentences, not `->`/`→` arrow-chain shorthand. Write "cursor is the
  last id seen, so this returns rows after it," not "cursor=abc → rows after abc."
- API routes and other non-obvious logic (a query, an algorithm) get a short
  comment directly above with a concrete example — e.g. one example request
  above a route handler — so reading the code teaches how to call it. A line
  or two, not a paragraph.
- Skip inline citations (the overview section numbers, ADR numbers) in comments
  that explain *what to do* or *how to call something*. Save citations for
  comments whose whole point is *why* a decision was made.
- **A citation names its document.** `docs/system/08-data.md §6`, never a bare
  `§6` or "the overview §8" — a section number with no document attached is
  unresolvable from where the reader is standing, and it silently goes stale
  when that document is renumbered.
- **One fact, one home.** A comment carries the mechanism and the consequence,
  then points at the page for the rest. If the same reasoning is in a comment
  *and* in `docs/`, the copy nobody updates is the one in the comment. The
  rate-limiter trace and the polling-to-SSE story were each in three or four
  places before this rule.

### Working conventions

- **Postgres access is `pg` + hand-written parameterized SQL** (ADR-10). No ORM.
  Migrations are numbered `.sql` files in `packages/db/migrations`, applied by
  `pnpm --filter @deepcs/db migrate`. Drizzle is deferred, not rejected — it is
  the first item in the additive backlog. Don't introduce it ad hoc.
- **Every service connects as its own Postgres role** and queries are fully
  schema-qualified (`users.profiles`). A query that crosses a schema is a bug the
  database will reject, not a shortcut.
- **`X-User-Id` is set only by the Gateway**, which strips any inbound copy.
  Downstream, absent means *anonymous*, never "skip the check".
- **Shared code uses subpath exports, no barrel** (`@deepcs/shared/db`, not
  `@deepcs/shared`). The reason is in `packages/shared/src/service.ts`.
- **Tests use real Postgres and Redis, not mocks.** CI provides both as service
  containers, and `make test` needs `make up`.

### More conventions

- **Fix content at the source, never at render time.** If stored text is in the
  wrong shape, change the seed and re-run the migration. A fix applied while
  rendering has to be remembered at every place that text is displayed, and the
  place that gets forgotten is the one nobody looks at.
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
  only waiting, and slowing it down enough to afford made the news late. Two
  timers remain and neither is watching for a match: the crash-recovery check in
  `Match.tsx`, which detects a lost pair claim, and the reveal check in
  `Session.tsx`, which runs only in the gap between one consent and the other.
- **Events go through `@deepcs/shared/events`, never a log line.** Six types,
  one Redis stream, appended fire-and-forget so a statistics pipeline can never
  fail a user's request. Adding a seventh means adding it to `EventType`, to the
  `switch` in `services/stats/src/consumer.ts`, and to a table keyed so that
  reprocessing it changes nothing.
- **Nothing is deployed, and nothing should be.** Two ways to run it: `docker
  compose`, and a local `kind` cluster. The reasoning is recorded
  in [docs/adr/05-kubernetes-locally-no-deployment.md](./docs/adr/05-kubernetes-locally-no-deployment.md)
  and priced in [docs/future/cost.md](./docs/future/cost.md). If a change would
  reintroduce a cloud dependency, it is out of scope.
- **Claims about this project have to be checkable**, because the whole repo is
  built on stating what was measured and in which environment. Nothing is
  "deployed" until it is, load numbers travel with the machine that produced
  them, and the k6 figures are laptop figures. This rule has already had to
  correct a CV draft.
- **Two measurement harnesses, and they answer different questions.** `load/` is
  the one k6 script: it holds 250 collaboration sockets and measures edit
  propagation. It *cannot* measure dropped requests, because it sends its HTTP in
  `setup()` and `teardown()` and holds sockets in between, so during a rolling
  update there is nothing in flight to drop. That is what `k8s/disruption-check.sh`
  (`make k8s-check`) is for. No run may make a capacity claim, because every run
  measures this laptop. What a local run can claim is zero dropped requests
  during a rolling update, which is a property of the readiness probes and is
  hardware-independent.
- **Nothing configures a concurrency limit, so do not describe one.** There is
  no per-process request cap on any service; Fastify accepts connections until
  memory or the kernel says otherwise, and the only real ceilings are the
  replica count and the rate limiter. "250 sockets" is what one laptop was shown
  to hold, not a setting. The docs claimed otherwise for a while and disagreed
  with each other about it.
- **`edit_latency` from the k6 script is only meaningful against one Collab
  replica.** With two, a pod opening a room another pod holds asks for state on
  Redis and gets the whole document back, which it re-broadcasts to its own
  sockets; the script stamps timestamps into the text, so it counts re-delivered
  old markers as fresh edits. That put p95 at 18.72s against a 5ms median, with
  `edits_received` exceeding `edits_sent` as the tell. Not a defect. Before
  quoting any latency number, check the replica count.
- **The cluster is raw YAML in `k8s/`**, no Helm and no Kustomize, because the
  directory exists to be read. After a code change re-run `make k8s-up`, not
  `kubectl apply`: a rebuilt image does not reach the node without `kind load`.
  The measured results, and the conditions attached to each, are in
  [docs/system/09-running-it.md](./docs/system/09-running-it.md).
