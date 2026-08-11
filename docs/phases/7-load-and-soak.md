# Phase 7 — The load run, and what a laptop is allowed to claim

`make load` ramps 250 collaboration sockets across 125 real sessions, holds
them for three minutes while everyone types once a second, and prints two
views of the same run: k6's, from outside, and Collab's own `/metrics`, from
inside.

There is not much code. The value is in one distinction, and everything below
is shaped by it: **which of these numbers describe the system, and which
describe this laptop.**

---

# The four things — read this page, then stop if you're short on time

## 1. The design described a measurement that cannot happen · ~5 min

DESIGN.md §8 said the script "stamps a timestamp into each Yjs update it sends
and records the delta when the echo arrives back over the socket".

There is no echo. `broadcast` in `services/collab/src/rooms.ts` sends an update
to every socket in the room *except* the one it came from:

```ts
for (const socket of room.sockets) {
  if (socket === sender) continue;
  ...
}
```

A script written to that description records nothing at all, and would then
have gone green: a threshold over a metric with no samples passes. That is why
`edits_received: ['count>0']` sits next to the latency threshold.

So the timestamp is read by the *other* VU in the session — VUs 1 and 2 share
a document, 3 and 4 share the next — and the subtraction happens on arrival
there.

That is also the better measurement. The number a person cares about is how
long until *their partner* sees what they typed, not how long a round trip to
the server takes to return something they already know.

The correction is recorded in DESIGN.md §8 next to the original claim.

## 2. The first thing the server sends is the whole document · ~5 min

On connect, Collab replies to sync step 1 with the entire document — every
timestamp every VU has inserted into that session since the run began. Feed
those to the metric and `edit_latency` stops meaning propagation delay and
starts meaning *the age of the document*, which after three minutes of load is
minutes rather than milliseconds.

So the script counts nothing until the initial sync has landed:

```js
const type = syncProtocol.readSyncMessage(decoder, reply, doc, 'server');
if (type === syncProtocol.messageYjsSyncStep2) synced = true;
```

`readSyncMessage` applies the update before it returns, and the observer that
records latencies bails out while `synced` is false — so the burst is applied
to the document and excluded from the measurement, in that order.

This is the kind of bug the phase exists to find: nothing errors, the run goes
green, and the headline figure is quietly meaningless.

## 3. A local run may claim correctness, never capacity · ~5 min

"Holds 250 concurrent connections" is a fact about an AMD Ryzen AI 7 350 with
16 cores, not about DeepCS. The claims that survive leaving this machine are
the ones that do not depend on how fast it is:

- **no leaked sockets** — 250 connections at the peak, 0 ten seconds after the
  last one closed, counted by the server itself;
- **the rooms are released with them** — 125 at the peak, 0 afterwards;
- **the used heap comes back** — see the numbers below.

The 250 is also worth being precise about. Nothing locally enforces it: the
ceiling is the per-service concurrency setting from DESIGN.md §7, which
does not exist in `docker compose`. What the local run establishes is that 250
sockets are comfortable here, so if the deployed service refuses the 251st,
that is the flag doing its job and not the machine running out.

## 4. Two views, and the one that noticed the load generator · ~5 min

§8 asks for the run to be measured from both directions, and one `docker stats`
sample during the hold shows why:

| | CPU |
|---|---|
| the k6 container | 174% |
| `deepcs-collab-1` | 13% |

The load generator costs about thirteen times the service it is testing. That
is not a defect — k6 runs a full Yjs document per VU in an interpreted runtime
while Collab merges an update in native V8 — but it means the client-side p95
includes whatever k6's own scheduling adds, and a run that saturated the
generator would report a slow *server*. Collab's `/metrics` is what keeps the
two apart: when the client says 250 sockets and the server agrees, the number
is real; when only the client says it, it is a queue in the client.

---

# Read the code in this order

| File | Why |
|---|---|
| `load/collab.js` | The whole test: session setup, one VU's life, and the metric. |
| `load/run.sh` | The two views, and the settled reading taken after the run rather than at the end of it. |
| `services/collab/src/index.ts` | `/metrics`, and what it deliberately does not report yet. |
| `services/collab/src/rooms.ts` | `stats()`, and the one place a room stops being counted. |
| `load/bundle.mjs` | Why a load test needs a build step. |

---

# Part 1 — The load generator has to be a real Yjs client

k6 runs its own JavaScript runtime and resolves neither `node_modules` nor
TypeScript, so `import * as Y from 'yjs'` is compiled in beforehand by
`load/bundle.mjs`. That build step is the price of the alternative being
unusable: a hand-written approximation of the wire format does not fail
gradually, it fails at `deliver`, which closes the socket with 1002 on a
malformed frame. An approximate client measures nothing.

`load/package.json` takes `yjs`, `y-protocols` and `lib0` from the same
workspace catalog Collab itself uses. A load generator on a different protocol
version measures a system that does not exist.

The result is that the script does what `frontend/src/collab.ts` does: opens
with sync step 1, applies what comes back, sends its own edits as incremental
updates, and skips anything whose origin is the server so two clients do not
bounce one edit between them forever.

# Part 2 — Why setup goes through the front door, one pair at a time

