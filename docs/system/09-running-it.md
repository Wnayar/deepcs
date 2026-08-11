# Running it, and what the numbers mean

Two ways to run DeepCS, and neither of them is deployed. `docker compose` is the
one to develop against. A local Kubernetes cluster is the one that answers the
question compose cannot: what happens to the people using it while a service is
being replaced.

This page is how to run both, what was measured on each, how the two measurement
harnesses work, and — the part that matters more — which of those measurements
are claims about DeepCS and which are claims about this laptop.

---

## 1. Compose

```bash
make up      # Postgres, Redis, the Auth emulator, six services
make web     # the frontend on http://localhost:5173
make test    # the suites, against the real Postgres and Redis
make load    # the k6 load run, about six minutes
```

`up` and `web` are separate on purpose: `up` is a long-running Docker stack you
start once and leave alone, `web` is a Vite server you restart constantly.
Running both from one target would mean stopping the database to restart the UI.

`make up` also migrates. Compose runs a one-shot `migrate` service that every
other service waits on, so no service can race a half-migrated database. The
separate `make migrate` target is for the case that does not cover: adding a
migration while the stack is already running.

`make test` needs the stack up. The suites use real Postgres and Redis rather
than mocks, which is a deliberate choice recorded in
[`00-overview.md`](00-overview.md) §8 — the permission-denied tests in
particular assert that the *database* refuses a cross-schema query, and a mock
cannot refuse anything.

Source is bind-mounted, so an edit to a `.ts` file reloads without a rebuild.
This is why compose is the development target and the cluster is not.

## 2. The cluster

```bash
make k8s-up     # the whole stack on a kind cluster, gateway on :8090
make k8s-check  # the disruption measurements
make k8s-down   # delete the cluster
```

Different port from compose (8090 against 8080) so both can be up at once and
compared without tearing one down.

**What it is.** One `kind` node — a Docker container with containerd inside it,
running a real Kubernetes cluster. Inside: fifteen pods in the `deepcs`
namespace (two each of the six services, plus Postgres, Redis and the Auth
emulator) and an ingress-nginx controller in its own. Raw YAML in
[`k8s/`](../../k8s/), no Helm. How each object works is
[`../learning/kubernetes.md`](../learning/kubernetes.md); this page is what it
does.

**What differs from compose**, and each difference is deliberate:

- It runs the `runner` images: bundled `dist/`, production dependencies only,
  non-root. Not the `dev` images with `tsx watch` and a bind mount.
- Two replicas of every service instead of one. That is the prerequisite for
  everything in §4 — a single pod cannot be replaced without a gap.
- No persistence anywhere. Postgres has no volume and Redis has saving turned
  off. `make k8s-up` re-runs the migration and the seeds every time, so a volume
  could only let one run inherit half of a previous one.
- Only the Gateway is reachable from outside. The other five are ClusterIP, and
  that is half of what makes `X-User-Id` unforgeable: the Gateway strips any
  inbound copy before setting its own, and there is no second door.

**The ordering in `k8s/up.sh` is the script.** Kubernetes has no equivalent of
compose's `depends_on: service_completed_successfully`, and the failure that
absence causes is quiet rather than loud: a service started before the migration
would come up happily, pass its readiness probe (which is `SELECT 1`, and
succeeds against an empty database), and serve queries against tables that do
not exist. So the script applies the data tier, waits, runs the migration Job,
waits for it to complete, and only then applies the services.

**`make k8s-up` is idempotent.** Run against a cluster that already exists it
reuses it, rebuilds and reloads the images, and rolls the services. A second run
took **1m50s**. The first run on a clean machine is five to ten minutes, nearly
all of it building images and pulling the ingress controller.

**After a code change, re-run `make k8s-up`, not `kubectl apply`.** An image
rebuilt on your laptop does not reach the node on its own; it needs
`kind load docker-image`, and `k8s-up` does both.

---

## 3. The environment every number below was measured on

Half of any load figure is the machine, so here is the machine.

| | |
|---|---|
| CPU / RAM | AMD Ryzen AI 7 350, 16 threads, 15 GiB |
| OS | WSL2, kernel 6.6.87.2 |
| Docker | 29.4.2 |
| kind / node image | v0.33.0-alpha / `kindest/node:v1.36.1` |
| kubectl | v1.34.1 |
| ingress-nginx | v1.13.3 |
| cluster | one node, fifteen pods in `deepcs` |
| service images | 278 MB each; the Auth emulator is 1.17 GB (a JVM) |
| measured | 2026-08-11 |

