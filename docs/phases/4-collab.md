# Phase 4 — Collab

**What this phase proves** (DESIGN.md §10):

- two people editing the same session from two different Collab instances
  converge, with nothing but Redis between them
- somebody who joins late gets the edits they were not connected for
- a socket cannot open a session its user is not part of — Collab asks
  Matching, because the Gateway holds no session data
- killing an instance loses at most 30 seconds; reconnecting restores the rest

Every heading below links to the code it describes. Open the file alongside this
page — the comments in the source explain *what*, this document explains *why*
and how the pieces connect.

---

# The four things — read this page, then stop if you're short on time

## 1. Two instances have to agree on the document's *identity*, not just its text · ~15 min

📄 [`rooms.ts`](../../services/collab/src/rooms.ts) — `SEED_CLIENT_ID`
([:41](../../services/collab/src/rooms.ts#L41)) and `seedUpdate`
([:90](../../services/collab/src/rooms.ts#L90)) · test at
[`sync.test.ts`](../../services/collab/src/sync.test.ts)

**The failure, and it is the one this phase actually shipped with.** Both
users are matched at the same moment and connect at the same moment, landing
on two instances. Neither finds a snapshot — the first is 30 seconds away — so
each builds the scaffold from the question independently. Print both documents
and they are *identical*. Every test passes. Then somebody types, and their
edit never appears on the other screen. Ever.

Yjs identifies each character by the pair `(clientID, clock)`, and a fresh
`Y.Doc` picks a random `clientID`. Two independently seeded documents
therefore hold the same *text* built out of entirely unrelated *structs*. An
edit is a delta that says "insert after the struct owned by client 770768811"
— and the other instance has never heard of client 770768811, so Yjs does the
correct CRDT thing: it parks the update in `pendingStructs` and waits for a
base it will never receive. Both sides stay silently, permanently
out of sync while looking completely healthy.

**The fix is one line, and it is not the obvious one.** The obvious fix is to
make the instances talk more. The actual fix is to make the seed *not a fresh
document*: build it under a fixed `clientID` (`SEED_CLIENT_ID = 0`) and apply
it as an update. Every instance seeding the same question now produces
byte-identical structs, so the second copy merges into the first instead of
being a stranger to it.

**Say it as:** *"Two replicas agreeing on the bytes isn't the same as agreeing
on the identity of the bytes. A CRDT merges by identity, so two documents that
print the same and were built independently are not the same document, and
nothing you send between them will make them one."*

## 2. A late joiner has to ask for what it missed · ~10 min

📄 [`rooms.ts:436`](../../services/collab/src/rooms.ts#L436) (the request) ·
[`rooms.ts:363`](../../services/collab/src/rooms.ts#L363) (the reply)

**The failure:** fixing thing 1 makes simultaneous joins converge, and does
nothing for the ordinary case where the second person clicks ten seconds after
the first. Their instance was not subscribed while those ten seconds of edits
went past on Redis, and the snapshot that would have carried them does not
exist yet. Same ending as thing 1: parked deltas, silent divergence.

**The mechanism:** on building a room, an instance publishes its own id on
`collab:sync:<sessionId>`. Any instance already holding that session answers
with `Y.encodeStateAsUpdate(doc)` — the *whole* document, not a delta, because
a full state is self-contained and integrates onto any base. Nothing waits for
the answer: the deltas Yjs parked in the meantime apply themselves the moment
the missing base arrives.

**Say it as:** *"A replica joining an existing conversation can't start from
whatever it happens to have — it has to ask what it missed. And the answer has
to be self-contained, because a delta is only meaningful to someone who
already has what it was built on."*

## 3. A frame can arrive before there is anywhere to put it · ~5 min

📄 [`rooms.ts:234`](../../services/collab/src/rooms.ts#L234) (`attachSocket`)

**The failure:** opening a room is not free — a Postgres round trip, and on a
new session an HTTP call to Questions. A real client does not wait for that; it
opens the socket and can send the moment `onopen` fires. Attach the `message`
listener *after* that await and everything sent in between hits a socket with
no listener — and Node's `EventEmitter` keeps no backlog for an event nobody
was listening for. It is simply gone.

**The mechanism:** the listeners go on before the await, and anything arriving
in that window is queued and replayed once the room is ready.

**Say it as:** *"Register the listener before you start the slow thing, not
after — anything that can arrive while you're waiting needs somewhere to land,
even if that somewhere is just an array you drain later."*

## 4. One bad frame must cost one client, not the process · ~5 min

📄 [`rooms.ts:484`](../../services/collab/src/rooms.ts#L484) (`deliver`)

**The failure:** `handleMessage` throws on a truncated frame, an empty one, an
unknown sync sub-type, or awareness bytes that aren't JSON. A throw inside a
`ws` event listener is not a failed request — there is no request. It is an
`uncaughtException`, and the process dies, taking every other session on that
instance with it and losing up to 30 seconds of everyone's typing.

**The mechanism:** one `try/catch` around the dispatch. The offending socket
gets closed with 1002; everybody else never notices.

**Say it as:** *"In a request/response server an unhandled throw costs you one
response. In an event-driven one it costs you the process — so the blast
radius of a malformed input is a property of where you handle it, not of how
bad the input was."*

---

# Read the code in this order

| # | File | What it is |
|---|---|---|
| 1 | [`packages/db/migrations/007_collab_snapshots.sql`](../../packages/db/migrations/007_collab_snapshots.sql) | The snapshot row. Start here. |
| 2 | [`services/matching/src/index.ts`](../../services/matching/src/index.ts#L192) | `GET /match/sessions/:id/participant` — what Collab asks before letting a socket in. |
| 3 | [`services/gateway/src/auth.ts`](../../services/gateway/src/auth.ts#L203) | `queryToken` — how a token reaches the Gateway on a WebSocket upgrade. |
| 4 | [`services/gateway/src/index.ts`](../../services/gateway/src/index.ts#L234) | `rewriteWsHeaders` — why the upstream socket needs its own header rewrite. |
| 5 | [`services/collab/src/clients.ts`](../../services/collab/src/clients.ts) | Typed calls to Matching and Questions. |
| 6 | [`services/collab/src/repository.ts`](../../services/collab/src/repository.ts) | Snapshot persistence. |
| 7 | [`services/collab/src/rooms.ts`](../../services/collab/src/rooms.ts) | The room manager — the one file worth the most time. |
| 8 | [`services/collab/src/index.ts`](../../services/collab/src/index.ts) | `GET /collab/connect` — wires everything above together. |

---

# Part 1 — Letting a socket in

📄 [`services/gateway/src/auth.ts:203`](../../services/gateway/src/auth.ts#L203) ·
[`services/gateway/src/index.ts:101`](../../services/gateway/src/index.ts#L101) ·
[`services/collab/src/index.ts:59`](../../services/collab/src/index.ts#L59)

```
wss://gateway/collab/connect?sessionId=<id>&token=<firebase-id-token>
```

Two checks, answering two different questions, in the two places that can
answer them.

**The Gateway answers *who is this*.** Its auth hook has verified an
`Authorization` header since phase 1, but a browser's native `WebSocket`
constructor cannot set headers — there is no hook for it. So for a WebSocket
upgrade specifically, and only for one (`req.headers.upgrade === 'websocket'`,
[index.ts:101](../../services/gateway/src/index.ts#L101)), the token is also
accepted from `?token=`. The verification path is otherwise unchanged. Scoping
it to upgrades is deliberate: every other route has a perfectly good header to
use, and widening this would put credentials in access logs for no reason.

**Collab answers *is this uid in this session*,** which the Gateway
structurally cannot — it holds no session data. `authorizeConnect`
([index.ts:59](../../services/collab/src/index.ts#L59)) calls Matching's new
route with the Gateway-verified uid:

```
GET /match/sessions/:id/participant     with header  X-User-Id: bob
-> { participant: true, questionId }               bob is in this session
-> { participant: false }                          session exists, bob isn't
-> 401                                             no caller identity at all
-> 404                                             no such session
```

**The subject is the caller's own header, not a uid in the query string, and
that is the access control.** This route sits under the `/match` prefix, which
the Gateway proxies, so a browser can reach it. An earlier version took
`?uid=` and answered about anybody — which would have handed anyone holding a
session id the *other* participant's identity. Only ever answering about
yourself makes that impossible to express, rather than something a future
edit has to remember to keep checking. Collab passes the uid the Gateway
verified for that socket, which is the same trust model every internal call in
this system uses.

**A rejection looks different depending on which layer catches it**, and that
is worth knowing rather than being surprised by. A *bad* token never leaves
the Gateway: normal HTTP status, no upgrade. Collab's check is different,
because `@fastify/http-proxy` completes the 101 handshake with the client
*before* it opens its own connection to the upstream. So a caller Collab
rejects still sees `101 Switching Protocols` — the tell is not the status
code, it is that the socket closes immediately afterwards having received no
document bytes at all. Claim 1 in the demo shows exactly this.

**One thing that has to be wired by hand.** The upstream WebSocket is a
*second*, separate connection that the proxy opens itself, with its own header
rewrite hook — the HTTP one does not apply to it, and its default forwards
nothing but `cookie`. Without `rewriteWsHeaders`
([index.ts:234](../../services/gateway/src/index.ts#L234)) Collab would never
see `X-User-Id` and would 401 every socket, authorized or not.

---

# Part 2 — Building a room

📄 [`rooms.ts:305`](../../services/collab/src/rooms.ts#L305) (`buildRoom`) ·
[`repository.ts`](../../services/collab/src/repository.ts)

```sql
CREATE TABLE IF NOT EXISTS collab.snapshots (
  session_id  uuid PRIMARY KEY,
  state       bytea NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```

One row per session; `state` is the output of `Y.encodeStateAsUpdate(doc)`.
`session_id` is a plain column, not a foreign key into `matching.sessions`
(ADR-09, same reasoning as phase 3's `question_id`) — it is validated by the
HTTP call in Part 1, not by a cross-schema constraint.

A room comes from a snapshot if there is one and from `seedUpdate` if there is
not — the scaffold being one `## Part N` heading per question part, plus
`## Our answer` and `## Scratch`, all in a single `Y.Text` named `"content"`.
That field name is a contract with phase 5, where `y-monaco` binds to it.

Three details in this function each exist because of a specific failure:

- **`SEED_CLIENT_ID`** — thing 1 above, the whole reason the phase works.
- **A missing question fails the build** rather than seeding an empty
  document. Seeding empty looks like it worked, gets snapshotted 30 seconds
  later, and the scaffold can then never come back for that session.
- **`awareness.setLocalState(null)`**
  ([:320](../../services/collab/src/rooms.ts#L320)) — constructing an
  `Awareness` registers its own document as a client. Left alone the server
  becomes a participant who never types: a ghost cursor in phase 5's UI, and a
  heartbeat re-announcing itself to every other instance for as long as the
  room lives.

The room also opens a **second, dedicated Redis connection** to subscribe on
([:332](../../services/collab/src/rooms.ts#L332)). A subscribed ioredis
connection cannot issue any other command, so publishing and subscribing can
never share one. It re-enables `enableOfflineQueue`, which
`@deepcs/shared/redis` turns off: that setting exists so a *user-facing
request* fails fast instead of hanging, and a long-lived listener is not a
request — subscribing before the socket finishes connecting should queue, not
throw. (It threw, the first time this was written.)

---

# Part 3 — The wire protocol

📄 [`rooms.ts:494`](../../services/collab/src/rooms.ts#L494) (`handleMessage`) ·
[`rooms.ts:446`](../../services/collab/src/rooms.ts#L446) (`sendInitialSync`)

Every frame starts with one byte saying which of two things it is:
`MESSAGE_SYNC` (0) or `MESSAGE_AWARENESS` (1). That is `y-websocket`'s
convention rather than Yjs's, adopted so `y-protocols`' own
`readSyncMessage`/`writeSyncStep1` can be used directly instead of inventing
an equivalent. A sync frame goes to `readSyncMessage`, which itself
distinguishes step 1 (a handshake — reply with step 2), step 2, and a plain
update. An awareness frame goes to `applyAwarenessUpdate`.

Presence and cursors ride the same socket under the awareness type. Yjs's
**awareness** protocol is a small side channel built for exactly this kind of
ephemeral per-client state, so cursors need neither a second connection nor a
second protocol, and none of it ends up in the document's history.

---

# Part 4 — Cross-instance sync

📄 [`rooms.ts:383`](../../services/collab/src/rooms.ts#L383) (doc updates) ·
[`rooms.ts:401`](../../services/collab/src/rooms.ts#L401) (awareness)

```mermaid
sequenceDiagram
    participant A as User A's browser
    participant C1 as Collab instance 1
    participant R as Redis pub/sub
    participant C2 as Collab instance 2
    participant B as User B's browser
    Note over A,B: one session — sockets landed on different instances
    A->>C1: an incremental Yjs update
    C1->>C1: merge into instance 1's copy
    C1->>R: publish on collab:doc:<id>
    R-->>C2: deliver (instance 2 is subscribed)
    C2->>C2: merge — same result in any order, *if* the bases match
    C2->>B: push over B's socket
    Note over C1,C2: "if the bases match" is what things 1 and 2 buy
```

Both listeners check who caused the change. A local socket's update is
broadcast to the room's *other* local sockets and published to Redis. An
update that arrived *from* Redis (`origin === 'redis'`) is broadcast locally
and **not** republished — that one branch is the entire loop-prevention story.

Three Redis channels per session, and it is worth being able to name all
three: `collab:doc:<id>` carries document updates, `collab:awareness:<id>`
carries presence, and `collab:sync:<id>` carries the state request from
thing 2.

---

# Part 5 — Snapshot, disconnect, reconnect

📄 [`rooms.ts:188`](../../services/collab/src/rooms.ts#L188) (`leaveRoom`) ·
[`index.ts:111`](../../services/collab/src/index.ts#L111) (the `onClose` hook)

Three moments write a snapshot, all through the same call:

- **Every 30 seconds** per live room. Per-keystroke writes would be both slow
  and expensive; 30 seconds bounds worst-case loss without touching the hot
  path.
- **When a room's last socket leaves.** The room is then torn down: interval
  cleared, Redis subscriber unsubscribed and disconnected, `Awareness` and
  `Y.Doc` destroyed (both hold timers of their own), and the room dropped from
  the manager.
- **Before the process exits**, from the `onClose` hook — the same slot every
  other service in this repo uses for cleanup, with Collab's snapshot pass
  running before the pool and Redis connections close.

**Reconnect and restart are deliberately the same code path.** There is no
"restore after crash" branch to keep in sync with the normal one, because a
reconnecting tab and a freshly started instance both just call
`getOrCreateRoom`, find nothing in memory, and load the snapshot.

The ordering inside `leaveRoom` matters more than it looks, and both orderings
here were wrong at some point:

- **Snapshot before dropping the room from the map.** Reversed, a reconnect
  landing in the gap rebuilds from the *previous* snapshot — up to 30 seconds
  stale — and then overwrites the good one with it.
- **Remove the socket from `sockets` before clearing its presence.**
  `removeAwarenessStates` fires the awareness listener synchronously, and that
  listener re-registers any sender still in the set — so clearing presence
  first puts the departing socket back into the tracking map, where it stays
  forever.

---

# Part 6 — What this phase deliberately did not build

- **No `/metrics` or WebSocket connection count.** DESIGN.md scopes that to
  phase 6 alongside Grafana for every service.
- **No frontend and no real Yjs client.** `y-monaco` and the editor are phase
  5. The tests drive the wire protocol directly, which is enough to prove the
  server side.
- **`session.started` is a log line, not an event**, same as phase 3's
  `queue.joined`/`match.created`; phase 7 puts it behind the real `EventLog`.
  Note it currently marks a *room opening on an instance*, so a session whose
  participants all disconnect and return logs it again — phase 7 has to dedupe
  on `session_id`.
- **Nothing subscribes to Matching's `match:session:{id}` channel.** Phase 3
  left it for "Collab or a future live-status channel"; Collab turned out not
  to need it, since a client learns its session id from `/match/join` and
  brings it to the socket. It stays for phase 5's live status.
- **No reveal or consent flow**, still. Matching owns that state per DESIGN.md
  and nothing has needed it yet. *(Phase 5 built it. Collab needed no change:
  the answer never enters the Yjs document — it is released by Matching to the
  browser over HTTP, which is exactly what ADR-06 requires, since a document
  replicates to every peer.)*
- **CI does not orchestrate sibling services for the contract tests**, same
  caveat as phase 3: `clients.test.ts` calls a real Users, Matching and
  Questions and passes locally, but the per-service CI matrix brings up only
  Postgres and Redis, so those cases skip there.

---

# Part 7 — Demonstrating the claims

```bash
docker compose up -d --build
```

## Get three tokens and a real session

Three, not two: claim 1 needs somebody who is *not* in the session.

```bash
sign_up() {
  curl -s -X POST "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"password123\",\"returnSecureToken\":true}" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["idToken"])'
}
TOKEN_A=$(sign_up alice@example.com)
TOKEN_B=$(sign_up bob@example.com)
TOKEN_C=$(sign_up carol@example.com)

for T in "$TOKEN_A" "$TOKEN_B" "$TOKEN_C"; do
  curl -s -H "Authorization: Bearer $T" http://localhost:8080/users/me > /dev/null
done

curl -s -X POST http://localhost:8080/match/join \
  -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' \
  -d '{"topic":"os","difficulty":"hard"}'
SESSION_ID=$(curl -s -X POST http://localhost:8080/match/join \
  -H "Authorization: Bearer $TOKEN_B" -H 'Content-Type: application/json' \
  -d '{"topic":"os","difficulty":"hard"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["session"]["id"])')
echo "$SESSION_ID"
```

## Claim 1 — a socket cannot open a session its user is not in

Straight to Collab, bypassing the Gateway, the rejection is a plain HTTP one —
this is `authorizeConnect`'s own decision in isolation:

```bash
curl -si "http://localhost:8084/collab/connect?sessionId=$SESSION_ID" \
  -H 'x-user-id: someone-not-in-this-session' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' | head -1
# HTTP/1.1 403 Forbidden
```

Through the Gateway the same rejection is a `101` followed immediately by a
close, for the reason in Part 1 — so it needs a client that can observe what
happens *after* the handshake, which `curl` cannot:

```bash
cd services/collab && node --input-type=module -e '
import WebSocket from "ws";
const url = `ws://localhost:8080/collab/connect?sessionId=${process.env.SESSION_ID}&token=${process.env.TOKEN_C}`;
const ws = new WebSocket(url);
let bytes = 0;
ws.on("open", () => console.log("open"));
ws.on("message", (d) => { bytes += d.length; });
ws.on("close", (c) => console.log("closed", c, "— document bytes received:", bytes));
'
# open
# closed 1011 — document bytes received: 0
```

Swap `TOKEN_C` for `TOKEN_A` and it stays open and receives its scaffold
instead.

## Claims 2 and 3 — convergence, late join, and restore

These are the four tests in
[`sync.test.ts`](../../services/collab/src/sync.test.ts), each standing up two
independent room managers over one real Redis — the same shape two real Collab
processes have:

```bash
export DATABASE_URL=postgresql://deepcs:deepcs@127.0.0.1:5432/deepcs
export REDIS_URL=redis://127.0.0.1:6379
export QUESTIONS_URL=http://127.0.0.1:8082
pnpm --filter @deepcs/collab test sync.test.ts
```

Note the missing `--`: `pnpm run <script> -- <arg>` passes the `--` through
literally here, and vitest then treats it as a filter that matches nothing, so
the whole suite runs and it looks like it worked.

To watch the convergence test actually catch its bug, comment out
`seed.clientID = SEED_CLIENT_ID` in
[`rooms.ts:107`](../../services/collab/src/rooms.ts#L107) and run it again —
the two instances go back to seeding unrelated documents and the incremental
edit never lands.

## Running the whole suite

```bash
export DATABASE_URL=postgresql://deepcs:deepcs@127.0.0.1:5432/deepcs
export COLLAB_DATABASE_URL=postgresql://collab_svc:collab_svc@127.0.0.1:5432/deepcs
export REDIS_URL=redis://127.0.0.1:6379
export USERS_URL=http://127.0.0.1:8081
export MATCHING_URL=http://127.0.0.1:8083
export QUESTIONS_URL=http://127.0.0.1:8082
pnpm --filter @deepcs/collab test
```

Real Postgres, Redis, Users, Matching and Questions — never mocks (§8). The
cross-instance relay, the schema boundary and the sibling services' response
shapes are all real-system properties; a mock would only prove itself
self-consistent.
