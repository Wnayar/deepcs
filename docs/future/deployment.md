# Deploying DeepCS: the design, and why each piece

**Status: proposal, for vetting.** Nothing here is built. Pricing was checked
2026-08-23 and every figure below carries its source at the bottom; free tiers
move, so re-check before spending a week on this.

The recommendation, up front:

> **One Cloudflare Worker serves the static site and a two-route API. Content
> ships as files in git. Progress lives in D1. Firebase Auth stays.**

That is one vendor for hosting, compute and data, one deploy command, and one
origin. It replaces an earlier sketch of Firebase Hosting + Cloud Run + Neon,
which is worse on the two things that actually decide this: cold-path latency,
and where the free tier runs out.

## What breaks without a decision here

The app has to sit at a URL, cost nothing when nobody visits, and neither fall
over nor generate a bill when somebody does. Those three are in tension, and
almost every "just use X" answer quietly gives up one of them.

So every component below is picked on two questions, asked in this order:

1. **What does its meter do while idle?** The app is idle almost all of the
   time. A component that bills by wall-clock is paying for absence.
2. **What does it do when its ceiling is hit?** A ceiling that refuses service
   is survivable. A ceiling that starts charging is not, because you find out
   from the invoice.

A third question decides ties: **how many things do you have to deploy?**

## The workload, stated before anything is chosen

Nothing below is justifiable without this, so it comes first.

- **Content**: about 420 KB of prose across roughly 30 steps and 10 topics,
  today living in `packages/db/migrations/` as seed SQL. Identical for every
  reader. Changes only when you write more of it.
- **Reads**: anonymous, uncacheable-by-user because there is nothing per-user
  on the read path. This is the overwhelming majority of traffic.
- **Writes**: one upsert when a signed-in reader ticks or stars a step.
  Bounded at about 30 rows per user, forever, because a step is either ticked
  or it is not.
- **Traffic shape**: a portfolio site. Long silences, then a recruiter or a
  friend clicks a link. **The cold path is the common path**, not the worst
  case. Design against that and most of the choices make themselves.

## The shape

```
   anybody with the link
            │
            ▼
   ┌──────────────────────────────────────────────────────────┐
   │  one Cloudflare Worker, one deploy                        │
   │                                                           │
   │   /  /step/*  /topic/*        →  static assets            │
   │   index.html · bundle.js · css   free, unlimited, cached  │
   │   content/roadmap.json           at the edge; the Worker  │
   │   content/lessons/<id>.md        is never invoked         │
   │   content/questions/<id>.json                             │
   │                                                           │
   │   /api/*  (run_worker_first)  →  the Worker script        │
   │     GET  /api/me/progress        verify Firebase ID token │
   │     PUT  /api/me/progress/:id    with jose, uid from sub  │
   └───────────────────────────┬───────────────────────────────┘
                               │  binding, not a socket
                               ▼
                    ┌──────────────────────────┐
                    │  D1 (SQLite)             │
                    │  progress(uid, step_id,  │
                    │    done, starred,        │
                    │    updated_at)           │
                    │  PK (uid, step_id)       │
                    └──────────────────────────┘

   sign-in ──► Firebase Auth (Google/email).  The Worker never talks to
               Firebase; it verifies the token's signature against Google's
               published JWKS, which is a plain HTTPS fetch it caches.
```

**Reading is a file fetch. Writing is a token plus one upsert.** Everything
else in this document is defending those two sentences.

## "Surely the content should come from the database?"

That is the version you were going to build, so build it first and watch it
fail.

A reader opens `/step/abc`. The browser calls the API, the API queries
Postgres for that step's `lesson_md`, and hands back JSON. It works. Now count
what it costs.

- **Every page view becomes a compute invocation and a row read**, for a value
  that is identical for every reader on earth and constant between deploys.
  You are paying, per view, to look up a constant.