---

## 4. Does a rolling update drop requests?

**No. Zero out of 1,230.**

`make k8s-check` sends a steady stream of authenticated requests through the
Ingress to `/roadmap` — which crosses the Ingress, the Gateway and Questions, so
it fails if any hop is replaced badly — and disrupts the cluster underneath it.
Forty identities at roughly 70 requests a second, which puts a request on the
wire every 15 ms.

Forty identities rather than one because the Gateway rate-limits an
authenticated caller to 120 tokens refilling at 2 per second. A single prober
running flat out would measure the rate limiter.

| scenario | disruption took | requests | not 200 |
|---|---|---|---|
| rolling update — every Gateway and Questions pod replaced | 6s | 1,230 | **0** |
| graceful kill — one Gateway pod, `kubectl delete pod` | 7s | 1,288 | **0** |
| forced kill — one Gateway pod, `--force --grace-period=0` | 4s | 1,050 | **0** |

### Two checks that the zeros are real

A measurement that reports zero failures is worthless until you know it can
report a failure at all, and until you know nothing downstream is hiding them.

**The prober can detect an outage.** Force-deleting *both* Gateway pods at once,
leaving a window with no ready backend, produced 20 × 502 and 20 × 000. So the
zeros above are the absence of failures, not the absence of a working test.

**nginx was not retrying.** ingress-nginx will silently try a second upstream on
a connection error, which would turn a real drop into an invisible one. Of the
3,579 probe requests in the ingress access log, **zero** used more than one
upstream and every one returned 200 from the first it tried.

### What this run does *not* show

Every Deployment sets a `preStop` pause of five seconds. The reasoning is sound
in general: when a pod is removed, SIGTERM and endpoint removal happen in
parallel, endpoint removal has to propagate, and without a pause the process
starts refusing connections while traffic is still being routed to it.

But the forced kill — no preStop, no SIGTERM, the process simply gone — also
dropped nothing. **So this run does not demonstrate that the preStop pause is
what makes the zeros happen.** On a one-node cluster the endpoints controller,
kube-proxy and the ingress controller are all on the same machine, and
propagation appears to beat container teardown. On a multi-node cluster with a
remote control plane it would not.

The pause stays, because the race it protects against is real where clusters are
real. It is written down here as *retained on reasoning* rather than *proven by
measurement*, because those are different things and only one of them is worth
saying in an interview.

---

## 5. Does a killed pod lose anything?

**Not the edits. It does cost a reconnect.**

Those are two different claims and only the first is unqualified.

**The edits survive, verified directly.** A marker was written into a live
document, the Collab pod holding that room was identified from its `/metrics`
and deleted while the socket was still open, and the marker was read back after
reconnecting:

```
wrote ~KILLTEST-1786478716~, holding the socket open
pod/collab-...-dr69t rooms=1        ← the pod holding it
pod "collab-...-dr69t" deleted
FOUND ~KILLTEST-1786478716~         ← after reconnecting
document is 302 chars
```

The kill happened a few seconds after the write and well inside the 30-second
snapshot interval, and the socket never closed on its own — so the periodic
snapshot and the on-disconnect snapshot are both ruled out. The only thing that
could have saved that edit is the SIGTERM path: Fastify's `onClose` hook
snapshots every room the pod is still holding before the process exits
([`services/collab/src/index.ts`](../../services/collab/src/index.ts)). This is
also why Collab gets a 45-second grace period rather than 30 — long enough for
the preStop pause plus the snapshot write.

**The socket does close.** Nothing in a Deployment can prevent that: the pod is
going away and the socket lives in the pod. What makes it survivable is on the
client, which reconnects after 1.5 seconds and resumes from the snapshot
([`frontend/src/collab.ts`](../../frontend/src/collab.ts)). That reconnect is
read from the code and from the reconnect performed by hand above; it has not
been exercised as a browser session under a pod kill.

So the accurate sentence is **"a replaced Collab pod costs a reconnect, not any
edits"**. Not "interrupts nobody".

