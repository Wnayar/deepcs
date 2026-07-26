# DeepCS — Design Doc Q&A

Answers to my questions on `DESIGN.md`. Each section quotes the question I asked.

**Contents**

1. [Empty room](#1)
2. [WebSocket](#2)
3. [HTTP](#3)
4. [CORS](#4)
5. [Gateway routing](#5)
6. [What the worker does](#6)
7. [Rate-limit buckets + Redis](#7)
8. [Upstash](#8-and-19) · 19. [Redis](#8-and-19)
9. [Redis pub/sub](#9)
10. [Redis Streams](#10)
11. [PostgreSQL — Neon ×1](#11)
12. [Collab snapshots](#12)
13. [Arrow direction on the worker](#13)
14. [Refresh tokens](#14-and-29) · 29. [Auth line](#14-and-29)
15. [Worker bookmarks](#15-and-28) · 28. [Worker mechanics](#15-and-28)
16. [**Important — service partitioning**](#16)
17. [Fastify](#17)
18. [Neon / text[] / GIN / tsvector](#18)
20. [Yjs + why "CRDT"](#20)
21. [Containers](#21)
22. [RS256 keys + injected headers](#22)
23. [Lua + token bucket](#23-and-26) · 26. [Is Lua necessary](#23-and-26)
24. [NGINX and building our own gateway](#24)
25. [Question bank + Core auth](#25)
27. [The Collab service](#27)
30. [Prometheus](#30)
31. [Graceful shutdown + idempotency](#31)
32. [Kill switch / Cloud Function](#32)
33. [max-instances vs concurrency](#33)
34. [Public URL cost layer](#34)
35. [GKE and the k8s detour](#35)
36. [Types of testing](#36)
37. [k6 + concurrency fundamentals](#37)
38. [ADRs](#38)
39. [Distributed system + real-time](#39)
40. [Build-phase methodology](#40)

---

<a id="1"></a>
## 1. "matchmaking alone would demo as an empty room"

If the *only* feature were "get matched with someone", then a recruiter who opens your live URL alone sees a spinner saying "waiting for a partner…" forever, because there is no second user. The demo is unusable by one person.

The public question bank fixes this: a single visitor can search, filter, and read questions immediately, and matchmaking becomes the extra layer they can read about. It also means your load test and your event stream have something to exercise without needing paired users.

---

<a id="2"></a>
## 2. "how WebSocket works"

Read §3 first if HTTP is unclear, since WebSocket starts as HTTP.

1. The browser sends a normal HTTP GET with `Upgrade: websocket`, `Connection: Upgrade`, and a random `Sec-WebSocket-Key`.
2. The server replies `101 Switching Protocols` with a hash of that key.
3. From that point the same TCP connection (TCP: the OS-level byte-stream connection underneath both protocols) stops speaking HTTP and speaks the WebSocket frame format instead.

After the upgrade, **either side can send at any time** with no request needed, and the connection stays open for minutes or hours. Messages are *frames* with a tiny header (2–14 bytes), so a 20-byte edit costs about 22 bytes on the wire instead of a fresh set of HTTP headers.

**Why DeepCS needs it:** when User B types, the server must push that to User A *unprompted*. HTTP cannot do that — the client must ask. Ping/pong frames keep the connection alive through proxies that kill idle sockets.

**The cost, which shapes the whole deploy:** an open socket is a resource held on the server for its entire life. Cloud Run bills and counts it as one in-flight request the whole time, which is why Collab gets `--concurrency=250 --timeout=3600s`.

---

<a id="3"></a>
## 3. "how HTTP works"

Request/response, one shot, client-initiated:

1. Browser resolves the domain to an IP (DNS), opens a TCP connection, does the TLS handshake for `https`.
2. Browser sends a **request**: a method (`GET`/`POST`/…), a path (`/questions?tag=os`), headers (`Authorization: Bearer …`, `Content-Type`), and optionally a body.
3. Server sends a **response**: a status code (200 OK, 400 Bad Request, 429 Too Many Requests, 500 Internal Server Error), headers, and a body (usually JSON here).
4. The exchange is over. The server keeps nothing about you between requests — that's what "stateless" means, and it's why every request must carry the JWT again.

HTTP/1.1 and HTTP/2 reuse the TCP connection for several requests, but the *pattern* stays ask→answer. There is no way for the server to speak first. That single limitation is the entire reason WebSocket exists.

---

<a id="4"></a>
## 4. "CORS"

CORS (Cross-Origin Resource Sharing) is a **browser-enforced** rule, not a server security feature.

An *origin* is scheme + host + port, so `https://deepcs.app` and `https://api.deepcs.app` are different origins. By default, JavaScript on one origin may not read a response from another. Without CORS, any random site you visit could make authenticated requests to your API using your cookies and read the results.

The mechanism:

- **Simple requests:** the browser sends the request with an `Origin:` header, then checks the response for `Access-Control-Allow-Origin`. If it doesn't match, the browser throws away the response and errors in the console — **the server already ran the request**.
- **Anything non-simple** (custom headers like `Authorization`, methods like `PUT`/`DELETE`) triggers a **preflight**: the browser first sends `OPTIONS` and only sends the real request if the response allows the method and headers.

In DeepCS the Gateway returns `Access-Control-Allow-Origin: https://<your-frontend>` — exactly one origin, not `*`.

Important detail: because CORS is enforced by the browser, `curl` and any script ignore it entirely. It protects *your users' browsers*, not your API. Rate limiting and JWT verification are what protect the API.

---

<a id="5"></a>
## 5. "how does the gateway know where to route the request"

You write the rules. It's a table in your Gateway code, matched on the request path:

- `/auth/*`, `/questions/*`, `/match/*`, `/sessions/*`, `/stats` → **Core**
- `/collab/*` (the WebSocket upgrade) → **Collab**

The Gateway then makes a *new* HTTP request to Core's URL (from an env var like `CORE_URL=https://core-xyz.a.run.app`), copies the response back to the browser, and adds `X-User-Id`. For `/collab/*` it proxies the WebSocket upgrade and then pipes bytes both ways for the life of the socket.

Two details worth knowing:

- Cloud Run gives each service its own stable HTTPS URL, so "service discovery" here is just two env vars. In Kubernetes (phase 9) it's a DNS name like `http://core.default.svc.cluster.local` instead.
- Set Core and Collab to **internal ingress + require IAM auth** so only the Gateway can reach them. Otherwise the trust boundary is fiction — anyone could call Core's URL directly and skip JWT checks.

---

<a id="6"></a>
## 6. "What is the worker doing?"

Two jobs, both offline:

1. **Session summaries.** When a session ends, Core appends a `session.ended` event. The worker later reads it and writes one row: duration, topic, whether the reveal was used. That's what `GET /sessions/:id/summary` serves.
2. **Aggregate stats.** It rolls events up into counts: sessions per day, median match wait (from `queue.joined` → `match.created` timestamps), popular topics. That's `GET /stats`.

Why not compute this inline when the session ends? Two reasons. The user's "end session" request would have to wait on aggregate queries that get slower as data grows. And `/stats` computed on demand would scan the whole events history on every page load. Pre-computing off the request path fixes both.

The tradeoff you accept: a summary can be up to 5 minutes late, so the session page shows "summary pending".

---

<a id="7"></a>
## 7. "What is rate limit buckets and how is it linked to Redis"

A bucket is a tiny piece of state per client: **how many tokens they have left, and when it was last topped up.** Concretely, `{tokens: 37.5, last_refill_ms: 1753...}`.

Rules: capacity 100, refill 10/sec. Each request subtracts 1. If tokens < 1, return 429. So a client can burst 100 requests instantly, then is held to 10/sec sustained.

The Redis link is about *where that state lives*.

**Scenario:** you keep the bucket in the Gateway process's memory. Cloud Run scales you to 2 Gateway instances.

**Failure:** each instance has its own bucket for the same attacker, so your effective limit is 200/burst, not 100. Worse, the instance scales to zero and every bucket resets — an attacker just waits for a cold start.

**Fix:** the buckets live in Redis, keyed `rl:user:42` / `rl:ip:1.2.3.4`, with a TTL so idle keys evict themselves. Both Gateway instances read and write the same key, so the limit is global no matter how many instances exist or how often they restart.

Redis is the shared brain that makes stateless services behave as one.

---

<a id="8-and-19"></a>
## 8 & 19. "What is Upstash" / "what is Redis (Upstash means. I don't get the Upstash)"

**Redis** is the software: an in-memory key-value database. It keeps data in RAM, so reads and writes take microseconds instead of the milliseconds Postgres takes. It's single-threaded and runs one command at a time to completion. It gives you data structures, not just strings — sorted sets (your match queue), hashes (rate-limit buckets), pub/sub channels, and streams. Data is optional to persist; you use it for things that are hot, short-lived, or shared across instances.

**Upstash** is a company that runs Redis for you as a hosted service. You do not install Redis, patch it, monitor its memory, or configure backups. You sign up, they give you a URL and a password, you put them in env vars, and your code connects with a normal Redis client. Their free tier allows about 10,000 commands/day and they charge per request rather than per hour, so an idle app costs $0 — which is why it fits a scale-to-zero design. Neon is the same idea for Postgres.

So `Redis — Upstash ×1` reads as: **one Redis instance, and Upstash is who operates it.** The `×1` matters because it's the contrast with the blue boxes — those scale 0–2, this is a single always-on instance that everything shares.

---

<a id="9"></a>
## 9. "Where is the pub/sub in Redis"

Pub/sub is a **built-in Redis feature**, not a separate product or a data structure you store. Three commands: `SUBSCRIBE channel`, `PUBLISH channel message`, `UNSUBSCRIBE`.

How it behaves: `PUBLISH session:s42 "<edit>"` immediately delivers that message to every connection currently subscribed to `session:s42`, then forgets it. Nothing is stored. If no one is subscribed, the message vanishes. If a subscriber is disconnected for 200 ms, it misses whatever was published in that window, permanently.

That's acceptable for live Yjs edits (a missed update is repaired by Yjs re-syncing state on reconnect) and it's the fastest option — sub-millisecond fanout. It is *not* acceptable for domain events you must not lose, which is why those go to a Stream instead (§10).

You use it in two places: one channel per session for cross-instance edits, and one channel for `match.created` so a waiting user is notified instantly.

---

<a id="10"></a>
## 10. "What is the event stream in Redis"

A **Redis Stream** is a different built-in feature: an append-only log stored inside Redis.

- `XADD events * type match.created data '{...}'` appends an entry and returns an ID like `1753449600123-0` (milliseconds-sequence, always increasing).
- Reading does **not** delete. Entries stay until you trim them (`XTRIM`, or `MAXLEN`).
- Readers get a bookmark held *by Redis* (see §15), so a reader that goes away and comes back continues where it left off.

The difference from pub/sub, which is the whole reason both exist in your design:

| | pub/sub | Stream |
|---|---|---|
| If no reader is connected | message lost | entry waits |
| After reading | gone | still there |
| Re-read history | impossible | yes, rewind the bookmark |

Your worker only exists for 5 seconds every 5 minutes. With pub/sub it would miss 99% of events. The Stream holds them until it wakes up. And because entries survive reading, you can fix a bug in the summary logic, rewind, and recompute from real history — that's ADR-07.

---

<a id="11"></a>
## 11. "What does PostgreSQL - Neon x 1 mean"

**PostgreSQL** is the relational database: tables, rows, columns, SQL, ACID transactions (all-or-nothing writes), foreign keys. It's your durable source of truth — users, questions, sessions, snapshots, summaries.

**Neon** is a company that hosts Postgres for you (same relationship as Upstash→Redis). Their free tier gives you 0.5 GB storage and a connection string. Their notable trait is that compute separates from storage, so an idle database suspends and wakes on the next query — again matching a scale-to-zero design.

**×1** means one database instance, always on, shared by every service instance. Contrast with the Gateway/Core/Collab boxes, which are 0–2 and disposable.

The whole architecture works because state is concentrated in these two ×1 boxes: any blue container can be killed at any moment and nothing is lost.

---

<a id="12"></a>
## 12. "How does collab snapshot every 30 secs"

The live document exists only as a JavaScript object in one Collab instance's RAM.

**Scenario without snapshots:** two users have written 15 minutes of answer, Cloud Run recycles the instance, all text is gone.

The mechanism, three triggers:

1. **Timer.** When the first user opens session `s42`, Collab starts a `setInterval(…, 30_000)` for that session. Every tick it calls `Y.encodeStateAsUpdate(doc)` — Yjs serialises the whole doc to a compact binary blob — and writes it to Postgres with `INSERT … ON CONFLICT (session_id) DO UPDATE SET data = $1, updated_at = now()`. One row per session, overwritten each time. Clear the interval when the last user leaves.
2. **On disconnect.** Snapshot immediately when the socket count for that session hits zero, so you don't wait up to 30 s.
3. **On SIGTERM.** Cloud Run sends SIGTERM before killing a container; you catch it, snapshot every doc in memory, then exit.

On reconnect: load the blob, `Y.applyUpdate(newDoc, blob)`, and the doc is restored. Worst-case loss is 30 s of typing, and only if the process dies without SIGTERM (a hard crash or OOM kill).

Two honest details: 30 s is a knob trading write volume against loss window, and Yjs blobs grow with edit history, so a long session eventually wants re-encoding onto a fresh doc to compact it.

---

<a id="13"></a>
## 13. "Why do you say worker pulls event every 5 mins but show the arrow pointing to Redis? is it because it initiates it not Redis."

Yes, exactly right, and your instinct is the correct one to have.

Redis is a pure server: it never initiates a connection to your code. It only ever answers commands. So the worker calls `XREADGROUP` and Redis replies with entries — the **initiator** is the worker, the **data** flows back the other way.

The arrow `WK -.-> RD` labelled "pulls new events" is drawn in the direction of initiation/dependency, which is the normal convention in architecture diagrams, and the label tells you data comes back. The dashes mean it's periodic rather than continuous.

Same convention elsewhere in the diagram: `CORE --> PG` labelled `SQL` — Core initiates, rows come back.

The one bidirectional arrow, `COLLAB <--> RD`, is drawn that way because Collab genuinely does both: it publishes edits *and* holds a long-lived subscriber connection where Redis pushes to it. That's the only place in your system where the storage layer sends something unprompted, and it's only possible because the subscription is a connection Collab opened and left open.

---

<a id="14-and-29"></a>
## 14 & 29. "Explain how the refresh tokens work" / "JWT RS256, 15-min access token; opaque refresh token in Redis, 7-day TTL, rotated on use; revoke on logout"

**The problem being solved:** a JWT is self-contained and verified by signature alone. Nothing is checked against a database, which is what makes it fast and stateless. But it also means you cannot revoke one. If it's stolen, it works until it expires.

Two opposite pressures: short expiry limits theft damage, but forces the user to log in constantly. Refresh tokens resolve this by splitting the two jobs.

**Access token** — JWT, 15 minutes, sent on every request as `Authorization: Bearer …`. Contains `sub` (user id), `exp`, and is signed. Verified by the Gateway with no lookup. If stolen, useful for at most 15 minutes.

**Refresh token** — an **opaque** random string (32 random bytes, hex). "Opaque" means it carries no data at all and is not signed; it's just a lookup key. Redis holds `refresh:<token> → {user_id: 42}` with a 7-day TTL (Redis deletes the key automatically after 7 days, so expiry needs no cleanup job). It's sent only to `POST /auth/refresh`, nowhere else.

The flow:

1. Login → Core returns access token + refresh token.
2. 15 minutes later a request returns 401. Client calls `POST /auth/refresh` with the refresh token.
3. Core looks it up in Redis. Not found → 401, log in again. Found → Core **deletes that key**, writes a *new* refresh token, and returns a new access + new refresh token. This is **rotation**.
4. **Logout** → delete the key. The refresh token is now dead server-side, which is the revocation JWTs can't do.

**Why rotation matters — the scenario it catches:** an attacker steals your refresh token and uses it. They get a new pair; your copy is now deleted from Redis. The next time *your* client refreshes, it gets a 401 out of nowhere. That 401 is a detectable signal that the token was replayed. The standard hardening is a "token family": if a *deleted* refresh token is presented, invalidate every token in that family, killing both sessions. Worth adding one line for that.

**Client storage**, which is where this usually goes wrong: keep the access token in memory only (a JS variable — not localStorage, which any XSS can read), and the refresh token in an `httpOnly; Secure; SameSite=Strict` cookie so JavaScript cannot touch it at all.

---

<a id="15-and-28"></a>
## 15 & 28. "does it manage its own bookmark or what" / "I don't get how the worker works and how it bookmarks etc"

**Redis manages the bookmark, not the worker.** That's the point of using a *consumer group*. You create it once:

```
XGROUP CREATE events summarizer 0
```

`summarizer` is the group name; `0` means start from the beginning of the stream. Redis now stores, server-side, "the `summarizer` group has been delivered up to ID X".

Each run of the worker does this loop:

1. `XREADGROUP GROUP summarizer worker-1 COUNT 100 STREAMS events >` — the `>` means "entries never delivered to this group". Redis returns up to 100 entries **and** moves them into the group's **Pending Entries List** (PEL) — delivered but not yet confirmed.
2. Process each entry — write the summary row, update stats.
3. `XACK events summarizer <id>` per entry. Ack removes it from the PEL. Now it's genuinely done.
4. Repeat until `XREADGROUP` returns nothing, then exit.

**Why the two-step (deliver, then ack) exists — the failure it handles:** the worker reads 100 entries, writes 40 summaries, then the container is killed. Those 100 entries are still in the PEL because they were never acked. On the next run, `XPENDING` / `XREADGROUP … 0` shows them again and they get reprocessed. **Nothing is lost.**

But note what that means: 40 of them are processed **twice**. This is **at-least-once delivery**, and it's why every worker write must be idempotent. Concretely: `INSERT INTO summaries (session_id, …) ON CONFLICT (session_id) DO NOTHING` — the second attempt writes nothing. For counters, don't do `count = count + 1`; instead record which event IDs have been applied, or recompute the aggregate from the summaries table.

One thing worth adding that the doc doesn't mention: **`XAUTOCLAIM`**. If a worker dies and its entries sit in the PEL under *its* consumer name, a later worker with a different name should claim entries idle for more than, say, 5 minutes. If you always use the same consumer name (`worker-1`), this matters less, but it's the standard safety net.

**Why the bookmark being server-side matters:** the worker has no disk and no memory between runs. It's a fresh container every 5 minutes. If it had to remember its own position, it would need somewhere to store it — and that's exactly the state you're trying not to have.

---

<a id="16"></a>
## 16. **Important — "I need you to truly convince me on how the partitioning for the microservices has been done"

This is the right question to press on, because most microservice splits are indefensible and the interviewer knows it.

### The principle

Split where the **forces** differ. Three forces, and a boundary needs at least two:

1. **Scaling trigger** — what makes this code need another instance?
2. **Failure domain** — what must be able to die without taking the rest down?
3. **Lifecycle** — how often does it change, and is a restart user-visible?

The corollary, which is the part that makes the argument credible: **if two pieces of code share all three forces, splitting them is a cost with no benefit.** That's why your answer is 3 services and not 6.

### Collab must be separate — the argument from platform config

This is the strongest one because it's mechanical and checkable, not a matter of taste.

Core's unit of work is a request lasting 10–50 ms. Collab's unit of work is a WebSocket lasting 20 minutes. Cloud Run counts an open WebSocket as **one in-flight request for its entire life**. The two therefore need opposite settings:

| | Core | Collab |
|---|---|---|
| `--concurrency` | 80 | 250 |
| `--timeout` | 60 s | 3600 s |

`--concurrency` and `--timeout` are **per-service flags**. You cannot set two values on one service. So if these were one service, you must pick one setting and something breaks:

- Pick `--timeout=60s`: **every collab session is severed once a minute.** Feature dead.
- Pick `--timeout=3600s`: a hung Core request now holds a billable slot for an hour instead of a minute. Your cost ceiling is gone.
- Pick `--concurrency=80` with sockets in the mix: 80 users in sessions saturate the instance, and then **login and question browsing queue behind idle open sockets** — sockets doing nothing but occupying slots. Your public bank goes slow because people are typing.

The platform's unit of configuration *is* the service. Different required config is therefore not a style preference — it forces a boundary. **This single argument is enough on its own.**

### Collab must be separate — the argument from state and deploy blast radius

Core is stateless: kill any instance, nothing is lost. Collab holds the live Yjs document in RAM and needs SIGTERM snapshot handling to shut down safely.

Scenario if they're merged: you merge a one-line pagination fix to the question bank. CI deploys the combined service. Cloud Run replaces the container. **Every live collaboration session is dropped**, users see a reconnect, and you're relying on snapshots to not lose text — because of a change to code that has nothing to do with collaboration.

Separated: Core deploys ten times a day and no session notices. Collab, once working, changes rarely, and each of its deploys is a deliberate act.

### Collab must be separate — the argument from failure isolation

An unbounded Yjs doc, a memory leak in awareness state, or one 50 MB paste OOM-kills the instance holding it. Merged, that kill takes down **login and the public question bank** — the only things a lone visitor can use, and the exact thing §1 was designed to protect. Separated, a Collab crash degrades one feature while the site stays up.

### Gateway must be separate — the argument from enforcement

Auth verification and rate limiting are **cross-cutting**: they must apply to every request without exception. Two failure scenarios if they're per-service:

- You add a fourth service in six months and forget the auth middleware. There is now an unauthenticated hole, and nothing structurally prevented it. With a Gateway, downstream services are unreachable from outside (internal ingress + IAM), so "was this JWT checked?" has exactly one answer in exactly one place.
- Rate limiting inside Core means a bot's flood has **already caused Cloud Run to start Core instances** before being rejected. You paid to say no. The limiter has to be in front of the expensive thing.

Be honest about the cost so it doesn't look like you missed it: the Gateway adds a network hop of a few ms and is a chokepoint. It's mitigated by being fully stateless and replicated 0–2, so its failure mode is "restart", and the hop buys you one enforcement point.

### Core must NOT be split further — the harder half

Why aren't auth, question bank, and matching three services? Run the three forces:

- **Scaling trigger:** all request-rate. Identical.
- **Failure domain:** matching is useless if auth is down; you'd never want one alive without the other.
- **Lifecycle:** all ordinary CRUD, same deploy cadence, restarts invisible.

Zero of three differ. And splitting would actively hurt: creating a session row references users *and* questions. In one service that's one SQL transaction. Split, it becomes either a distributed transaction or chatty internal HTTP calls replacing a join — you'd pay latency and consistency to buy nothing.

Name the anti-pattern you're rejecting explicitly: **one service per database table**. It produces boundaries aligned with no real force, so every feature then spans several services, and you get the operational cost of distribution with none of the independence.

### Worker must be separate — the argument from trigger type

Its trigger is **time**, not a request. Its scaling driver is **backlog size**, not traffic.

And there's a concrete impossibility if you merge it: a scaled-to-zero Core has **no running process**, so an in-process `setInterval` cannot fire. At 3am with no traffic, no instance exists, and no summary is ever computed. Cloud Scheduler starting a job container is the only way to have periodic work in a scale-to-zero system.

Secondary reason: an aggregate query that gets slower as data grows would occupy a request slot and add tail latency to real user requests.

### The falsifiable test — the line to say out loud

> "I split only where I could name a scenario requiring different instance counts, different platform config, or survival of the other's crash. Core versus Collab has three such scenarios. Auth versus question bank has none — so they're one service. Three services isn't a target I picked; it's the number of distinct force-profiles in the system."

And what you paid: 4 deployables, 4 CI paths, one extra network hop, no cross-service transactions, and more complex local dev. That's a real price, and the WebSocket config conflict alone justifies it.

---

<a id="17"></a>
## 17. "Fastify is just a framework so we don't have to work on such a low level"

Correct. To be precise about what each layer gives you:

- **Node's `http` module** already parses HTTP for you — you never touch TCP bytes or write header parsers. It gives you `(req, res)` with one callback for *every* request.
- **Fastify** sits above that and handles: routing (`GET /questions/:id` → this function, with `:id` extracted), JSON body parsing and serialisation, middleware/hooks so auth or logging runs before every handler, schema validation and typed request objects, error handling that turns a thrown error into a 500 instead of crashing the process, and a plugin system (`@fastify/websocket`, `@fastify/helmet`, `fastify-metrics`).

Without it you'd hand-write a path router, JSON parsing with body-size limits, and a try/catch on every handler — meaningful work with no learning payoff.

**Why Fastify over Express specifically:** it's roughly 2–3× faster on throughput (its JSON serialisation is compiled from your schema), it has first-class TypeScript types so `request.body` is typed rather than `any`, its schema validation is built in rather than bolted on, and its plugin encapsulation gives real scoping.

On the "am I skipping the fundamentals?" worry: your project's difficulty is in matching, CRDT sync, and event consumption. Re-implementing a router adds none of that.

---

<a id="18"></a>
## 18. "what does this mean — Relational, plus built-in tag filtering (text[] column + GIN index) and full-text search (tsvector)"

Neon is covered in §11 — hosted Postgres. The rest is the justification for *not* adding a second database. Three pieces:

**`text[]` column.** Postgres columns can hold arrays. So `tags text[]` stores `{os, scheduling, concurrency}` in **one row**, and you query `WHERE tags @> ARRAY['os']` ("contains"). The alternative in classic relational modelling is a `question_tags` join table plus a JOIN on every read. The array is simpler and, for read-heavy tag filtering, faster.

**GIN index.** A normal B-tree index maps one value to rows, so it can't index "any element of this array". GIN (Generalized Inverted Index) maps **each element** to the rows containing it — so `tags @> ARRAY['os']` jumps straight to matching rows instead of scanning all 500. Without it, the query still *works*; it just does a full table scan, which is fine at 500 rows and not at 500,000. You'd add `CREATE INDEX ON questions USING GIN (tags);`

**`tsvector` / full-text search.** `LIKE '%deadlock%'` is a substring match: it can't stem ("deadlocks" ≠ "deadlock"), can't rank results, and can't use an index for a leading wildcard. `tsvector` is Postgres's parsed-text type: it lowercases, strips stopwords, and stems words to roots. You store a generated column of `to_tsvector('english', title || ' ' || body)`, GIN-index it, and query `WHERE search_vec @@ plainto_tsquery('english', 'deadlock')` with `ts_rank()` for ordering.

The point of the row: search and tag filtering are usually the reason people add Elasticsearch. Postgres does both well enough at your scale, so you avoid an extra always-on service — which would also break the cost ceiling in §7 of the design doc.

---

<a id="20"></a>
## 20. "how Yjs achieves CRDT... and break down why the name CRDT is named that way"

**The name, unpacked backwards:**

- **Data Type** — it's a data structure with an API: a text document, a map, an array.
- **Replicated** — every participant holds a full local copy (a *replica*). There is no single authoritative copy.
- **Conflict-free** — this is the mathematical claim, not a promise of "no disagreements". It means: **applying the same set of updates in any order, any number of times, always yields the identical state.** Two replicas that have seen the same updates *cannot* differ, so there is never a conflict to resolve and no server needed to decide a winner.

The three properties that produce that: merging is **commutative** (order doesn't matter), **associative** (grouping doesn't matter), and **idempotent** (applying twice = once). Any structure with those three converges automatically.

**How Yjs does it (the YATA algorithm), short:**

Yjs text is not a string; it's a linked list of *items*. Every inserted character gets a permanent unique ID: `(clientID, clock)` — a random per-client number plus that client's own counter. An insert records **which item it came after** (`origin`) rather than a numeric position. That's what avoids the classic index-shifting problem: if you insert at index 5 while someone deletes index 2, an index-based edit lands in the wrong place, but "after item `(A,7)`" is still correct.

When two clients insert after the *same* origin, both orderings are valid, so Yjs needs a tie-break that every replica computes identically: it compares the client IDs. Deterministic input → deterministic result on every machine.

Deletion doesn't remove the item — it marks it as a **tombstone** — because a concurrent edit might reference it as an origin. Tombstones are garbage-collected later.

Merging is then just: insert any items you haven't seen (dedup by ID), apply any delete markers. Nothing needs to happen in order, so a message arriving late or twice is harmless.

The one honest caveat: convergence guarantees everyone ends up with the *same* text, not the text a human would have chosen. Two people typing at the same spot get both insertions interleaved deterministically, which can read oddly. CRDTs solve consistency, not editorial intent — and that's exactly why your doc scaffolds separate headings per part, so the two users work in different regions.

---

<a id="21"></a>
## 21. "A container essentially is just a program which somehow partitions the OS?"

Close, and worth being precise because the wrong mental model here causes real confusion later.

A container is **an ordinary process on the host's Linux kernel, with a restricted view of that kernel.** There is no second operating system, no emulated hardware, no hypervisor. `ps` on the host shows your Node process.

The restriction comes from two kernel features:

- **Namespaces** — what the process can *see*. Separate namespaces for PIDs (your process thinks it's PID 1 and can't see host processes), mounts (its own filesystem root — this is why it sees only your app and its libraries), network (its own interfaces and ports, so two containers can both bind :3000), users, and hostname.
- **cgroups (control groups)** — what the process can *use*: memory ceiling, CPU share. Exceed the memory limit and the kernel OOM-kills it. This is exactly what happens when your Collab instance holds too many Yjs docs.

An **image** is the other half: a stack of read-only filesystem layers built from your Dockerfile (base OS files + node_modules + your compiled JS) plus metadata about the start command. A container is a running instance of an image with a thin writable layer on top. Layers are content-addressed and cached, which is why rebuilding after changing one source file is fast.

The two consequences that matter for your design:

1. **Sharing the host kernel** is why containers start in about 100 ms while a VM takes about 30 s. That's what makes Cloud Run's scale-to-zero viable — a cold start is a container start.
2. **The writable layer is destroyed with the container.** Anything written to local disk is gone on restart. That is *the* reason all state lives in Neon and Upstash, and the reason Collab must snapshot to Postgres.

Versus a VM: a VM emulates hardware and runs a full guest kernel — heavier, but stronger isolation. Containers share the kernel, so a kernel vulnerability is a shared risk.

---

<a id="22"></a>
## 22. "so the Core has the public key? I'm confused — RS256..."

Core has the **private** key. Both keys and who holds what:

RS256 is asymmetric signing: **two mathematically related keys.** The private key can create signatures. The public key can only *verify* them. You cannot derive the private key from the public one, and you cannot forge a signature with only the public key.

| Key | Held by | Can do |
|---|---|---|
| Private | **Core only** (from GCP Secret Manager) | Sign new JWTs |
| Public | **Gateway** (cached in memory) | Verify JWTs. Cannot sign. |

**Flow:** user logs in → **Core** signs the JWT with the private key → browser sends it on later requests → **Gateway** verifies the signature with the public key. The Gateway is now certain Core issued that token, and it never had the ability to issue one itself.

**Compare with HS256**, which is where the confusion comes from. HS256 uses **one shared secret** for both signing and verifying. So the Gateway would need the exact same secret Core uses to sign — meaning a compromised Gateway can **mint tokens for any user**. The Gateway is your internet-facing service, the most exposed one. Giving it minting power is the wrong blast radius.

The rule this expresses: **verification is a less privileged operation than issuance, so it should hold a less privileged key.** With RS256, a fully compromised Gateway can read tokens but not create them.

"Caches" means the Gateway fetches the public key once (from an env var, Secret Manager, or a `/.well-known/jwks.json` endpoint on Core) and keeps it in memory — no per-request network call, so verification is pure local CPU, around 50 microseconds.

**The two injected headers.** After verifying, the Gateway sets:

- `X-User-Id: 42` — downstream code reads user identity from a plain header instead of re-parsing the JWT. Core never re-verifies.
- `X-Request-Id: <uuid>` — generated once at the edge and passed to every service. Every Pino log line includes it, so one user action produces log lines across Gateway, Core, and Collab that you can filter into a single trace with one query. Without it, correlating a failure across three services means guessing from timestamps.

**The critical security condition, which is easy to miss:** these headers are only trustworthy if a client can't set them itself. The Gateway must **strip any inbound `X-User-Id`** before setting its own, and Core/Collab must be unreachable from the internet (internal ingress + IAM). Otherwise anyone sends `X-User-Id: 1` directly to Core and is an admin.

---

<a id="23-and-26"></a>
## 23 & 26. "How does this actually work and what is Lua" / "is the Lua script necessary"

**What Lua is:** a tiny embedded scripting language. Redis ships with a Lua interpreter inside it. You send a script with `EVAL`, Redis runs it internally, and — this is the whole point — **Redis runs the entire script as a single command with nothing else interleaved**, because Redis executes one thing at a time. It's not a build dependency or something you install; it's about 15 lines of text in your codebase.

**The token bucket, concretely.** State in a Redis hash `rl:user:42`: `{tokens, last_ms}`. Config: capacity 100, refill 10/sec. On each request:

```lua
local now    = redis.call('TIME')            -- Redis's own clock, not the caller's
local now_ms = now[1]*1000 + now[2]/1000
local b      = redis.call('HMGET', KEYS[1], 'tokens', 'last_ms')
local tokens = tonumber(b[1]) or tonumber(ARGV[1])   -- new bucket starts full
local last   = tonumber(b[2]) or now_ms

tokens = math.min(tonumber(ARGV[1]), tokens + (now_ms - last)/1000 * tonumber(ARGV[2]))

local allowed = 0
if tokens >= 1 then tokens = tokens - 1; allowed = 1 end

redis.call('HSET', KEYS[1], 'tokens', tokens, 'last_ms', now_ms)
redis.call('EXPIRE', KEYS[1], 120)           -- idle buckets evict themselves
return {allowed, math.floor(tokens)}
```

Note there is no background refill job. Tokens are computed lazily from elapsed time on each request — that's what makes it cheap.

**Why atomicity is required — the exact failure.** The logic is read-modify-write. Without a script, your Gateway does three round trips: `HMGET`, compute in Node, `HSET`. Now Gateway instance 1 and instance 2 handle two requests from the same client simultaneously:

```
t0  inst 1: HMGET -> tokens = 1
t1  inst 2: HMGET -> tokens = 1     <- reads the same value
t2  inst 1: allow, HSET tokens = 0
t3  inst 2: allow, HSET tokens = 0
```

One token spent twice — a **lost update**. Two requests allowed where one should have been. At scale this makes the limit meaningfully leaky and, worse, unpredictable. As a script, steps t0–t2 happen with nothing between them, so instance 2's read sees 0 and is denied.

**Is Lua necessary? For the match claim, effectively yes.** That failure is much worse than a leaked token. Sequence: read queue → pick a compatible partner → remove both. Between read and remove, another Core instance reads the same queue, picks the **same partner**, and removes them too. Both instances create a session. User B is now in two sessions with two different people, and one of them stares at an empty document. There's no clean repair — you've already told two users they're matched.

Alternatives, and why Lua wins:

- **`WATCH`/`MULTI`/`EXEC`** — optimistic locking with a client-side retry loop. Correct, but 3+ round trips and retry logic you have to write and test.
- **A distributed lock** — serialises all matching through one lock, adds latency, and introduces lock-expiry edge cases.
- **`ZPOPMIN 2`** — atomic, but it pops *whoever is first*, and you need to filter by compatible topic and difficulty. Popping an incompatible user means pushing them back, which is a new race and can lose a user if you crash between pop and push.

Lua does read-filter-claim in one atomic step, one round trip, no retries. And a 15-line script is a genuinely small dependency. That's ADR-03.

---

<a id="24"></a>
## 24. "is our gateway essentially building our own NGINX, what is NGINX, why build our own"

**What NGINX is:** a very fast C web server, most often used as a **reverse proxy** — it sits in front of your application servers, accepts client connections, forwards them to backends, and returns the responses. It also does TLS termination, static file serving, load balancing, and basic rate limiting (`limit_req_zone`). You configure it with a text config file; you don't write code.

**Is your Gateway "your own NGINX"?** Partly. Same *position* (single entry point, reverse proxy) and there's overlap in routing and rate limiting. But your Gateway does application-level things NGINX doesn't: verifying RS256 JWTs against a cached public key, injecting `X-User-Id`, generating request IDs, and a **distributed** token bucket in Redis shared across instances. NGINX's rate limiting is per-worker-process and per-instance — it would give you exactly the split-bucket bug from §7.

The honest framing: an API gateway (Kong, Traefik, Envoy) is the real comparison; NGINX is the layer those are often built on.

**Also worth knowing:** on Cloud Run you don't need NGINX at all. Google's frontend already terminates TLS, serves HTTPS, and load-balances across your instances. Nothing about your Gateway is doing NGINX's core job.

**Why build it rather than configure Kong:** the auth and rate-limit mechanics then exist as code in your repo rather than as YAML in a third-party product. In an interview, "I implemented a distributed token bucket as an atomic Redis Lua script because two stateless instances would otherwise double-spend the same bucket" is a systems answer. "I set `rate_limit.minute: 60` in a Kong plugin" is not. The learning is in the concurrency problem, and configuring a product hides exactly that problem.

Say the tradeoff out loud so it reads as a decision rather than naivety: **in production at a company, you would use Kong or Envoy** — they're battle-tested, handle retries, circuit breaking, and mTLS. Hand-rolling a gateway is the wrong call commercially and the right call for a learning project. That framing is the credible version.

---

<a id="25"></a>
## 25. "Question bank: list / filter / search / paginate, get by id. Row shape... I also don't get the whole auth part for Core"

**The five read operations** — these are just the API endpoints:

| Operation | Endpoint | What it does |
|---|---|---|
| list | `GET /questions` | return questions, newest or by id |
| filter | `GET /questions?tags=os&difficulty=hard` | narrow by exact-match fields |
| search | `GET /questions?q=deadlock` | full-text search over title/body (§18) |
| paginate | `GET /questions?limit=20&cursor=…` | return 20 at a time, not all 500 |
| get by id | `GET /questions/42` | one full question |

On pagination: prefer a **cursor** (`WHERE id > $last ORDER BY id LIMIT 20`) over `OFFSET`. `OFFSET 10000` makes Postgres read and discard 10,000 rows every time, and rows shifting between requests cause duplicates or skips.

**The row shape** — one row per question:

- `parts[]` — the question's sub-parts, e.g. `["Define a deadlock", "State the four Coffman conditions", "Give a prevention strategy"]`. Multi-part is why Collab can build a scaffolded document with one heading per part.
- `reference_md` — the model answer, in Markdown. **Never sent to the client** until the server has verified both users consented (ADR-06).
- `tags text[]` — `{os, concurrency}`, GIN-indexed (§18).
- `difficulty` — `easy | medium | hard`; used for filtering and for matching preferences.

**The auth part of Core**, in full:

**Signup** — `POST /auth/signup`. Validate with zod. Hash the password with **bcrypt** and store only the hash. Bcrypt is deliberately slow (a cost factor of 12 makes each hash take about 250 ms) so that a stolen database can't be brute-forced quickly, and it salts each password automatically so identical passwords produce different hashes and one cracked password doesn't reveal others.

**Login** — `POST /auth/login`. Look up the user, `bcrypt.compare(submitted, stored_hash)`. On success: sign a 15-min RS256 JWT with the private key, generate an opaque refresh token, store it in Redis with a 7-day TTL, return both. Return the same generic "invalid credentials" for unknown-email and wrong-password so you don't leak which emails are registered.

**Refresh** — `POST /auth/refresh`. Full mechanism in §14.

**Logout** — delete the refresh token key from Redis.

The key point about **where auth lives**: Core is the only service that can *issue* tokens (it holds the private key). The Gateway only *verifies* them. Core therefore has no auth middleware of its own for normal endpoints — it trusts `X-User-Id` because nothing except the Gateway can reach it.

---

<a id="27"></a>
## 27. "I don't really get the whole collab service"

Built up from the problem.

**The problem:** two users must see each other's keystrokes within about 100 ms, in one shared document, with both typing at once.

**Step 1 — the transport.** HTTP can't push (§3), so each browser opens a WebSocket to `/collab/s42`. The very first thing Collab does is authenticate it: the client sends its JWT, and Collab verifies the user is actually a participant in session `s42` — otherwise anyone could open a socket to any session id and read someone else's work.

**Step 2 — the document.** Collab creates one Yjs document per session, held **in memory**. It's seeded from the question's `parts[]`: one heading per part, plus `## Our answer` and `## Scratch`. The scaffold means the two users naturally write in different regions instead of on top of each other, and `## Scratch` doubles as their chat.

**Step 3 — an edit.** User A types. The Yjs client library turns that into a small binary update and sends it over the socket. Collab merges it into its copy and broadcasts it to every other socket **on this instance**.

**Step 4 — the distributed problem, which is the actual point of the service.** Cloud Run may have 2 Collab instances, and the load balancer doesn't know these two users belong together. User A's socket lands on instance 1, User B's on instance 2. Instance 1 broadcasts locally — and instance 2 never hears about it. **The two users are in the same session but cannot see each other.**

**The fix:** one Redis pub/sub channel per session, `session:s42`. Instance 1 publishes each update to that channel; instance 2 is subscribed and receives it, merges it into *its* copy of the doc, and pushes it to User B's socket. That's the sequence diagram in the design doc.

Note what makes this safe: because Yjs is a CRDT, instance 2 can merge that update in whatever order it arrives relative to its own local edits and still land on identical text (§20). Without a CRDT you'd need a server to impose a global order — which is exactly the central bottleneck you're avoiding.

**Step 5 — presence and cursors.** Yjs *awareness* is a separate side channel for ephemeral state: who's online, where their cursor is, their colour. It isn't part of the document and isn't persisted — it's discarded when a user disconnects, which is what you want.

**Step 6 — durability.** The doc only exists in RAM, so it snapshots to Postgres every 30 s, on disconnect, and on SIGTERM (§12), and restores from the snapshot on reconnect.

**Step 7 — the reveal.** The reference answer must **never** enter the Yjs doc, because a Yjs doc replicates in full to every peer — putting it there would ship it to both browsers instantly. Instead Core serves it per-user over HTTP after checking server-side that both consented (ADR-06).

So the service is four concerns stacked: authenticated WebSockets, a CRDT for concurrent editing, Redis pub/sub for cross-instance sync, and Postgres snapshots for crash safety. Every one of those exists because of a specific failure, and that's why the doc calls it the hardest phase and the piece worth building most carefully.

---

<a id="30"></a>
## 30. "so are we not using Prometheus? we are doing it ourselves"

Neither, exactly — split it into three separate things:

1. **The format.** "Prometheus-style metrics" means the plain-text exposition format on a `/metrics` endpoint:
   ```
   http_requests_total{method="GET",route="/questions",status="200"} 1432
   http_request_duration_seconds_bucket{le="0.1"} 1201
   ```
   You emit this via a Fastify plugin (`fastify-metrics` / `prom-client`). You are **not** writing the format by hand.
2. **The server.** You are **not** running a Prometheus server. That's an always-on container with a disk — it would break the cost ceiling in §7 of the design doc and be one more thing to operate.
3. **The store.** Grafana Cloud's free tier includes a Prometheus-compatible backend plus dashboards, so it holds the data and draws the graphs.

So: standard format, standard client library, no self-hosted server.

**One gap worth flagging, because the doc's wording glosses it.** Prometheus normally **pulls** — it scrapes each instance's `/metrics` on a timer. That doesn't work on Cloud Run: instances aren't individually addressable, they scale to zero, and a scraper can't scrape a container that no longer exists. Any counter in a dying instance's memory is lost before a scrape.

So the real implementation must **push**, via one of:

- **Grafana Alloy / `remote_write`** from inside each service, pushing metrics on a short interval; or
- **OpenTelemetry** metrics export to Grafana Cloud's OTLP endpoint; or
- Cloud Run's built-in Cloud Monitoring metrics (request count, latency, instance count) for infrastructure, with `/metrics` only for app-specific things like WebSocket connection count.

The `/metrics` endpoint is still worth building — it's the standard interface and it's what you read during the local k6 run — but the phrase "shipped to Grafana Cloud" is doing real work that needs a push exporter. Worth making explicit in §6 of the design doc when you get there.

---

<a id="31"></a>
## 31. "explain these — Graceful shutdown... Idempotency..."

**Graceful shutdown.** Cloud Run doesn't kill a container instantly; it sends **SIGTERM** and gives you about 10 s before SIGKILL. Without handling it, the scenario is: Cloud Run scales down or you deploy, the process dies mid-request, and a user's signup returns a network error even though the row may have been written.

What you do on SIGTERM:

1. **Stop accepting new work** — `server.close()` stops the listener, and your `/health/ready` starts returning 503 so the load balancer routes elsewhere.
2. **Let in-flight requests finish** — that's "drain". The 8 requests currently mid-query complete and respond normally.
3. **Clean up** — close the Postgres pool, close the Redis connection.
4. Exit.

For **Collab** there's one more, and it's the important one: snapshot every in-memory Yjs doc to Postgres before exiting. Without it, a routine scale-down silently loses up to 30 s of two people's work. With it, they reconnect to a new instance and the text is intact.

**Idempotency** — an operation that produces the same result whether run once or five times. Needed because retries are unavoidable: networks time out after the server already succeeded, clients retry, and at-least-once delivery redelivers.

The three cases in your doc:

- **Queue-join keyed by `user_id`.** Scenario: the client sends `POST /match/join`, the response is lost to a flaky network, the client retries. Without a key, the user is in the queue twice — and can be matched with themselves, or matched twice and dropped into two sessions. Keying on `user_id` means the second join sees "already queued" and changes nothing. This is also what makes the crash-recovery path in §5 of the design doc safe.
- **Session-end keyed by `session_id`.** Prevents two `session.ended` events, two summaries, and double-counted stats.
- **Event consumption keyed by entry ID.** At-least-once delivery (§15) means the worker *will* sometimes see an event twice. `INSERT … ON CONFLICT (session_id) DO NOTHING` makes the second pass a no-op.

The rule to internalise: with at-least-once delivery, **idempotency is not optional** — it's what converts "at-least-once" into "effectively exactly-once".

---

<a id="32"></a>
## 32. "I don't get how the kill switch works, what is that projects.update thingy, what is a cloud function"

**What a Cloud Function is:** you upload one function (about 40 lines of JS), not a server. Google runs it only when a configured event arrives, then shuts it down. No container to build, no instance parked, no idle cost. It's the smallest unit of deployable code on GCP.

**The chain, four hops:**

1. **Billing budget.** You create a budget of $20 on the project. Critically, a GCP budget is **an alert, not a limit** — GCP has no native "stop at $X". On its own it just emails you.
2. **Pub/Sub topic.** You configure the budget to publish a message to a Pub/Sub topic each time spend data updates. The message contains current spend and the budget amount.
3. **Cloud Function** subscribes to that topic. It reads the message: `if (costAmount >= budgetAmount)` then act, otherwise return.
4. **`projects.updateBillingInfo`** is the action — a method on the Cloud Billing REST API. The function calls it with an **empty** `billingAccountName`, which **detaches the billing account from the project**. Google publishes this ~40-line sample; you're not inventing it.

**What detaching does:** every billable service in the project stops. Cloud Run stops serving, Cloud Storage becomes inaccessible, Artifact Registry stops. Spend goes to zero because nothing can run. It's the only mechanism on GCP that actually *stops* rather than *notifies*.

**Why it's layer 1 but not the primary control** — three real limitations:

- **It's not instant.** Budget data updates periodically, so there's a lag between crossing $20 and the function firing. In a genuine runaway (an infinite loop spinning up instances), you can overshoot during the lag.
- **It's all-or-nothing.** The whole project goes down, including your live demo URL. Not a graceful degradation.
- **Recovery is manual.** You must re-attach the billing account by hand in the console.

That's why `--max-instances=2` is described as the real day-to-day control: it caps spend **at the source** so the kill switch should never fire. The kill switch exists for the case where you fat-finger a flag.

Two practical notes: the Cloud Function needs the **Billing Account Administrator** role to detach billing, and you should test it once on purpose (set the budget to $0.01) — an untested kill switch is a comforting assumption, not a control.

---

<a id="33"></a>
## 33. "how come max instance 2 but concurrency can be 80"

These are two independent axes, and multiplying them gives your capacity.

- **`--concurrency=80`** — how many requests **one instance** handles at the same time.
- **`--max-instances=2`** — how many **instances** can exist.
- Total in-flight capacity for Core: **2 × 80 = 160** simultaneous requests.

**Why 80 on one Node process, when Node is single-threaded.** A typical Core request spends about 2 ms of CPU (parse, serialise) and about 30 ms **waiting** on Postgres. During that wait the thread is free. Node's event loop uses it to start the next request. So one process can hold 80 requests in flight while only ever executing one line of JS at a time, because 78 of them are blocked on I/O.

This only works because the work is I/O-bound. If Core did heavy CPU work — bcrypt is the notable exception, at about 250 ms of pure CPU — the event loop blocks and high concurrency makes latency worse for everyone. Worth knowing about your own login endpoint.

**Why not `--concurrency=1`.** Then 100 simultaneous requests demand 100 instances. With `--max-instances=2` you'd serve 2 requests at a time and queue or 429 everything else — the app appears broken. Without a max-instances cap you'd get 100 containers and a real bill. Concurrency is what keeps a small instance count sufficient.

**How the two interact under load.** Cloud Run adds an instance when existing ones approach their concurrency target. With 100 requests arriving: instance 1 takes 80, Cloud Run starts instance 2 for the remaining 20. At 200 requests: both instances are at 80 (160 total), and the extra 40 queue briefly, then get **429 Too Many Requests** — because max-instances is a hard ceiling. That is the intended behaviour: you'd rather reject traffic than receive a surprise bill.

**Why Collab's numbers differ (250 / 3600 s).** Its unit of work is an open socket that's mostly idle — a user typing occasionally uses almost no CPU. So one instance can hold many more. And here the meaning of the flag changes in an important way: `250 × 2 = 500` becomes your **hard ceiling on concurrent WebSocket connections**. The 501st user is rejected. That's why §8 of the design doc warns that your k6 headline number will hit the *configured* limit before it hits hardware — so raise the flag deliberately before concluding "N is what the system can do".

---

<a id="34"></a>
## 34. "I don't get the Public URL layer for the cost safety"

The layer answers one question: **your API is on the open internet and anyone can send it requests — what stops that from generating a bill?**

The insight is which component is actually dangerous. Compare how each part of your stack responds to a flood of traffic:

- **Cloud Run** responds by **creating more instances**, which you pay for by the second. Its reaction to load is to spend money.
- **Neon** (0.5 GB) and **Upstash** (10K commands/day) respond by **refusing** — you hit the free-tier limit and requests start erroring. They **throttle rather than overage-bill**. That's a feature here: the failure mode is an outage, not an invoice.

So the risk is concentrated entirely in Cloud Run, and specifically in its autoscaling. A bot scraping `/questions` in a loop, or a broken client retrying without backoff, drives instance count up.

Hence the layer: **the Gateway's token-bucket rate limiter is a cost control, not just an abuse control.** By capping requests per IP and per user before they reach Core, it caps the request rate that could trigger autoscaling. The rate limiter reduces the *demand* for instances; `--max-instances=2` caps the *supply* regardless.

The sentence "the stateful layer isn't the risk — Cloud Run is" is the takeaway: when you audit a cloud bill risk, look for the component whose response to load is to provision more of itself.

---

<a id="35"></a>
## 35. "what is GKE, and how are we trying Kubernetes then changing over?"

**Kubernetes (k8s)** is a container orchestrator. You declare desired state in YAML — "run 3 replicas of this image, expose it on port 80, restart it if this health check fails" — and k8s continuously works to make reality match. You don't start containers; you declare what should exist.

**GKE** is Google Kubernetes Engine — Google running the Kubernetes control plane for you. **GKE Autopilot** goes further: you supply only workload YAML and Google manages the nodes (the VMs pods run on) as well. Standard GKE means you also manage node pools.

**The relevant contrast with Cloud Run**, which is the reason for the plan:

| | Cloud Run | GKE |
|---|---|---|
| Scale to zero | yes, idle cost $0 | no — nodes bill 24/7 |
| Idle cost | about $0 | about $70+/month minimum |
| What you write | a `gcloud run deploy` command | Deployment, Service, Ingress, ConfigMap, Secret YAML |
| What you learn | a platform | how orchestration actually works |

**Why the plan is "learn it, then leave it."** GKE bills whether or not anyone uses your app, which directly violates the §7 cost ceiling. Cloud Run at your traffic is effectively free. So GKE cannot be the permanent home. But Kubernetes is the thing worth having touched, and you can't learn it from a document.

The sequence (phase 9, on trial credits):

1. Write **raw manifests** for the 3 services: Deployment (desired replicas + image), Service (stable internal address for a set of pods), Ingress (external entry), ConfigMap/Secret (config and credentials), and liveness/readiness probes (`/health/live` → restart me if this fails; `/health/ready` → don't send me traffic yet). No Helm, no k3d — raw YAML so nothing is hidden behind a templating layer.
2. **Run it for a few days** and do the three things that teach you what k8s actually is: roll out a new version with `kubectl apply` and watch a rolling update replace pods one at a time; `kubectl delete pod` and watch the Deployment recreate it without you doing anything; read logs with `kubectl logs`.
3. **Migrate back to Cloud Run** as the permanent deploy, **delete the cluster** (this is the step that protects your bill — an idle GKE cluster is the single most likely way to burn $300 of credits by accident), and keep the manifests in `k8s/` so the repo shows the work.
4. **ADR-05** records the decision, which is the part that makes it read as judgement rather than indecision: *"deployed to GKE during development to learn it, migrated to Cloud Run for scale-to-zero and zero idle cost; manifests retained."*

Because your services are stateless containers reading config from env vars, both targets consume the same Docker images — the migration is a deploy command, not a rewrite. That portability is itself a point in favour of the design.

---

<a id="36"></a>
## 36. "different types of testing: unit, end-to-end, integration etc"

Ordered by scope. The tradeoff is constant: **wider scope catches more real bugs, runs slower, and fails less precisely.**

**Unit** — one function or class, no network, no database, dependencies faked. Milliseconds, hundreds of them. When one fails you know exactly which function is wrong. Catches logic errors; **cannot** catch wrong SQL, wrong config, or two components misunderstanding each other.

Your unit tests: the token-bucket refill maths, matching compatibility rules, question-bank filter construction, worker idempotency (feed the same event twice → assert one summary).

**Integration** — several real components together, usually your code plus a real database. Seconds. `testcontainers` is what makes this practical: it starts real Postgres and Redis in Docker for the test run and throws them away after. Catches exactly what unit tests can't — a broken migration, a query that's valid SQL but wrong, a Redis TTL that doesn't behave as assumed, a transaction that doesn't roll back.

Yours: the full auth flow (signup → login → refresh → logout, hitting real Postgres and real Redis) and the match flow (two users join → Lua claim → session row exists).

An important point on why integration tests earn their keep here: mocking Redis would have you assert that your code *calls* `EVAL`. A real Redis asserts the script *produces the right answer*. Your hardest bugs are in that gap.

**End-to-end (E2E)** — the whole system as a user experiences it, driven through a browser (Playwright). Tens of seconds, and the most fragile — a CSS change can break one. So you write **very few**. Yours is one happy path: signup → match → collab edit syncs → end.

Its value is unique: it's the only test that proves the frontend, Gateway, Core, Collab, Redis, and Postgres are all wired together correctly. Every other test could pass with a mis-set `CORE_URL`.

**Load / performance (k6)** — see §37. Different question entirely: not "is it correct?" but "how much can it take?"

**Others worth knowing by name:** *contract* tests (assert two services agree on a request/response shape, so one can change without breaking the other); *smoke* tests (a couple of requests after deploy to confirm the thing is alive); *chaos* testing (deliberately break something and observe — your "kill one Collab instance, the other keeps working" demo is exactly this, and it's the most impressive one you have).

The shape to aim for is many unit, some integration, one E2E. The failure mode at the other extreme — mostly E2E — gives you a suite that takes 20 minutes, fails randomly, and gets ignored.

---

<a id="37"></a>
## 37. "Explain how k6 load test works, also my concurrency knowledge is very weak"

### Concurrency fundamentals first

**Concurrency vs parallelism** — the distinction everything else rests on:

- **Concurrency:** multiple tasks *in progress* over the same period, interleaved. One CPU can be concurrent by switching between tasks.
- **Parallelism:** multiple tasks *executing at the same instant*, which requires multiple cores.

Node gives you concurrency without parallelism for your JS: **one thread runs your JavaScript**, and an **event loop** drives it. When your code does `await db.query(...)`, the query is handed to the OS, your function suspends, and the event loop runs other work. When the result arrives, your function resumes. So 80 requests are in flight with only one line of JS executing at any moment (§33). This is why Node handles I/O-bound work well and CPU-bound work badly: a 250 ms bcrypt hash **blocks the event loop**, and all 79 other requests wait.

**Race condition** — the core hazard. Two concurrent operations interleave on shared state and produce a result neither would alone. The canonical shape is read-modify-write:

```
inst 1: read tokens = 1
inst 2: read tokens = 1     <- same value, before inst 1 writes
inst 1: write tokens = 0
inst 2: write tokens = 0    <- inst 1's decrement is lost
```

That's the **lost update** from §23. Note it needs no threads — two separate *machines* did it. This is the whole reason for Lua scripts.

**Atomic** — an operation that cannot be observed half-done and cannot be interleaved. Redis commands are atomic individually; a *sequence* of them from your app is not. A Lua script makes the sequence atomic.

**Blocking vs non-blocking** — blocking means the thread waits and can do nothing else. In Node, one blocking call harms every concurrent request, not just its own.

**Idempotent** — safe to repeat (§31). This is the practical *defence* when you can't prevent duplication, and duplication is unavoidable in a distributed system.

**Percentiles** — with concurrency, an average lies. If 95 requests take 10 ms and 5 take 2 s, the average is about 110 ms and no request took 110 ms. **p95 = 95% of requests were faster than this.** Always report p95/p99; the tail is what users notice, and the tail is where contention shows up.

### How k6 works

k6 is a load-testing tool. You write a JS script describing what one user does; k6 runs many copies of it and reports timing statistics.

```js
import ws from 'k6/ws';

export const options = {
  stages: [
    { duration: '30s', target: 50 },   // ramp 0 -> 50 virtual users
    { duration: '2m',  target: 50 },   // hold 50
    { duration: '30s', target: 200 },  // ramp to 200
    { duration: '2m',  target: 200 },  // hold
    { duration: '30s', target: 0 },    // ramp down
  ],
  thresholds: {
    edit_latency:    ['p(95)<200'],    // fail the test if p95 > 200ms
    ws_connecting:   ['p(95)<1000'],
  },
};

export default function () {
  ws.connect(`${__ENV.URL}/collab/s42`, { headers: { /* JWT */ } }, (socket) => {
    socket.on('open',    () => { /* send a Yjs update every 2s */ });
    socket.on('message', (m) => { /* record propagation latency */ });
    socket.setTimeout(() => socket.close(), 60_000);
  });
}
```

The mechanics that matter:

- **VU (virtual user)** = one concurrent execution of your script. k6's runtime is Go, so each VU is a goroutine, not an OS thread — one laptop can drive thousands. This is why k6 rather than a Node script: a Node load generator would be limited by its own single event loop and you'd measure your *client*, not your server.
- **Stages** ramp load rather than applying it instantly. Ramping is what reveals the *knee* — the load level where latency stops being flat and starts climbing. A flat 200-VU test tells you pass/fail; a ramp tells you where the limit is.
- **Thresholds** turn the run into a pass/fail check, which is what lets it live in CI.
- **Custom metrics** — for your headline number you need edit-propagation latency, which k6 doesn't know about. You record it yourself: stamp a timestamp into the update you send, and when the echo arrives compute the delta into a `Trend` metric.

**Why the doc runs it twice.** Locally against docker-compose first: fast iteration, free, catches the dumb bugs (a socket leak, an unbounded map, a missing `await`). Then against Cloud Run with the Grafana dashboard open: this is the run that produces the real number, because only there do `--concurrency=250`, cold starts, real network latency to `asia-southeast1`, and Upstash's command limits apply.

**The trap §8 of the design doc warns about**, now that concurrency is clearer: `--concurrency=250` counts each open WebSocket as one in-flight request. So your first ceiling is a **config flag**, not hardware. If you report "holds 250 connections" without noticing, you've measured your own configuration. Raise the flag, re-run, and find where *latency* degrades — that's the real number. And measure from two directions: k6's client-side latency and your `/metrics` WebSocket connection count, so you can tell "the server is saturated" from "my load generator is saturated".

---

<a id="38"></a>
## 38. "Is it common to maintain an ADR? I guess it's just for key decisions?"

Yes on both counts, with a caveat.

**Common?** Reasonably, and increasingly so — it's a well-known practice (originating with Michael Nygard, 2011) at companies that value engineering documentation. It is not universal, and plenty of good teams don't do it. In a **portfolio repo it's disproportionately valuable**, because a reader can see *reasoning*, which is the thing code cannot show. Anyone can wire up Yjs; explaining why Yjs rather than Operational Transforms, and what you gave up, is the part that signals seniority.

**Key decisions only** — yes, and the discipline is in the filter. The test: *would a competent engineer joining this repo be confused about why it's this way, or be tempted to change it back?* If yes, write an ADR. If the decision is obvious or reversible in an afternoon, don't. "Used Fastify over Express" doesn't need one. "Log rather than queue for event delivery" does — it's structural and someone will question it.

Structure, one page, four sections: **Context** (the forces and constraints), **Decision** (what was chosen, stated in the active voice), **Alternatives considered and why rejected**, **Consequences** (including the bad ones you accepted).

The "Alternatives rejected" section is the one that does the work. An ADR that only says what you chose reads as a preference. One that says "considered a Postgres events table — genuinely viable at this scale, rejected for the cleaner scale-up path and the learning value" reads as an evaluation. That's exactly what your ADR-07 does, and it's the model for the other six.

Two conventions worth following: they're **immutable** — you don't edit ADR-03 when you change your mind, you write ADR-08 that supersedes it and mark 03 as superseded. The value is the trail, including the reversals. And they're **numbered and dated**, so `docs/adr/0003-reactive-matching.md` orders naturally.

Your 7 are well chosen — each one is a place where a reader would otherwise ask "why not the obvious thing?"

---

<a id="39"></a>
## 39. "I still don't understand what a distributed system is, and real-time I feel it should be obvious, maybe break down the words for me"

### Distributed system

**Distributed** = the work is spread across **multiple computers that do not share memory** and can only communicate by sending messages over a network. **System** = they cooperate to present themselves as one thing to the user.

The definition alone isn't the useful part. What makes it a distinct discipline is **four facts that follow from it**, none of which are true on a single machine:

1. **The network is unreliable.** Messages can be lost, delayed, duplicated, or arrive out of order. There is no "just call the function" — every call can fail in the middle.
2. **You cannot distinguish "slow" from "dead."** If Core doesn't answer in 5 seconds, it might be crashed, or it might be about to answer. There is no way to tell from the outside. This is the single hardest fact in the field, and it's why timeouts and retries exist — and why retries force idempotency.
3. **There is no shared clock.** Two machines' clocks differ by milliseconds. So "which of these two events happened first?" often has no answer you can trust. This is why Yjs orders edits by client ID tie-break rather than by timestamp, and why the rate-limit script reads Redis's clock rather than the caller's.
4. **There are no transactions across machines.** Postgres gives all-or-nothing within itself. Nothing gives you all-or-nothing across Redis *and* Postgres.

Every difficult thing in your design is one of those four:

- Fact 4 → the matching crash-recovery path in §5 of the design doc. A claim in Redis and a session row in Postgres can't be one transaction, so you engineer a repair path instead.
- Fact 1 → at-least-once delivery and the PEL, hence idempotency everywhere.
- Facts 1 and 3 → two Collab instances holding independent copies of one document, hence a CRDT.
- Fact 2 → timeouts, health checks, graceful shutdown.

So DeepCS is genuinely distributed at several levels at once: 2 Collab instances, 2 Core instances, a Gateway, Upstash, Neon, and two browsers — none sharing memory, all coordinating by message.

### Real-time

Worth breaking down because the phrase is used for two unrelated things.

**Real** = actual wall-clock time in the world, as opposed to "whenever the system gets around to it". **Time** = there is a deadline, and the correctness of the system includes *when* it responds, not only *what* it responds.

That yields:

- **Hard real-time** — missing a deadline is a failure, not a slowdown. Airbag controllers, pacemakers, industrial control. Needs specialised operating systems. **Not you.**
- **Soft real-time** — late means degraded, not broken. Below about 100 ms, a remote user's typing feels simultaneous; at 500 ms it feels laggy but works; at 3 s it's unusable. **This is DeepCS.**

The second, looser sense, which is what most web engineers mean: **the server pushes to the client rather than the client polling.** Polling means asking "anything new?" every 2 seconds — wasteful and up to 2 s stale. Pushing means the server sends the instant something happens. That's the WebSocket, and it's why the Redis pub/sub hop for live edits can't be replaced by the polled event log (the last line of ADR-07).

The precise claim your project makes is therefore: **soft real-time, push-based, with a measured p95 latency target.** The measurement is what makes it a claim rather than a description — which is exactly the point of the k6 headline number.

---

<a id="40"></a>
## 40. "Explain to me your methodology of your build phases?"

Five principles, and each phase is chosen by them.

**1. Every phase ends in something you can run and show.** The "Demoable" column is not decorative — it's the acceptance criterion. Phase 3's is "two users join → matched → session exists", verifiable with two curl calls. This exists to prevent the common failure of building three services for two weeks and discovering nothing works together. If a phase has no demo, it's not a phase.

**2. Dependency order, and nothing else.** Auth (1) precedes the question bank (2) because bank endpoints need a verified user. The bank (2) precedes matching (3) because you match on topic and difficulty, which are bank fields. Matching (3) precedes Collab (4) because a session must exist before you can collaborate in it. There's no phase that exists only because it seemed like the next tidy thing.

**3. The hardest thing goes as early as its dependencies allow.** Collab is phase 4 — as early as possible, since it needs a session row from phase 3. This is deliberate risk-front-loading: Collab is where the project can genuinely fail (cross-instance sync, snapshot correctness, reconnect). Discovering that in phase 4 leaves room to change approach. Discovering it in phase 9 leaves none. Compare the alternative ordering where you deploy first and build Collab last — you'd learn your riskiest assumption at the point of no slack.

**4. Backend before frontend.** React is phase 5, after four phases of curl-tested services. UI work expands to fill any time available and produces the least learning per hour here, and the doc explicitly scopes it to "minimal functional React only". Building the UI early also encourages designing endpoints around screens rather than around the domain.

**5. Ship, then add.** Phase 6 is the live deploy with CI, metrics, and the load number — the project is *complete and public* at phase 6. Everything after is additive and independently droppable:

- **7 (event pipeline)** — the system works without summaries; they're a new capability.
- **8 (Terraform)** — deliberately second-pass. Deploy manually first to learn what the pieces *are*, then codify. Writing Terraform for infrastructure you don't yet understand means debugging two unfamiliar things at once.
- **9 (Kubernetes)** — a self-contained learning sprint that ends by deleting the cluster (§35). It touches no application code.
- **10 (Kafka in dev)** — pure adapter work behind the existing 3-method `EventLog` interface, so prod is untouched. This is the phase most safely cut, which is exactly why it's last.

The property this ordering buys you: **you have a working, deployed, demonstrable project from phase 6 onward.** If you stop at 7, you have a complete project. Stop at 9, complete project with more depth. That's the opposite of the "80% done, nothing runs" failure, and it's the reason the phases are ordered by risk and dependency rather than by topic.

One thing worth flagging on the sequencing: **phase 0's billing guard genuinely must come first**, before any service is deployed. It's listed there, and it's the one item in the whole plan with no recovery path if skipped.
