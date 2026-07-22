# DeepCS — Design Doc

> A deliberately lean, production-grade web backend: **real-time collaboration,
> microservices + gateway, auth, rate limiting, and a live cloud deploy** —
> everything else is cut.

**Repo description:** CS fundamentals question bank with real-time
collaborative solving. Practice solo or get matched with someone.

---

## 1. What DeepCS proves

- Real-time collaborative editing (CRDT) with cross-instance sync.
- Microservices behind a custom gateway (JWT verification, routing, rate limiting).
- Stateful auth done properly (JWT + refresh rotation).
- A system that's actually **deployed** at a live URL — the "dev → release → ship" signal.

---

## 2. Product

**Core loop:** sign up → browse/search/filter the question bank and read
answers **solo** → optionally "solve with someone" → join queue by topic +
difficulty → get matched with another waiting user → land in a **shared
scaffolded document** seeded from the question's parts → co-write the answer in
real time with presence + cursors → **mutual-consent reveal** of the reference
answer → end session → see a short summary.

**Domain:** a bank of **multi-part CS fundamentals questions** (OS, networking,
databases, concurrency), sourced from my existing notes repo. Editing is
symmetric, so the CRDT is genuinely load-bearing, and the content is already
owned. The **public browsable question bank** makes the live deploy useful to a
single visitor — matchmaking alone would demo as an empty room.

**In scope:** auth; **public browsable question bank** (search/filter/read
solo); join queue with topic + difficulty preferences; match; shared real-time
**scaffolded session document** with presence; **mutual-consent reference
reveal**; reconnect after disconnect; end session + summary.

**Out of scope:** AI features; mobile; polished UI (minimal functional React
only); payments; social features (friends/leaderboards);
**interviewer/interviewee roles; role swapping; voice/video; rubrics and
scoring; question authoring until Phase 4 matching works (bank capped at ~30
questions).**

---

## 3. Architecture — 3 services

```
            ┌─────────────────────┐
            │   Frontend (React)  │  minimal, static hosting
            └──────────┬──────────┘
                       │
            ┌──────────▼──────────┐
            │      Gateway        │  JWT verify · rate limit · routing · CORS
            └──────────┬──────────┘
             ┌─────────┴─────────┐
        ┌────▼──────┐      ┌─────▼──────┐
        │   Core    │      │   Collab   │
        │  service  │      │  service   │
        │ auth·bank │      │ WS · Yjs   │
        │ matching  │      │ presence   │
        └────┬──────┘      └─────┬──────┘
             │                   │
     ┌───────▼─────┐      ┌──────▼──────┐
     │ PostgreSQL  │      │    Redis    │
     │   (Neon)    │      │  (Upstash)  │
     │ users       │      │ queue       │
     │ questions   │      │ rate limit  │
     │ sessions    │      │ pub/sub     │
     └─────────────┘      │ refresh tok │
                          └─────────────┘
```

**Why 3, not 6 (the defensible microservices answer):** services are split by
**scaling profile and failure domain, not by database table.** Collab is
stateful, WebSocket-heavy, and scales on concurrent connections — a completely
different profile from request/response CRUD, so it earns its own service. The
Gateway is a separate trust/enforcement boundary. Everything else (auth,
question bank, matching) shares a request/response profile and lives in one
**Core** service. "I split by failure domain, not by noun" is a *stronger*
interview answer than "one service per table."

---

## 4. Stack

| Layer | Choice | Why |
|-------|--------|-----|
| All services | TypeScript + Fastify | One language = fast solo iteration. |
| Frontend | React + Vite + TS | Minimal, just enough to demo. |
| Database | PostgreSQL (Neon, free) | Relational + `text[]`/GIN for tag filters + `tsvector` search. |
| Cache/queue/pubsub | Redis (Upstash, free) | Queue, rate-limit state, cross-instance pub/sub, refresh tokens. |
| Real-time | WebSockets + Yjs (CRDT) | Eventual consistency without a central authority; mature library. |
| Container | Docker + docker-compose | Local dev; dev/prod parity. |
| Deploy | Cloud Run (GCP, `asia-southeast1`) | Scale-to-zero, free at this scale, live URL. |
| CI | GitHub Actions | Lint → test → build → deploy on merge. |

---

## 5. Services (brief)