---

## 6. The load run

`make load` is the k6 script in [`load/`](../../load/), which ramps 250 real
collaboration sockets, holds them, and measures how long an edit takes to reach
the other person in the pair. It was written against compose and points there by
default. To aim it at the cluster:

```bash
NETWORK=host GATEWAY_URL=http://localhost:8090 \
  COLLAB_METRICS=http://localhost:8184/metrics ./load/run.sh
# with: kubectl -n deepcs port-forward svc/collab 8184:8084
```

| | compose, one of each | cluster, one Collab | cluster, two Collab |
|---|---|---|---|
| `edit_latency` p50 | 3 ms | 4 ms | 5 ms |
| p95 | 4 ms | **11 ms** | **18.72 s** |
| max | 38 ms | 89 ms | 29.67 s |
| `ws_connecting` p95 | 2.12 ms | 6.67 ms | 7.83 ms |
| `edits_sent` | — | 58,871 | 58,870 |
| `edits_received` | — | 57,929 | **69,048** |
| `http_req_failed` | — | 0 of 625 | 0 of 625 |
| checks | — | 2,030 / 2,030 | 2,030 / 2,030 |
| peak connections / rooms | 250 / 125 | 250 / 125 | one pod of two |
| rss peak | 258 MB | 242 MB | — |
| heap peak | 99 MB | 94 MB | — |

**One Collab pod on the cluster matches compose**, allowing for a p95 that is
11 ms instead of 4 ms. That difference is the extra hop through ingress-nginx
and fifteen pods sharing one node instead of nine containers. Same order of
magnitude, and both are this laptop.

### The two-replica column is not a latency measurement

An 18.72-second p95 next to a 5 ms median is not a system that got slower. Look
at the row above it: **more edits arrived than were ever sent** — 69,048 against
58,870. With one pod, received is slightly *below* sent, which is what a correct
measurement looks like (a few in flight when sockets close).

The cause is in [`services/collab/src/rooms.ts`](../../services/collab/src/rooms.ts).
When a second Collab pod opens a session another pod already holds, it asks for
the current state on a Redis channel, and the holder replies with
`Y.encodeStateAsUpdate(doc)` — the **whole document**, deliberately, because a
full state integrates regardless of what the asker started from. The asker
applies it, which fires its own `update` handler, which broadcasts it to the
sockets attached to it.

The load script stamps `Date.now()` into the text it inserts and reads it back
out on arrival. So a re-delivered document hands it hundreds of markers that are
minutes old, and it records each one as an edit that took minutes to propagate.
The tail is the age of the text, not the latency of the system. The maximum of
29.67 seconds against a socket lifetime of 30 seconds is the giveaway.

**This is a measurement artifact, not a defect.** For a real client the CRDT
converges correctly — every check passed and every one of the 2,030 sockets
synced in all three runs. The real cost of the state reply is bandwidth: a whole
document over Redis and over every local socket each time a room opens on a pod
that did not have it. Under the load script that is constant, because every VU
drops and reopens its socket every 30 seconds. In real use, rooms open rarely.

**What it means for the number:** `edit_latency` from `load/collab.js` is only
meaningful against a single Collab instance. The cluster figure worth quoting is
the one-replica column, and it has to be quoted with that condition attached.

---

## 7. How the load harness works, and the three traps in it

`load/collab.js` is the whole test: session setup, one VU's life, and the
metric. `load/run.sh` runs it and samples Collab's `/metrics` alongside.

**A VU (virtual user) is one concurrent execution of the script**, and here one
VU is one person in one two-person session: VUs 1 and 2 share a document, 3 and
4 share the next. k6's runtime is Go, so a VU is a goroutine rather than an OS
thread and one laptop drives thousands. *Why not a Node load generator?* It would
be bounded by its own single event loop, and the number it produced would
describe the client rather than the server.

**The generator has to be a real Yjs client.** k6 resolves neither
`node_modules` nor TypeScript, so `load/bundle.mjs` compiles the Yjs libraries in
beforehand. That build step is the price of the alternative being unusable: a
hand-written approximation of the wire format does not fail gradually, it fails
at `deliver`, which closes the socket with 1002 on a malformed frame. An
approximate client measures nothing. `load/package.json` takes `yjs`,
`y-protocols` and `lib0` from the same workspace catalog Collab itself uses,
because a load generator on a different protocol version measures a system that
does not exist.