- **The database has to be awake for anonymous readers.** This is the one that
  kills it. Neon's free plan suspends compute after 5 idle minutes and gives
  you 100 CU-hours a month, which is 400 hours at the 0.25 CU free-plan size.
  Because visits to a site like this are scattered rather than clustered, each
  isolated visit holds the compute up for the full 5-minute floor. 400 hours
  divided by 5 minutes is about 4,800 such windows a month, or **roughly 160
  scattered visits a day before your database stops answering**. The tell: the
  site works all week and dies on the day it gets shared.
- **Changing a typo becomes a migration.** You edit SQL, keep the file
  idempotent because it gets re-applied by hand, delete a `schema_migrations`
  row, re-run, and bust the Redis cache in front of it. That is the current
  workflow and it is four steps to fix one word.

Ship the content as files instead and all three vanish. Static asset requests
on Workers are free and unlimited and never invoke your code, so reads cost
zero requests and zero rows. Content gets `git diff`, review, and rollback. A
typo is a commit.

**What that costs, in the same breath:** content changes only at deploy time.
There is no admin screen, no editing from a phone. A fix is an edit plus
`wrangler deploy`, which is seconds, but it is a deploy. For prose you write
in an editor and commit anyway, that is the right trade. For content other
people edit, it would be the wrong one.

**And the answers become public.** The reference answers ship as static files,
so anyone can read them without ticking anything, and the dev tools show them
before the "reveal" click. That is fine and it is worth saying why rather than
hoping nobody notices: progress here is self-reported, there is no grade and
no score, so **there is no integrity property to protect**. The consent
machinery that kept answers out of the shared document existed because two
people shared a document. Nobody shares anything now.

### One file, or one file per lesson?

420 KB of prose in the JavaScript bundle means every visitor downloads all 30
lessons in order to read one, on a phone, before anything paints.

So: `content/roadmap.json` once, because the map needs every node to draw
itself, and `content/lessons/<id>.md` fetched when a step is opened. Each is
cached at the edge and then in the browser, so the second visit fetches
nothing. The existing `frontend/src/lesson-sections.ts` already splits a
lesson on its `##` headings at runtime, so the shipped format stays markdown
and that code is untouched.

## Where do the files live?

Compared on what goes wrong, same shape on both sides.

**Cloudflare Workers with static assets** — *chosen.* Static requests are free
and unlimited with no bandwidth meter, and they do not invoke the Worker at
all. The same Worker handles `/api/*` via `run_worker_first`, so the site and
the API are **one origin and one deploy**, and CORS stops existing rather than
being configured. *Goes wrong:* Cloudflare's terms forbid using it to serve
large media, which does not apply to markdown; and you are on one vendor's
edge, so their outage is your outage.

**Firebase Hosting + Cloud Run** — *rejected.* 10 GB of transfer a month free,
then $0.15/GB, so the meter exists and you have to watch it. The API needs a
second product, which means two deploy targets and two dashboards, and the
single-origin story depends on a Hosting rewrite whose Cloud Run region
support you must verify first. *Goes wrong:* over the free transfer limit you
get a bill, not a refusal. That is the wrong direction for a ceiling.

**A GCS bucket + Cloud CDN** — *rejected.* No free tier. Worse, a bucket can
only serve an unknown path as a 404 error page, so a shared `/step/abc` link
returns a 404 status with your app in the body. Every SPA on a bucket has this
bug and it shows up first in link previews and crawlers.

The fail-safe check decides it. **Past Cloudflare's free limit, static assets
keep serving and only `/api/*` returns 429** — the site degrades to read-only.
Past Firebase's, you are billed.

## Where does the API run?

The failure to design against, again: every visit is a cold visit.

**Cloud Run with `min-instances=0`** — *rejected.* A Node container takes
somewhere between 0.5 and 2 seconds to start. Stack a sleeping database
underneath and the first authenticated page load is measured in seconds. The
tell is specific and ugly: the page renders, and your ticks appear a beat
later, every single time, because "every single time" is what
idle-then-visited means here.