**Gateway** — verifies JWT (RS256, public key cached), injects `X-User-Id` /
`X-Request-Id`, token-bucket rate limiting (Redis Lua, atomic), routes to
downstream, CORS. Custom (not Kong/Traefik) so the rate-limit + auth mechanics
are yours to explain.

**Core** — auth (signup, bcrypt, JWT access + rotating refresh token in Redis);
**question bank** (list/filter/search/paginate, get by id; row shape:
`parts[]`, `reference_md`, `tags text[]`, `difficulty`); matching (reactive:
on join, read Redis queue, filter by compatible topic + difficulty
preferences, atomically claim a pair via Lua, create session row, publish
match event to Redis pub/sub). **The reference answer (`reference_md`) is
served by Core only after the server verifies both session participants
consented to the reveal. It is never sent to the client before that.**

**Collab** — accepts authenticated WebSocket connections; one Yjs document per
session, **seeded from the question's `parts[]`: one heading per part, plus
"## Our answer" and "## Scratch". Not a blank document — the scaffold is what
lets two people work in parallel without colliding. "## Scratch" doubles as
the chat channel, so no chat service is needed.** Presence + cursors via Yjs
awareness; **cross-instance sync via Redis pub/sub channel per session** (edits
flow A → instance 1 → Redis → instance 2 → B); snapshots the Yjs doc to
Postgres every 30s and on disconnect; restores from snapshot on reconnect;
snapshots before SIGTERM. **This is the crown jewel — give it the most care.**

---

## 6. Cross-cutting (kept lean)

- **Auth:** JWT RS256, 15-min access token; opaque refresh token in Redis, 7-day TTL, rotated on use; revoke on logout.
- **Rate limiting:** token bucket via Redis Lua. Per-IP at gateway (unauth), per-user general, tighter per-user on `/match/*`. Returns `X-RateLimit-*` headers. (Be ready to compare token bucket vs sliding vs fixed window.)
- **Input validation:** zod schemas on every endpoint; reject malformed with 400 before business logic. Parameterized queries always.
- **Observability (lean):** structured JSON logs (Pino) with `service` + `request_id` + `user_id`; `/health/live` + `/health/ready` on every service; **one** small metrics view (request rate, error rate, p95, WS connection count). Full OTel/Prom/Grafana/Loki/Tempo tracing is an explicit **stretch, not core**.
- **Security:** HTTPS (Cloud Run free), CORS to one origin, helmet headers, secrets in GCP Secret Manager (never in code/logs), Dependabot.
- **Graceful shutdown:** drain in-flight; Collab snapshots Yjs docs before exit.
- **Idempotency:** queue-join idempotent by `user_id`; session-end idempotent by `session_id`.

---

## 7. Deployment

- **Local:** `docker-compose up` → all 3 services + Postgres + Redis.
- **Prod:** Docker images → GCP Artifact Registry → **Cloud Run** (`asia-southeast1`); Neon + Upstash via env vars; secrets in Secret Manager; frontend on Cloud Storage + CDN. One live URL, accessible from Singapore.
- **CI:** GitHub Actions — on PR: lint + test + build (no push); on merge to main: build → push → deploy to Cloud Run.
### Cost controls (do this BEFORE deploying anything)

GCP has **no native "stop at $X" cap** — budgets are alerts, not limits. A real
hard ceiling is built from the layers below. Set them up in this order; do not
deploy a single service until the kill-switch exists.

**Layer 1 — hard backstop (build first).** Cloud Billing budget → Pub/Sub
notification → Cloud Function that detaches the billing account
(`projects.updateBillingInfo`) when spend crosses the ceiling. This is the only
true stop. Google publishes the sample ("disable billing to stop usage", ~40
lines). Set it at **$20**. Caveat: it's not instant (few-min lag) and it takes
the whole project down — it's a backstop, not the primary control.

**Layer 2 — the real day-to-day cap: Cloud Run flags on every service.** A
runaway bill comes from autoscaling under load/loops/bots. Cap it at the source:
- `--max-instances=2` (or 3) — **the single most important knob.** Hard ceiling
  on concurrent compute no matter what traffic arrives; excess requests queue or
  429, they do not spin up 100 containers.
- `--concurrency=80` — each instance serves many requests instead of scaling out per-request.
- `--min-instances=0` — scale to zero, so idle cost is genuinely ~$0.
- `--timeout` set sane (e.g. 60s) — nothing hangs and bills for minutes.