**Setup goes through the front door, one pair at a time.** Collab authorizes
every socket against Matching's participant check, so there is no way to fake a
session it will accept. `setup()` creates 125 of them the way a person would:
mint a token, `GET /users/me` to create the profile row Matching validates
against, then two calls to `POST /match/join` where the first answers `waiting`
and the second claims it. The joins are **sequential** — two in flight at once
can claim each other's partner, and then the pairing no longer matches the VU
numbering the script relies on. Tokens are minted in-process, because the
emulator issues unsigned tokens and the Gateway checks `iss`, `aud`, `exp` and
`sub` on that path, so 250 identities cost 250 lines of JSON rather than 250
round trips.

Each VU reconnects every 30 seconds rather than holding one socket for the whole
run. A socket that is only ever opened proves nothing about the code that closes
one, and the leave path — snapshot, drop the room, unsubscribe — is where a leak
would live.

### Trap 1: there is no echo

The original design said the script "stamps a timestamp into each Yjs update it
sends and records the delta when the echo arrives back over the socket".

There is no echo. `broadcast` in
[`services/collab/src/rooms.ts`](../../services/collab/src/rooms.ts) sends an
update to every socket in the room *except* the one it came from, so a sender
never sees its own edit return. A script written to that description records
nothing at all — **and would then have gone green, because a threshold over a
metric with no samples passes.** That is why `edits_received: ['count>0']` sits
next to the latency threshold.

So the timestamp is read by the *other* VU in the session. That is also the
better measurement: the number a person cares about is how long until their
partner sees what they typed, not how long a round trip takes to return
something they already know.

### Trap 2: the first thing the server sends is the whole document

On connect, Collab replies to sync step 1 with the entire document — every
timestamp every VU has inserted into that session since the run began. Feed those
to the metric and `edit_latency` stops meaning propagation delay and starts
meaning *the age of the document*, which after three minutes of load is minutes
rather than milliseconds.

So the script counts nothing until the initial sync has landed. `readSyncMessage`
applies the update before it returns, and the observer that records latencies
bails out while `synced` is false, so the burst is applied to the document and
excluded from the measurement, in that order.

This is the kind of bug the run exists to find: nothing errors, the run goes
green, and the headline figure is quietly meaningless. It is the same mechanism
as §6's two-replica column, reached from inside one process instead of across
two.

### Trap 3: the load generator can be the bottleneck

One `docker stats` sample during the hold:

| | CPU |
|---|---|
| the k6 container | 174% |
| `deepcs-collab-1` | 13% |

The generator costs about thirteen times the service it is testing. That is not a
defect — k6 runs a full Yjs document per VU in an interpreted runtime while
Collab merges an update in native V8 — but it means the client-side p95 includes
whatever k6's own scheduling adds, and a run that saturated the generator would
report a slow *server*. Collab's `/metrics` is what keeps the two apart: when the
client says 250 sockets and the server agrees, the number is real; when only the
client says it, it is a queue in the client.

### What the compose baseline measured

| | |
|---|---|
| peak, both views | k6 `vus_max` 250 · Collab `/metrics` 250 connections, 125 rooms |
| `edit_latency` | p50 3 ms · p95 4 ms · max 38 ms, over 58,294 samples |
| `ws_connecting` | p95 2.12 ms |
| checks | 2,030 / 2,030 documents synced |
| sockets 10s after | 0 connections, 0 rooms |
| heap | 24 MB idle → 99 MB peak → 58 MB at +10s → **24.8 MB a few minutes later** |
| rss | 117 MB idle → 258 MB peak → 258 MB at +10s → **123 MB a few minutes later** |

**The two memory rows are the interesting ones**, and they sharpen what "flat
memory over a long hold" can mean. Memory is *not* flat during the hold, and it
should not be: 125 documents are being typed into 250 times a second and Yjs
keeps the history of every insert. Growth that tracks the documents is the system
working. What a leak would look like is the **return** not happening — and it
does happen, on two different timescales, which is why both numbers are sampled.
The used heap is most of the way back within seconds of the rooms closing;
resident memory follows minutes later, because Node hands pages back to the
operating system lazily. Reading RSS alone at +10s (258 MB against a 117 MB
baseline) would have looked exactly like a leak and been wrong.