**Cloud Run with `min-instances=1`** — *rejected.* No cold start, but you now
pay for all 730 hours in the month whether or not anyone visits, which is
precisely the thing this design exists to avoid.

**A small VM** (Hetzner, Fly, a droplet, about $4–5/month) — *rejected, but it
is the closest call.* No cold start, no runtime restrictions, everything runs
exactly as it does locally, and it is genuinely the simplest thing to reason
about. *Goes wrong:* the meter runs at full price during the 99% of the month
when nobody visits; you own TLS renewal, patching, and backups; and it scales
worst of everything here, because scaling it means building the thing Workers
already is. It is the right answer if the app needed a long-lived process. It
does not, now that collab is gone.

**Cloudflare Workers** — *chosen.* V8 isolates rather than containers, so
there is no image to boot; a request lands in single-digit milliseconds cold.
Free tier is 100,000 requests/day. Verifying a JWT and running one upsert is
on the order of 1–3 ms of CPU.

**What that costs, in the same breath:** the free plan caps CPU at **10 ms per
request**, and it is a real wall. Nothing that does actual work fits — no
image processing, no large render, no PDF. This API does two things and
neither is work, but it means the runtime choice is only correct as long as
the API stays this small. If a future feature needs real compute, this
decision gets revisited rather than worked around.

## Where does progress live?

The workload is about 30 rows per user, upserted, read once per session.

**D1** — *chosen.* SQLite, free at 5M rows read/day, 100k rows written/day and
5 GB. **There is no idle meter at all**: billing is per row, so a month with
no visitors costs nothing without the database needing to sleep first, which
means none of the wake-up latency and none of the compute-hour arithmetic
above. A Worker reaches it through a binding rather than a socket, so the
connection-pool problem that serverless-plus-Postgres is famous for does not
arise. *Goes wrong:* it is SQLite, so no Postgres extensions, no arrays, and
per-database size caps at 500 MB.

The port is small enough to show. Today:

```sql
INSERT INTO users.question_progress (uid, question_id, done, starred)
VALUES ($1, $2, $3, $4)
ON CONFLICT (uid, question_id) DO UPDATE
  SET done = EXCLUDED.done, starred = EXCLUDED.starred, updated_at = now()
```

On D1 that is the same statement with `?` placeholders, `datetime('now')`, and
no schema prefix. SQLite has had this exact upsert syntax, `EXCLUDED`
included, for years. The one Postgres-specific thing in the schema is
`depends_on text[]` on the topics table, and that moves into `roadmap.json`
anyway.

**Neon** — *rejected*, and this reverses the earlier sketch. Real Postgres and
the SQL runs unchanged, which is genuinely attractive. But the compute meter
bills wall-clock with a 5-minute autosuspend floor, so scattered traffic burns
5 minutes of budget per visit no matter how short the visit was. The ceiling
works out around 160 scattered visits a day, and the failure at the ceiling is
that the database stops. **A per-second meter is the wrong meter for a
workload made of isolated single-query visits**, which is the same lesson
`cost.md` reached about WebSockets, applied to a different component.

**Firestore** — *rejected.* No idle meter, generous free tier, works fine. But
it is not SQL, so the existing repository and every statement in it are thrown
away for nothing gained, and the data model becomes vendor-shaped.

**Workers KV** — *rejected.* Eventually consistent. The tell is exact and it
is the worst possible one for this app: you tick a box, reload, and the tick
is gone, then it comes back a minute later.

## How does the API know who is asking?

Firebase Auth stays. It is free to 50,000 monthly active users, the no-cost
Firebase project caps at 3,000 daily active users for standard providers, and
it is already built in `frontend/src/auth.ts`. Nothing about it is tied to
Firebase Hosting.

Verification is vendor-neutral and already written.
`services/gateway/src/auth.ts` uses `jose` to check the token against Google's
published JWKS. That runs on Workers unchanged except for the emulator branch,
which reads `process.env`.