Collab authorizes every socket against Matching's participant check, so there
is no way to fake a session it will accept. `setup()` therefore creates 125 of
them the way a person would: mint a token, `GET /users/me` to create the
profile row Matching validates against, then two calls to `POST /match/join`,
where the first answers `waiting` and the second claims it.

Two details are load-bearing:

- **The joins are sequential.** Two in flight at once can claim each other's
  partner, and then the pairing no longer matches the VU numbering the script
  relies on to put VUs 1 and 2 in the same room.
- **Tokens are minted in-process.** The Auth emulator issues unsigned tokens
  and the Gateway checks `iss`, `aud`, `exp` and `sub` on that path
  (`services/gateway/src/auth.ts`), so 250 identities cost 250 lines of JSON
  rather than 250 round trips to the emulator.

Each VU then reconnects every 30 seconds rather than holding one socket for the
whole run. A socket that is only ever opened proves nothing about the code that
closes one, and the leave path — snapshot, drop the room, unsubscribe from
Redis — is where a leak would live.

# Part 3 — What the run measured

**Environment**, which is half of every number here: AMD Ryzen AI 7 350, 16
cores, 15 GB, WSL2; `docker compose` with one instance of each service, one
Postgres and one Redis; k6 in a container on the same compose network, driving
the Gateway rather than Collab directly, because that is the path a browser
takes and §5 is explicit that one collab socket occupies a slot on both.

**The run**: 30s ramp to 50, hold 1m, 30s ramp to 250, hold 3m, 30s down. Each
VU holds a socket for 30 seconds and types once a second, so the run is 2,030
sockets opened and closed and about 59,000 edits sent.

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
should not be: 125 documents are being typed into 250 times a second, and Yjs
keeps the history of every insert. Growth that tracks the documents is the
system working.

What a leak would look like is the *return* not happening. It does happen, on
two different timescales, which is why both numbers are sampled: the used heap
is most of the way back within seconds of the rooms closing, and resident
memory follows minutes later, because Node hands pages back to the operating
system lazily. Reading RSS alone at +10s — 258 MB against a 117 MB baseline —
would have looked exactly like a leak and been wrong.

**58,294 edits received against 58,870 sent.** The missing 576 are the ramp
windows: a VU whose partner has not connected yet, or has already gone, is
typing into a document nobody is reading. That gap being small and stable is
itself the propagation check.

**One number is impossible, and stays in**: `edit_latency` reports a minimum of
-522 ms (and -502 ms on the previous run). A negative delay means a marker was
read at a wall-clock moment earlier than the one it was stamped with. Both VUs
are in one k6 process reading one clock, so the reading did not come from two
clocks disagreeing — it came from that clock moving backwards mid-run, which is
a thing WSL2 does when it resyncs against the Windows host. The evidence that
it was a step rather than noise: a handful of samples went negative by about
half a second and nothing at all went *positive* by half a second, with the
maximum sitting at 38 ms. It does not move p50 or p95, and it is written down
here rather than clipped away, because a script that silently discards its
impossible samples is a script that cannot tell you when they stop being rare.

# Part 4 — What this phase deliberately did not build

- **The run is not in CI.** DESIGN.md §8 gives thresholds as what "lets it live
  in CI instead of being something someone remembers to eyeball", and the
  thresholds are here and do fail the run. What is missing is the runner: a
  shared GitHub runner measures the runner, and a p95 gate on one fails for
  reasons unrelated to any change. The thresholds still do their
  job locally — nobody has to eyeball a table to know whether the run passed.
- **`/metrics` is on Collab only, and only gauges.** §6 wants request rate,
  error rate and latency histograms on every service. None of those is what
  this phase measures, and all of them are wanted in phase 10 by something that
  can store them.
- **One Collab instance, so the cross-instance relay is not under load.** Every
  edit here is broadcast in-process; the Redis path that phase 4 exists for is
  exercised by its tests and not by this. Phase 8 runs the same script against
  replicas on Kubernetes, which is where that changes.
- **Nothing cleans up after the run.** It leaves 250 users and 125 ended
  sessions in the database, and the next time the Stats job drains the log they
  land in `/stats` — so local aggregates after a load run describe the load run.
  A prefix to exclude (`k6-`) exists in the uid; using it does not.

# Part 5 — Demonstrating the claims

```bash
make up
make load                                   # about six minutes
PEAK_VUS=50 HOLD=1m make load               # a smaller one
```

The claims and where to read each:

| Claim | Where |
|---|---|
| an edit reaches the partner in p95 4 ms, *on this machine* | k6's `edit_latency` |
| edits actually propagated | `edits_received`, and the `count>0` threshold that makes an empty metric fail |
| 250 sockets were really open on the server | `peak connections` in the `/metrics` summary, next to k6's `vus_max` |
| none of them leaked | `10s after the run` in the same summary |

The leak claim can also be watched live, which is the more convincing version:

```bash
watch -n1 'curl -s localhost:8084/metrics | grep -E "^collab_(websocket|rooms)"'
```

It climbs to 250/125 during the hold and returns to 0/0 within seconds of the
run ending. `load/dist/collab-metrics.csv` keeps the whole series.

One failure worth recording even though it is not in the numbers above: an
earlier run of this script had a single socket in 2,030 close before its
document arrived, with nothing logged on either side to say why. That is what
the close code in the close handler is for — a failed check that cannot be told
apart from a refused upgrade diagnoses nothing. It has not recurred.