The settled reading is also taken ten seconds *after* the run rather than from
the last sample, because the samples at the end land mid-ramp-down and the claim
is that sockets return to zero once the last one closes, not that they were zero
while people were still leaving.

**58,294 edits received against 58,870 sent.** The missing 576 are the ramp
windows: a VU whose partner has not connected yet, or has already gone, is typing
into a document nobody is reading. That gap being small and stable is itself the
propagation check.

**One number is impossible, and stays in.** `edit_latency` reported a minimum of
-522 ms. A negative delay means a marker was read at a wall-clock moment earlier
than the one it was stamped with, and both VUs are in one k6 process reading one
clock — so it did not come from two clocks disagreeing, it came from that clock
moving backwards mid-run, which is a thing WSL2 does when it resyncs against the
Windows host. The evidence that it was a step rather than noise: a handful of
samples went negative by about half a second and nothing at all went *positive*
by half a second, with the maximum sitting at 38 ms. It moves neither p50 nor
p95, and it is written down rather than clipped away, because a script that
silently discards its impossible samples cannot tell you when they stop being
rare.

**The 250 is not enforced by anything local.** Nothing in compose caps
concurrency; what the run establishes is that 250 sockets are comfortable on this
machine.

---

## 8. The images

One `Dockerfile`, seven stages, six images, selected with
`--build-arg SERVICE=<name>`. Six near-identical Node services means six
Dockerfiles would be the same fix applied six times and drifting in five of them;
independent deployability lives in the pipeline and the image tag, not in the
file the image is built from.

```
base → manifests → deps → dev        (compose bind-mounts src/ into this)
                        → build      (tsup → dist/)
       manifests → prod-deps
       build + prod-deps → runner    (what the cluster runs, non-root, 278 MB)
```

**The `manifests` stage copies eight `package.json` files by name** rather than
`COPY . .`, and that is the single highest-value line in the file. Docker
invalidates a cached layer when any file it copied has changed, so `COPY . .`
followed by `pnpm install` reinstalls every dependency whenever you edit a `.ts`
file. Copying only what the install reads keys that layer on dependency changes
alone. The cost, accepted knowingly: a seventh service means editing this file,
and forgetting means "module not found" for that one service.

**`runner` starts from a clean `node:24-alpine`** rather than continuing from
`build`, so none of pnpm, tsup, TypeScript or the dev dependency tree exists in
the shipped image, and `USER node` drops root.

**Bundling is not a preference.** pnpm links workspace dependencies as symlinks
into a content-addressed store outside the project directory, so the naive
`COPY node_modules` from a build stage copies dangling symlinks and the image
dies at import. The three fixes are `pnpm deploy --prod`, `node-linker=hoisted`,
or bundling so shared `packages/*` code is inlined and the runtime image needs no
workspace resolution at all. Bundling is the smallest of the three.

**Compose bind-mounts only `src/` directories**, read-only, never the repo root.
A bind mount over `/app` *replaces* the directory, including
`/app/node_modules` — which was installed inside the image for the container's
platform and contains pnpm symlinks pointing at paths that exist only inside the
container. The dependency tree vanishes and the container dies on its first
import.

The tooling itself, line by line, is
[`../learning/docker.md`](../learning/docker.md).

---

## 9. CI

Three jobs, plus one for the frontend. `changes` computes the changed file list
with plain `git diff` and emits a JSON array of service names; `lint` runs
eslint and prettier once, repo-wide; `service` is a matrix job with one parallel
copy per changed service — typecheck, test, build, build the image, then
**`docker run` it and curl `/health/ready`**. `fail-fast: false`, so one failure
does not cancel the others' results.

Path filtering is the point. A change under `services/questions/` builds and
health-checks only Questions; touching anything shared (`packages/`, the
`Dockerfile`, the lockfile, root configs) rebuilds all six, because those are
compiled into every image. Independent buildability is most of what the six-way
split buys, and it does not exist unless the pipeline is wired for it.