The line that carries the whole thing is the audience check:

```ts
await jwtVerify(token, jwks, {
  issuer: `https://securetoken.google.com/${projectId}`,
  audience: projectId,      // <- this one
  algorithms: ['RS256'],
});
```

Somebody creates their own Firebase project, signs in to it, and sends you
that token. Google signs every project's tokens with the **same** key set, so
the signature verifies, `exp` verifies, and `iss` is the right shape. Without
`audience`, your API accepts it and hands the request whatever uid that
stranger chose. With it, verification fails.

One configuration note that will otherwise cost you an afternoon: the
Cloudflare domain has to be added to Firebase's authorized domains list, or
sign-in fails with `auth/unauthorized-domain`.

## Security

**The read path is public on purpose.** Content, lessons and answers are
static files served to anyone. Covered above: there is no grade, so there is
nothing to protect.

**The write path cannot address another user's data.** The uid comes from the
verified token's `sub`, and **no route accepts a uid as a parameter** — the
paths are `/api/me/progress` and `/api/me/progress/:stepId`. There is no
request a user can craft that names somebody else, so the entire IDOR class
[insecure direct object reference: asking for another user's id and being
given it] is removed by the shape of the API rather than by a check somebody
could forget to write.

**Validate `stepId` against the shipped roadmap.** The Worker already has the
manifest; a step id that is not in it is a 400. Without this a signed-in user
can write unbounded distinct rows, and that is your storage meter and your
write quota both.

**Validate the body with zod**, as `services/users/src/index.ts` already does.
Two booleans.

**There is no secret to leak.** D1 is a binding, not a connection string in an
environment variable. The Firebase API key and project id are public by design
and identify the project rather than authorising anything —
`frontend/src/config.ts` already says so. The old design had a Postgres
password to protect; this one has nothing.

**One origin, so CORS does not exist.** `frontend/src/cors.test.ts` and the
convention about adding methods to the Gateway's CORS list both go away with
the Gateway.

**What none of this fixes:** a stolen token. Firebase ID tokens are valid for
an hour and the SDK refreshes them, so a token lifted off a machine works for
up to an hour and nothing here detects it. The mitigation is not shipping XSS,
which is the same mitigation as before and no stronger. Given what is behind
the token — which boxes somebody ticked on a study roadmap — that residual
risk is accepted rather than solved.

## Rate limiting

The belief to drop first: *"rate limiting needs Redis."* It needed Redis
because several Gateway replicas shared one bucket, and a per-process counter
would have let a user get N times their allowance by landing on different
replicas. There are no replicas sharing anything now.

Three layers, cheapest first:

1. **The token requirement.** Every write route needs a valid Firebase token,
   so anonymous abuse of the write path is not possible and abuse costs an
   account.
2. **One Cloudflare rate limiting rule** on `/api/*`, keyed by client IP over
   a fixed window. The free plan includes exactly one rule, which is exactly
   how many are needed. It runs at the edge, so **a blocked request never
   becomes a billable Worker invocation** — the limiter costs less than the
   thing it is limiting.
3. **The free-tier ceiling itself**, which already fails in the right
   direction: past 100,000 Worker requests in a day, `/api/*` returns 429
   while static assets keep serving. The site becomes read-only for the rest
   of the day rather than going down or billing you.

**What that does not cover:** one signed-in user spread across many IPs. The
IP rule does not see them as one actor. For an app whose most valuable
resource is a boolean, that is accepted. If it ever mattered, a per-uid
counter in a Durable Object is the next step, and it is a billable component
with its own meter, which is why it is not step one.

So: delete `services/gateway/src/rate-limit.ts`, delete Redis, delete the
vendor.

## What does it cost?

| | idle month | realistic month | at the ceiling |
|---|---|---|---|
| Static assets | $0 | $0 | free, unlimited |
| Worker `/api/*` | $0 | ~5k req | 100k req/**day** |
| D1 | $0 | ~4k rows written | 100k writes/day, 5M reads/day |
| Firebase Auth | $0 | $0 | 3,000 DAU (Spark), 50k MAU |
| **Total** | **$0** | **$0** | |

"Idle month: $0" is literal, not rounding. No meter is running: static assets
have no bandwidth charge, the Worker is not invoked, and D1 bills per row
rather than per hour.

The realistic column assumes 5,000 page views, 200 signed-in sessions and
4,000 ticks in a month — comfortably more than this will get. That is 0.2% of
one day's Worker allowance and 4% of one day's D1 write allowance.

**Where it stops being free:** roughly 100,000 API requests in a single day. A
signed-in session is one progress read plus a handful of writes, so call it
15,000 signed-in sessions in a day. Anonymous readers do not count against it
at all, because they never reach the Worker.

**The first bill, if you ever get there:** Workers Paid at $5/month, which
includes 10M requests and 30M CPU-milliseconds, and raises D1 to 25 billion
row reads and 50 million row writes. That is roughly 100x the free ceiling for
$5. The Cloud Run and Neon path has both a lower free ceiling and no
equivalent single cheap step past it.

**The only guaranteed cost in the design** is a domain, about $10/year, and
only if you want one that is not `*.workers.dev`.

## What this costs the repository

Said plainly, because it is the largest cost in the document and it is not
financial.

Making the repo the deployed thing deletes the distributed systems work:
collab, matching, stats, the Gateway, the event log, the Redis usage, the k6
harness, the local Kubernetes cluster, and the multi-schema Postgres with a
role per service. The API that remains is two routes.

The cheap mitigation is a git tag on the commit before the rip-out, say
`v1-distributed`, so the code stays reachable at a permanent URL for no cost
and the README can point at it. The ADRs that describe decisions still worth
reading survive as ADRs; the ones describing deleted machinery go with it.

That is stated as a cost, not an argument against. It is a decision, and it
belongs in an ADR rather than being re-argued here.

## Risks, in the order they will bite

1. **The 10 ms CPU wall.** JWT verification against a cached JWKS should be
   1–3 ms, but "should be" is not a measurement. Deploy a Worker that does
   only the verification and read the CPU time off the dashboard before
   deleting Cloud Run as an option. *Tell:* error 1102, "Worker exceeded CPU
   limit".
2. **The JWKS fetch.** `createRemoteJWKSet` fetches Google's signing keys on
   first use and caches them in memory. A fresh isolate has an empty cache, so
   some requests pay one HTTPS subrequest. Hold the JWKS in module scope so it
   is shared across requests in an isolate, and confirm the added latency is
   acceptable. The 50-subrequest limit is not a concern; the latency might be.
3. **D1's write quota is daily and account-wide.** If you ever run a second
   project on the same account, they share it.
4. **Local development changes shape.** SQLite via `wrangler dev` replaces
   docker compose Postgres, so local and deployed run the same engine, which
   is an improvement. But `make up`, the migration runner, the per-service
   roles and the "tests use real Postgres and Redis" convention all go, and
   the test suites need rewriting against D1.

## Sources

Checked 2026-08-23.

- Cloudflare Workers pricing and limits — https://developers.cloudflare.com/workers/platform/pricing/
- Workers static assets, billing and routing — https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ and https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/
- D1 pricing and limits — https://developers.cloudflare.com/d1/platform/pricing/ and https://developers.cloudflare.com/d1/platform/limits
- Cloudflare rate limiting rules on the free plan — https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices/
- Neon plans and free-plan quotas — https://neon.com/docs/introduction/plans and https://neon.com/faqs/free-plan-limits-and-quotas
- Cloud Run pricing and free tier — https://cloud.google.com/run/pricing
- Firebase Hosting quotas and pricing — https://firebase.google.com/docs/hosting/usage-quotas-pricing
- Firebase Authentication pricing — https://firebase.google.com/pricing
