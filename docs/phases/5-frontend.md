# Phase 5 — The frontend, and the reveal rule behind it

**What this phase proves** (DESIGN.md §10):

- the whole loop works from a browser: sign in, browse, match, co-write, reveal, end
- an answer is released only when *both* people agree, and neither service can
  release it alone
- ending a session really ends it — the document stops accepting edits
- the browser's half of the collab protocol agrees with the server's

Every heading below links to the code it describes. Open the file alongside this
page — the comments in the source explain *what*, this document explains *why*
and how the pieces connect.

---

# The four things — read this page, then stop if you're short on time

## 1. The reveal rule is split so that neither half can leak · ~10 min

📄 [`questions/src/index.ts:121`](../../services/questions/src/index.ts#L121) ·
[`matching/src/index.ts:273`](../../services/matching/src/index.ts#L273)

**The failure:** the answer key lives in the same table row as the question,
and two people are supposed to see it only after both agree. The obvious
design — let the browser ask Questions for the answer once the UI decides it
is allowed — puts the decision in the one place an attacker controls.

**The mechanism, which is ADR-06 made real.** Questions holds `reference_md`
and has no idea who is in a session. Matching knows exactly who consented and
never stores the answer. The browser asks *Matching*, which checks both uids
are in `reveal_consents` and only then fetches the text over the internal
network. Neither service can release it alone, and that is a property of the
data each one holds rather than of a check either could forget.

**Say it as:** *"Split the secret from the authority to release it. Then a bug
in either service is not enough on its own — the one that knows who consented
cannot read the answer, and the one holding the answer cannot know who
consented."*

## 2. A route's prefix was the whole access control · ~5 min

📄 [`questions/src/index.ts:106-121`](../../services/questions/src/index.ts#L106)

**The failure:** Questions has to expose the answer *somehow* for Matching to
fetch it. The natural name is `GET /questions/:id/reference` — and that route
would have been readable by anyone with a browser. The Gateway proxies four
prefixes (`/users`, `/questions`, `/match`, `/collab`) and does no filtering
on what follows, so every path under `/questions/` is public by construction.

**The mechanism:** it lives at `/internal/questions/:id/reference`. Nothing
proxies `/internal`, so the route is reachable from inside the network and
nowhere else. Claim 2 below checks this by asking the Gateway for it and
requiring a 404.

**Say it as:** *"When a proxy forwards a prefix rather than a route list, the
URL you choose is a security decision. 'Nobody would call it' is not a
control — not being routable is."*

## 3. Ending a session is enforced somewhere it is not written · ~5 min

📄 [`matching/src/index.ts:225`](../../services/matching/src/index.ts#L225)

**The failure:** "end session" that only navigates away. Both people can still
reopen the document and keep editing, because Collab has never heard of ending
and its authorization does not mention it.

**The first mechanism:** `POST /match/sessions/:id/end` sets `ended_at`, and
the *participant* route then reports `participant: false`. That route is the
single check Collab runs before allowing any socket, so an ended session stops
accepting **new** connections with no change to Collab at all.

**Which was not enough, and manual testing is what found it.** A socket
already open never re-checks anything. It kept accepting edits, and the 30s
snapshot kept saving them — so the "final" document went on changing after the
session was over, and phase 6's summary would have read whatever it drifted to.
The person who did not press the button also got no indication at all; their
editor simply carried on working.

**So Matching now publishes `session.ended`** on the `match:session:{id}`
channel that phases 3 and 4 both reserved for exactly this. Collab subscribes
per room, takes a final snapshot, tears the room down and closes each socket
with code **4001** — a code in the application range, so the browser can tell
"this is over" from "the connection dropped" and does not reconnect forever
against a session that will never accept it. The other person's editor goes
read-only under a banner rather than going blank.

**Say it as:** *"Authorization checks run once, at the door. A rule that has to
hold for the whole life of a connection cannot live only there — something has
to reach in and close what is already open."*

## 4. A column that arrived with a bug attached · ~5 min

📄 [`matching/src/repository.ts:41-53`](../../services/matching/src/repository.ts#L41)

**The failure:** `POST /match/join` uses "does this user already have a
session?" as its idempotence guard — the thing that makes a retried join safe.
The moment `ended_at` exists, that question has a second meaning, and the old
answer is wrong: a user who finishes one session would be handed that same dead
session on every future join, forever, and could never be matched with anyone
again. The feature would have looked complete and quietly broken re-matching
for every user who used it.

**The mechanism:** one clause, `AND ended_at IS NULL`, plus a partial index for
it. The test that guards it ends a session and then asserts the same user can
match into a different one.

**Say it as:** *"Adding a state to a record changes the meaning of every query
that already filtered on that record. The bug is not in the new code — it is in
the old code that was correct until the state existed."*

---

# Read the code in this order

| # | File | What it is |
|---|---|---|
| 1 | [`packages/db/migrations/008_session_consent.sql`](../../packages/db/migrations/008_session_consent.sql) | Two columns and a partial index. Start here. |
| 2 | [`services/questions/src/index.ts`](../../services/questions/src/index.ts#L121) | The internal route that releases the answer. |
| 3 | [`services/matching/src/index.ts`](../../services/matching/src/index.ts#L273) | Consent, reveal and end — where the rule is enforced. |
| 4 | [`frontend/src/api.ts`](../../frontend/src/api.ts) | The typed client. Every call goes through the Gateway. |
| 5 | [`frontend/src/collab.ts`](../../frontend/src/collab.ts) | The browser's half of the Yjs wire protocol. |
| 6 | [`frontend/src/pages/Session.tsx`](../../frontend/src/pages/Session.tsx) | Monaco, the binding, reveal and end. |
| 7 | [`frontend/vite.config.ts`](../../frontend/vite.config.ts) | The CSP the Gateway deferred, and one dependency workaround. |

---

# Part 1 — Consent, and where it is stored

📄 [`packages/db/migrations/008_session_consent.sql`](../../packages/db/migrations/008_session_consent.sql) ·
[`repository.ts:86`](../../services/matching/src/repository.ts#L86)

```sql
ALTER TABLE matching.sessions
  ADD COLUMN IF NOT EXISTS reveal_consents text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ended_at        timestamptz;
```

An array rather than a `session_consents` table: a session has exactly two
participants and always will, so the join table would buy normalisation nobody
reads. `ended_at` is nullable rather than a `status` column — "not ended" is
the absence of an end time, not a second state to keep in sync, and it doubles
as the timestamp the summary needs.

**Consent is recorded in SQL, not read-modify-write in the route**
([`repository.ts:86`](../../services/matching/src/repository.ts#L86)):

```sql
SET reveal_consents = CASE
      WHEN $2 = ANY (reveal_consents) THEN reveal_consents
      ELSE array_append(reveal_consents, $2)
    END
```

Both people can press Reveal in the same instant. Two concurrent
read-then-writes would drop one of them — and the failure would not be an
error, it would be an answer that silently never unlocks. This is the same
shape as phase 1's rate limiter and phase 3's pair claim: decide and write in
one statement, where the state lives.

The `CASE` also makes pressing twice a no-op, which matters more than it
looks: a length check on the array would otherwise read one enthusiastic user
as mutual consent.

---

# Part 2 — Releasing the answer

📄 [`questions/src/repository.ts:45`](../../services/questions/src/repository.ts#L45) ·
[`matching/src/index.ts:273`](../../services/matching/src/index.ts#L273)

`getReferenceMd` is the only function in Questions that selects
`reference_md`, and its only caller is the `/internal` route. Everything
public still goes through `SUMMARY_COLUMNS`, which does not mention the column
— phase 2's guarantee is untouched.

Matching's side is `toRevealResponse`
([`index.ts:273`](../../services/matching/src/index.ts#L273)): it checks that
*both* participant uids appear in `reveal_consents`, and only then calls
Questions. Until that moment the response has no `referenceMd` field at all —
not an empty string, not a null, absent. A test asserts the absence rather
than a flag, because a UI that trusts `revealed: false` while the text sits in
the payload has leaked it to anyone with developer tools open.

Three routes share one preamble, `loadForParticipant`
([`index.ts:238`](../../services/matching/src/index.ts#L238)): valid uuid,
authenticated caller, real session, caller is in it. A non-participant gets
403 rather than 404 — they are authenticated and the session exists, they
simply are not part of it.

---

# Part 3 — The browser's half of the collab protocol

📄 [`frontend/src/collab.ts`](../../frontend/src/collab.ts) ·
[`frontend/src/collab.test.ts`](../../frontend/src/collab.test.ts)

There is no `y-websocket` here, for the same reason the server does not use its
server package: the framing is this project's own, so a stock provider would
not speak it. It is roughly eighty lines either way, and writing it keeps the
wire format visible.

The two branches are **not symmetric**, and this is the detail that costs an
afternoon if missed — a sync message writes its body directly, an awareness
message is length-prefixed:

```ts
// sync
encoding.writeVarUint(encoder, MESSAGE_SYNC);   // 0
syncProtocol.writeUpdate(encoder, update);
// awareness
encoding.writeVarUint(encoder, MESSAGE_AWARENESS);   // 1
encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(...));
```

On open the client sends sync step 1; the server's step 2 reply is how the
scaffold and everything typed before now arrives.

**Rejections look different depending on who rejected**
([`collab.ts:34`](../../frontend/src/collab.ts#L34)), which is why
`CollabStatus` has five values rather than a boolean. A bad token is refused by
the Gateway and the socket never opens. A refusal from Collab — not a
participant, or the session ended — arrives as a socket that *opens* and then
closes having delivered nothing, because `@fastify/http-proxy` completes the
client handshake before dialing upstream. The client distinguishes them by
whether `open` fired and whether any bytes arrived, and only retries the case
that can succeed.

**This client is tested against the real server**
([`collab.test.ts`](../../frontend/src/collab.test.ts)). The server's framing
already had tests, but those ship their own reference client — `collab.ts` is a
second implementation of the same format, and until this suite existed nothing
proved the two agreed. It runs in Node, which has a global `WebSocket`, with a
real emulator token.

---

# Part 4 — Monaco, bound to a document it does not own

📄 [`frontend/src/pages/Session.tsx:36-94`](../../frontend/src/pages/Session.tsx#L36) ·
[`frontend/src/monaco.ts`](../../frontend/src/monaco.ts)

```ts
const text: Y.Text = collab.doc.getText('content');
new MonacoBinding(text, editor.getModel()!, new Set([editor]), collab.awareness);
```

`"content"` is not a name chosen here — it is the field the Collab service
seeds the scaffold into, so binding to anything else yields an empty editor
that syncs with nobody. Passing `awareness` as the fourth argument is what
makes remote cursors appear; presence needed no code of its own.

One effect owns the socket, the document, the editor and the binding, because
they have exactly one lifetime between them. Splitting them is how you end up
with an editor bound to a destroyed document after a re-render — which is also
why the `react-hooks` lint rules were added in this phase.

**Monaco is imported as `editor.api`, not the package root.** The root
registers every language it ships with, and building against it emitted a
6.9 MB TypeScript worker, a 1 MB CSS worker and a 740 kB HTML worker for a
document that is prose. The core is 792 kB gzipped, which is most of the
bundle and inherent to the editor DESIGN.md chose.

---

# Part 5 — What this phase deliberately did not build

- **No router.** Five screens and no deep-linking requirement, so view state is
  a `useState` switch. The cost is real and worth naming: refreshing mid-session
  returns you to the question list rather than rejoining, because the session id
  lives only in memory.

  *Superseded in 5b.* The cost named above turned out to be the smaller half of
  it: with one address for the whole site the browser held a single history
  entry, so **Back left the site entirely**. That is the version people notice,
  and it took about four screens longer than it should have to fix. See
  [5b-roadmap.md](./5b-roadmap.md) part 3.
- **No leave-the-queue endpoint.** "Stop waiting" stops the polling but leaves
  the queue entry, which the next joiner claims. `queue.ts` has `join` and
  `isWaiting` and nothing to undo them.

  *This one bit in 5b, in a way worth recording.* Leaving the queue entry is
  defensible on its own. What was not defensible was that only the match screen
  watched for the result, so someone who queued and then navigated away was
  matched into a session nobody told them about, while their partner sat alone in
  the editor. The watching moved into the app shell; the queue entry still
  cannot be withdrawn.
- **No summary endpoint.** The summary is rendered from state the browser
  already holds. The richer version — sessions solved, popular topics — is fed
  by the event log, which is phase 6.
- **`reveal.consented` and `session.ended` are log lines**, the last two of
  DESIGN.md's six events. Phase 6 puts them behind the real `EventLog`.
- **No frontend container.** It runs with `pnpm --filter @deepcs/web dev` rather
  than `docker compose up`, because in phase 10 it is a static bundle on a CDN
  and the shared Dockerfile builds Node servers out of `services/`.
- **CSP is a meta tag, injected on build only.** The dev server needs inline
  scripts for hot reload, and a policy loose enough to permit those is not worth
  shipping. Phase 10 moves it to a CDN response header, where it can also express
  `frame-ancestors`.
- **No component tests.** The one suite that exists tests the protocol client,
  which is the part with a contract to break. The pages are thin enough that a
  render test would mostly assert that React renders.

---

# Part 6 — Demonstrating the claims

```bash
docker compose up -d --build
pnpm --filter @deepcs/db migrate
pnpm --filter @deepcs/web dev     # http://localhost:5173
```

The frontend needs no `.env` — every value defaults to the local emulator in
[`frontend/src/config.ts`](../../frontend/src/config.ts). To point the browser
SDK at the emulator explicitly, put
`VITE_FIREBASE_AUTH_EMULATOR=http://localhost:9099` in `frontend/.env.local`.

## Claim 1 — the whole loop, in two browsers

Open <http://localhost:5173> in two different browser profiles (or one normal
and one private window — two tabs of the same profile share a Firebase session
and would sign in as the same person). Create an account in each, pick the same
topic and difficulty in both, and press *Join the queue*.

Both land in the same document. Type in one and watch it appear in the other,
with a coloured cursor carrying the other account's name. Press *Reveal the
answer* in one: it says it is waiting. Press it in the other and the reference
appears in both. Press *End session* and the summary replaces the editor.

## Claim 2 — the answer is not reachable from a browser

```bash
QID=$(curl -s "http://localhost:8082/questions?limit=1" | jq -r '.items[0].id')

curl -s -o /dev/null -w "through the Gateway: %{http_code}\n" \
  "http://localhost:8080/internal/questions/$QID/reference"
# through the Gateway: 404

curl -s "http://localhost:8082/internal/questions/$QID/reference" | head -c 60
# {"referenceMd":"## ...     — reachable only from inside the network
```

## Claim 3 — one consent is not enough

```bash
# A and B matched into $SID (see the reveal tests for the full setup)
curl -s -X POST "http://localhost:8083/match/sessions/$SID/reveal" -H "x-user-id: $A"
# {"you":true,"partner":false,"revealed":false}   — no referenceMd field at all

curl -s -X POST "http://localhost:8083/match/sessions/$SID/reveal" -H "x-user-id: $A"
# {"you":true,"partner":false,"revealed":false}   — pressing twice is still one

curl -s -X POST "http://localhost:8083/match/sessions/$SID/reveal" -H "x-user-id: $C"
# 403 — a third party cannot consent on anyone's behalf

curl -s -X GET  "http://localhost:8083/match/sessions/$SID/reveal" -H "x-user-id: $B"
# {"you":false,"partner":true,"revealed":false}   — the same state, B's side of it

curl -s -X POST "http://localhost:8083/match/sessions/$SID/reveal" -H "x-user-id: $B"
# {"you":true,"partner":true,"revealed":true,"referenceMd":"## ..."}
```

## Claim 4 — ending really ends it

```bash
curl -s -X POST "http://localhost:8083/match/sessions/$SID/end" -H "x-user-id: $A"
# {"endedAt":"..."}

curl -s "http://localhost:8083/match/sessions/$SID/participant" -H "x-user-id: $A"
# {"participant":false}   — which is what makes Collab refuse a *new* socket.
# An already-open one is closed by the session.ended event, with code 4001;
# sync.test.ts asserts both the code and that post-end edits never persist.

curl -s -X POST http://localhost:8083/match/join -H 'Content-Type: application/json' \
  -H "x-user-id: $A" -d '{"topic":"os","difficulty":"hard"}'
# {"status":"waiting"}    — A can be matched again, which is the bug in thing 4
```

## Claim 5 — a session names nobody

The strongest form of this is not reading the code. It is being one participant,
touching every route a browser can reach, and searching the bytes that come back
for anything belonging to the other one — HTTP bodies, every WebSocket frame,
and the Yjs document state:

```bash
pnpm --filter @deepcs/matching test -t "never names the other participant"
```

That test asserts on serialised response bodies rather than on named fields, so
a uid reintroduced under any name at any depth fails it. Two payloads had to be
changed to make it pass, and both are worth knowing about because neither looked
like an identity leak:

- `partnerUid` rode on every session response. Only the match page used it, to
  print one line. Collab parsed it and dropped it.
- `reveal` returned `consented`, the list of uids that had agreed — so the moment
  your partner agreed you held their id. It also could not answer what the UI was
  actually asking. `{you, partner}` can, and names no one.

The reason this matters more than it looks: everything else about a session is
already anonymous — awareness carries no identity, and the remote caret is drawn
in one colour precisely so that no name is needed to key it. A single field in a
JSON body undoes all of that, silently, because nothing has to render it for the
browser to have been handed it.

## Running the tests yourself

```bash
export DATABASE_URL=postgresql://deepcs:deepcs@127.0.0.1:5432/deepcs
export MATCHING_DATABASE_URL=postgresql://matching_svc:matching_svc@127.0.0.1:5432/deepcs
export REDIS_URL=redis://127.0.0.1:6379
export USERS_URL=http://127.0.0.1:8081
export MATCHING_URL=http://127.0.0.1:8083
export QUESTIONS_URL=http://127.0.0.1:8082
export VITE_GATEWAY_URL=http://localhost:8080
export VITE_FIREBASE_AUTH_EMULATOR=http://localhost:9099

pnpm --filter @deepcs/matching test    # the reveal rule and ending
pnpm --filter @deepcs/web test         # the browser's collab client
```

Real Postgres, real Redis, real services and a real emulator token — never
mocks (§8). What is being checked here is that two independent implementations
of one wire format agree, and that an answer stays unreachable; a mock would
only prove itself self-consistent.