**Layer 3 — shrink the surface.** Enable ONLY the APIs used (Cloud Run,
Artifact Registry, Secret Manager, Cloud Storage). Every disabled API is a whole
category of bill that can't happen.

**Layer 4 — protect the public URL.** The gateway's token-bucket rate limit also
caps traffic that would drive Cloud Run scaling. Neon (0.5GB) and Upstash (10K
cmd/day) are separate free tiers that throttle rather than overage-bill, so the
stateful layer isn't the risk — Cloud Run is.

**Layer 5 — early warning.** Budget alerts at 50 / 90 / 100% (e.g. $10 / $18 /
$20) — email before the kill-switch fires so you can look first.

Net: `--max-instances` makes a big bill nearly impossible at the source; the
kill-switch guarantees a stop even if a config is fat-fingered. As close to a
hard limit as GCP allows.

**Kubernetes — optional stretch only, NOT core.** If you want the k8s signal
later, add a lean deploy: **raw manifests** (Deployment, Service,
Ingress, ConfigMap/Secret, liveness/readiness probes, optional HPA) on **GKE
Autopilot** — no Helm, no Terraform, no k3d. Tear the cluster down between
demos (GKE has idle cost; Cloud Run doesn't). Adds ~1 week. Write ADR-05 as
"Cloud Run over k8s for scale-to-zero" either way — choosing correctly *is* the
signal.

---

## 8. Testing + the one number

- **Unit:** matching logic, rate-limit token bucket, question-bank filters.
- **Integration:** testcontainers (real Postgres + Redis) for auth flow and match flow.
- **One e2e happy path:** signup → match → collab edit syncs → end.
- **One k6 load run on Collab** for the resume line: *"holds N concurrent WebSocket connections per instance at p95 X ms edit-propagation latency."* This is the headline number.

---

## 9. ADRs (6, one page each)

1. Microservice boundaries by scaling/failure domain, not by table.
2. CRDT (Yjs) over Operational Transforms for collab.
3. Reactive matching with atomic Lua-script pair claim (vs polling loop).
4. JWT with rotating refresh tokens (vs sessions / static refresh).
5. Cloud Run over Kubernetes for scale-to-zero (k8s manifests retained as optional).
6. Role-private and reference data never enters the CRDT; served per-user by
   Core with server-side authorization. A Yjs doc replicates to all peers, so
   the answer key cannot live there.

---

## 10. Build phases

| Phase | Build | Demoable |
|---|---|---|
| 0 | Monorepo, docker-compose (PG+Redis), 2 hello-world Fastify services, CI lint/test, GCP project + billing guard, Neon/Upstash accounts | `docker-compose up` runs |
| 1 | Core: auth (signup/login/JWT), refresh rotation in Redis; Gateway: JWT verify + route + per-IP rate limit | curl signup → login → protected call → refresh |
| 2 | Core: question bank (filter/search/paginate/get) + Redis cache; per-user rate limit; **public bank UI (search, filter, read solo)** | browse and read questions solo, cache hits visible |
| 3 | Core: reactive matching (Redis sorted set + Lua claim), session row, pub/sub match event | two users join → matched → session exists |
| 4 | **Collab (hardest):** WS + Yjs, JWT-auth the socket, cross-instance pub/sub, presence/cursors, snapshot + reconnect, graceful shutdown | two tabs sync live; kill one instance, other keeps working |
| 5 | Minimal React: login, question list, match button, session page (Monaco + Yjs) with **scaffolded editor and the reveal flow**, end | open two browsers, match, collaborate, reveal |
| 6 | Deploy to Cloud Run + frontend to CDN; CI deploys on merge; lean logs + health + one metrics view; k6 load run; README + ADRs + demo GIF | live URL; headline load number in README |

Buffer: things slip — don't add features, use slack to polish README + record a 2-min demo.

---

## README framing

Lead with the real-time architecture, not the content, or the repo reads as a
static site with a chat feature bolted on. Put "open two tabs to try
collaborating" on the session page, next to the demo GIF.

Repo `deepcs`, packages `@deepcs/core`, `@deepcs/gateway`, `@deepcs/collab`.

---

## Final note

Build the Collab service with the most care — it's the piece that says
"real-time distributed systems," and a clean demo (two tabs
syncing, presence, cursors, survive-an-instance-kill) lands harder than any
amount of infrastructure. Everything else here is deliberately boring on
purpose so that one thing can shine.
