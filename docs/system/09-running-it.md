# Running it, and what the numbers mean

Two ways to run DeepCS, and neither of them is deployed. `docker compose` is the
one to develop against. A local Kubernetes cluster is the one that answers the
question compose cannot: what happens to the people using it while a service is
being replaced.

This page is how to run both, what was measured on each, and — the part that
matters more — which of those measurements are claims about DeepCS and which are
claims about this laptop.

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

## 7. What each claim is worth away from this machine

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

## 8. Things that break, and what they look like

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