**The smoke test is the step that looks redundant, and it is the one that
matters.** Typecheck and test have already passed by then. They passed once
before while `pnpm build` produced a bundle that died at import with `Dynamic
require of "os" is not supported`: `tsup` exits 0 on a broken bundle, and `pnpm
test` runs from source and never touches `dist/`. **A green build is not a
working artifact**, and the only check that would have caught it is running the
thing you actually ship. Stats is smoke-tested differently, because it is a job:
success is `docker run` exiting 0, not a port answering.

Real Postgres and Redis run as service containers, not mocks, for the same reason
the local suites need them: the properties under test are a Lua script's
atomicity and a role being refused a schema.

**There is no deploy step and there is not going to be one.** What CI proves is
that each service's production image builds and answers `/health/ready` on its
own, which is exactly the property a rolling update depends on.

Two things it does not do:

- **It does not orchestrate sibling services.** The matrix brings up Postgres and
  Redis only, so Matching's and Collab's contract tests against a real Users,
  Questions and Matching pass locally and skip in CI.
- **It does not run the load test.** A shared GitHub runner measures the runner,
  and a p95 gate on one fails for reasons unrelated to any change. The thresholds
  still do their job locally: nobody has to eyeball a table to know whether the
  run passed.

One bug in this file is worth knowing because the shape recurs. The `changes` job
used to fail the whole run on any commit that touched no service — a docs-only
change. `grep` exits 1 when it matches nothing, which is exactly what a docs-only
commit looks like, and under `set -euo pipefail` that status propagates out of
the command substitution and kills the step *before* the empty-list guard written
for this case can be reached. The fix is `{ grep -oE '^services/[^/]+' || true; }`,
with the braces scoping `|| true` to `grep` alone: appending it to the whole
pipeline would also swallow a genuine failure and hand the matrix a silently
empty list, which is worse because it looks like success. **Under `set -euo
pipefail`, a command whose "nothing found" case is normal needs that case handled
explicitly, or your error handling becomes unreachable code.**

The tooling itself is [`../learning/ci.md`](../learning/ci.md).

---

## 10. What each claim is worth away from this machine

The distinction the whole repo is built on, applied here.

**Claims that travel** — properties of the design, not the hardware:

- A rolling update of the Gateway and Questions completed with no non-200
  responses, with a prober proven able to detect one and an ingress proven not
  to be retrying.
- An edit written seconds before its pod was deleted was in the document after a
  reconnect, by the SIGTERM snapshot path and no other.
- Only the Gateway is reachable from outside the cluster, so `X-User-Id` cannot
  be set by a client.
- A service cannot read another service's schema; the database refuses it.

**Claims that do not travel** — every one of these describes an AMD Ryzen AI 7
350 running WSL2:

- 250 concurrent sockets, 125 rooms.
- p50 4 ms, p95 11 ms edit propagation.
- 242 MB peak resident memory.
- 70 requests a second through the Ingress.
- `make k8s-up` in 1m50s.

**Claims not made at all.** No capacity claim, from any run. Every run measures
this laptop, and a load figure without the machine attached is not a figure. The
p95 above is also not a service-level objective: it is one run, on one machine,
on one afternoon.

---

## 11. Things that break, and what they look like

| What you see | What it is |
|---|---|
| `ImagePullBackOff` on a `deepcs/*:local` image | `kind load` has not run for it. `make k8s-up` |
| A pod `Running` but `0/1` | failing readiness, so refusing traffic. Not broken. `describe` names the probe |
| `CrashLoopBackOff` | `logs --previous` — plain `logs` shows the new container, which has not failed yet |
| The Gateway refusing to start | `FIREBASE_AUTH_EMULATOR_HOST` set with `NODE_ENV=production`. It is supposed to refuse; see below |
| `make k8s-check` reporting 429s | more probers than identities. Each identity gets 120 tokens refilling at 2/s |
| Auth emulator accounts gone after a restart | expected on the cluster. It only exports on a clean SIGINT and Kubernetes sends SIGTERM |

**The Gateway's boot guard is the one worth understanding.** The cluster runs
the production-target images and still sets `NODE_ENV=development`. That is not
an oversight. The Gateway refuses to boot when the emulator host is set
alongside `NODE_ENV=production`, because the emulator issues unsigned tokens and
accepting those in production means accepting forged identities. This cluster
runs the emulator, so it is not production, and saying so is what keeps that
guard able to fire somewhere it matters.
