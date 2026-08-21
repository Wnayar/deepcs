# TODO: the deployment pivot

Decided 2026-08-22, to revisit. **Deploy a simplified DeepCS — roadmap, lessons
and per-user progress — and keep this repo intact as the distributed-systems
artifact.** Collab and matching are cut from the *deployed product*, not from
the repo. Nothing here gets deleted: "built it, measured demand, removed it" is
the story, and it only stays tellable while the code exists. Never phrase it as
"was going to build collaboration" — that undersells and misstates; it was
built, then a survey said users didn't want it.

## Why

- **Survey evidence.** Google Forms results from friends showed no demand for
  pair-solving. Keep the export and the N; "surveyed potential users, X of N
  wanted pairing" is a sentence with a number in it.
- **Resume.** Tailored to the Google new-grad JD: the deployed app ticks web
  development, deploy/maintain, and real users; the repo keeps the
  distributed-systems, testing and measurement evidence. Two bullets, and
  together they tick every row that matters.
- **Cost.** Everything expensive in `docs/future/cost.md` was WebSocket
  duration billing. The simplified shape has no long-lived connection anywhere,
  so it fits entirely inside free tiers. Reversing ADR-05 is legitimate because
  its input changed.

## The design

```
  a browser
     │
     ├── files: HTML, JS, CSS, and the content itself ──►  Firebase Hosting
     │      roadmap.json · lessons/*.md · questions.json    free tier, CDN included
     │      (fetched per lesson, not baked into the bundle)
     │
     └── /api/** — only fired when a signed-in user ticks something
                │
                │   a Hosting rewrite proxies /api/** to Cloud Run,
                │   so it is one origin and CORS stops existing
                ▼
         Cloud Run: one service, ~4 routes
         verify Firebase token in-process · read/write progress
         min-instances=0 · max-instances=1
                │
                ▼
         Neon Postgres: one table
         progress(firebase_uid, lesson_id, ticked, starred, updated_at)
         asleep unless somebody is actively ticking
```

**Content is code, progress is data.** Content changes only at deploy time, so
it ships as static files and the source of truth becomes files in git (the
"fix content at the source" convention, purer). The database holds only what
users create, which after the pivot is progress. An anonymous reader — the
common case — touches nothing metered per-second.

The umbrella principle for every platform choice: the app is idle almost all
of the time, so each component is the one whose meter makes idle cost zero and
whose free-tier ceiling fails safe.

## Why these three (interview defence — name the failure of the alternative)

- **Firebase Hosting.** The frontend is four static files, so hosting means
  handing back a file at a path. Free 10 GB stored + 10 GB/month with CDN and
  HTTPS included; serves `index.html` for unknown paths with a 200 (a bucket
  can only do it as a 404 error page, so shared links lie); the `/api/**`
  rewrite gives one origin and kills CORS; same Firebase project as auth, so
  no new vendor. *Rejected:* GCS bucket + Cloud CDN (no free tier in
  Singapore); serving from Cloud Run (puts every page view on a compute meter).
- **Cloud Run.** Bills wall-clock time with a request open; this API's
  requests are ~50 ms and rare, so idle is literally $0. Runs the Docker image
  unchanged. `max-instances=1` caps the worst case absolutely. *Rejected:* a VM
  (bills all 730 hours a month idle or not); managed Kubernetes (management fee
  plus always-on nodes for a four-route service; k8s stays local per ADR-05).
- **Neon.** Suspends after 5 idle minutes, sleeping is free, wakes itself on
  the next query in under a second; at the free ceiling it suspends instead of
  charging; real Postgres, so the `pg` client, SQL and migrations carry over
  and compose Postgres stays the dev environment. *Rejected:* Cloud SQL (no
  free tier, never sleeps); Supabase (free projects pause after an idle week
  and need a manual resume — a dead demo the day a recruiter clicks);
  Firestore (works, but vendor-shaped data and none of the existing SQL
  reuses); SQLite on the instance (scale-to-zero deletes the filesystem).

## What dies, and why each death is safe

- **Redis/Upstash, the whole vendor.** Its last job was rate limiting, which
  lived in Redis only because multiple replicas shared a bucket. With
  `max-instances=1` an in-memory limiter is correct — or none, since every API
  route requires a valid token and the spend cap bounds the bill.
- **The Gateway.** In front of one service it is just the service. Token
  verification moves in-process.
- **The Stats job.** Was the Neon trap (a query every 5 minutes means the
  database never sleeps). Nothing scheduled remains. Firebase console gives
  user counts free.
- **Polling.** Died with matching. Nothing asks the server anything on a
  timer, so nothing can leak cost while idle.
- **ADR-06's consent machinery.** Answers become self-serve and can sit in the
  static files. Dev tools can see them before "reveal", and that is fine:
  progress was always self-reported, so there is no integrity claim to protect.

## Build list

1. Export the seeded content to static files (roadmap, lessons, questions).
   Verify: exported text diffs clean against the database seed.
2. Frontend: remove or hide the match and collab screens; point content
   fetches at the static files. Verify: the app browses fully with the
   backend down.
3. New progress service: ~4 routes, Firebase token verification (reuse the
   Gateway's), idempotent upserts on `progress` keyed `(uid, lesson_id)`.
   Verify: tick twice, one row.
4. ADR-12: record this pivot; it supersedes ADR-05's "no deployment" because
   the workload that made deployment expensive was cut on survey evidence.
5. Deploy: Firebase Hosting with the SPA and `/api/**` rewrites, Cloud Run
   (min 0, max 1), Neon. Re-read Part 8–9 of `docs/future/cost.md`; most of
   its decisions simplify or vanish.

## Open decision

Does the deployed product include question-bank browsing, or just roadmap +
lessons with each lesson's Key summary questions? Architecture is unchanged
either way (one more static JSON, filtered client-side); it decides how much
gets exported and which screens survive.
