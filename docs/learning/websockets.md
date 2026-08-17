# WebSockets, from the wire up

## The problem it exists to solve

HTTP has one shape: the client sends a request, the server sends one response,
and the exchange is over. The server can never speak first. You already know
the two workarounds this repo went through for the matching flow: polling
(keep asking, which keeps every layer awake) and SSE [server-sent events — one
ordinary HTTP response the server declines to finish, so it can keep writing
into it]. SSE fixed "server speaks first," but only in one direction: nothing
can be sent *up* that stream.

The collab editor needs both directions, at keystroke rate, with either side
speaking first: your edits go up, your partner's come down, dozens of frames a
second, no natural request/response pairing. That is the WebSocket case.

## Start one layer down: what a socket is

A TCP connection is two kernels [the operating system core on each machine]
maintaining an ordered, reliable byte stream between two processes. The
process's handle to it is a **file descriptor** [a small integer the process
gives the kernel to say "this connection"], and "socket" is the name for that
kind of file descriptor.

HTTP is not the connection — it is a *grammar* for the bytes flowing over one:
`GET /roadmap HTTP/1.1`, headers, blank line, response. The connection itself
is just bytes and has no opinion.

**A WebSocket is the same TCP connection, switching grammar mid-conversation.**
It starts life as an HTTP request, and after one agreed moment, both sides stop
speaking HTTP on it forever and speak WebSocket frames instead.

## The map (draw this once)

```
 browser                    gateway                     collab
┌─────────┐   TCP #1   ┌──────────────┐   TCP #2   ┌──────────────┐
│ editor  │ ══════════ │  ws proxy    │ ══════════ │ room, Y.Doc  │
└─────────┘            └──────────────┘            └──────────────┘
```

Two TCP connections, not one. The Gateway holds a socket to the browser and a
second socket to Collab, and its proxying is: read a frame from one, write it
to the other. This is why one collab connection costs a file descriptor and
memory on the Gateway *and* on Collab — the "burns a slot on both" fact, and
why §7's first scaling move is letting browsers connect straight to Collab.

## The handshake, byte for byte

The browser sends an ordinary HTTP request with two extra headers:

```
GET /collab/connect?sessionId=3f2e…&token=eyJh… HTTP/1.1
Host: localhost:8080
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13
```

If the server agrees, it answers with status **101 Switching Protocols**:

```
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

After that 101, no HTTP ever crosses this connection again. (The
`Sec-WebSocket-Key`/`-Accept` pair is the server hashing the key with a fixed
constant to prove it actually speaks WebSocket rather than being some server
that echoes headers — a real mechanism, but trivia here; I'm flagging it so
you know it exists, not because you need it.)

**Everything before the 101 is genuinely HTTP, and deepcs leans on that three
times:**

1. **It can carry a query string** — which is where the token goes, because a
   browser's `WebSocket` constructor cannot set an `Authorization` header.
   The Gateway honours `?token=` only when the request carries
   `Upgrade: websocket`, so normal routes can't authenticate that way.
2. **It can be routed like HTTP** — the Gateway matches the `/collab` prefix
   and proxies it; ingress-nginx forwards the upgrade natively.
3. **It can be refused like HTTP** — Collab's `preHandler` runs the
   participant check *before* the upgrade completes, and a "no" is a plain
   401/403/503 response. The socket never comes into existence, so there is
   nothing to close and no half-connected state to clean up.

## After the 101: frames

A **frame** is a few header bytes (type, payload length, flags) followed by
the payload. Types that matter:

- **binary** — arbitrary bytes. All of deepcs's traffic: Yjs updates are
  binary, and `rooms.ts` ignores text frames outright since the sync protocol
  has nothing to do with them.
- **text** — UTF-8 payload, for protocols that speak JSON or similar.
- **control frames** — `ping`, `pong`, and `close`. Small, protocol-level,
  usually handled by the library before your code sees them.

What a frame does *not* have is the load-bearing observation: no headers, no
status code, no URL, and no pairing between what you send and what comes back.
Send two messages and the protocol records no relationship between them and
any reply. Request/response is now a pattern *you* build if you need it — Yjs
does exactly this, with "sync step 1 asks, step 2 answers" encoded in its own
payload bytes, invisible to the WebSocket layer.

Either side sends whenever it wants. That single property is the whole reason
the editor works: Collab pushes your partner's keystroke to you the moment it
arrives, with no request from you in flight.

(Two trims I'm flagging rather than hiding: client-to-server frames are
*masked* — payload XORed against 4 random bytes, an anti-proxy-cache-poisoning
measure — and large messages can be split across continuation frames. Both are
handled entirely by the browser and the `ws` library; neither changes how you
reason about the system.)

## How one process holds 250 of these

Each socket is a file descriptor, and the Node process asks the kernel to
watch all of them with one `epoll_wait` call [the Linux syscall that sleeps
until any descriptor in a watched set has data]. 250 idle sockets cost zero
CPU — the process is asleep in that one syscall, and a frame arriving on any
socket wakes it, runs the handler, and puts it back to sleep. Concurrency
without threads: the overview §6 story, and the reason ADR-04 moving bcrypt
off the request path mattered — one CPU-bound stretch with no `await` stalls
every socket at once, because there is no second thread to take over.

## What breaks, and what the fixes look like

**1. Silence is ambiguous.** TCP does not notify you when the far machine
loses power; a dead connection is indistinguishable from an idle one until
you try to write. Failure: a socket that reads "open" forever while edits go
nowhere. Fix: periodic traffic — WebSocket has `ping`/`pong` control frames
built in for exactly this. (SSE has no frames, so Matching improvises the same
thing with a `: ping` comment line every 20 seconds.)

**2. Middleboxes reap idle connections.** NATs and proxies between the two
machines drop connections with no bytes flowing, on their own schedule and
without telling either end. Same fix as 1 — heartbeats exist as much for the
boxes in the middle as for the peers.

**3. A drop and an ending look identical without close codes.** The close
frame carries a 2-byte code. 1000 is a normal close; 1002 is a protocol error
— `deliver()` in `rooms.ts` closes a socket with 1002 after a malformed
frame, containing the damage to that one client; and 4000–4999 are reserved
for applications. deepcs defines 4001 = "session ended": the frontend
reconnects on any *other* close (wifi blip, pod replaced — 1.5s retry in
`collab.ts`) and must not reconnect on 4001. Without that distinction the
client either reconnects into a finished session forever or gives up on every
network blip — the two wrong behaviours, one of each.

**4. A new socket knows nothing.** The protocol has no resumption: reconnect
means a blank connection with no memory of the last one. Whatever continuity
you need, you rebuild above the protocol — deepcs re-authorizes (participant
check against the session row) and re-synchronizes (snapshot from Postgres
plus the sync-step exchange). This is why "a killed pod costs a reconnect,
not any edits" is a sentence about Postgres and Yjs, not about WebSocket.

**5. Every hop must speak upgrade.** A proxy that doesn't understand
`Upgrade` either answers the handshake itself with a 200 (client sees a
failed handshake) or forwards it and drops the headers. The Gateway needed
`websocket: true` to proxy upgrades at all, and its ws proxy has a *separate*
header-rewrite hook — whose absence would have meant `X-User-Id` never
arriving and Collab returning 401 for every socket, authorized or not.

**6. The connection is state.** Plain HTTP scales easily because requests
last milliseconds and nothing persists between them. A WebSocket server holds
a descriptor, buffers, and (here) a share of a Y.Doc per user for the life of
the session — so capacity is a standing cost, and replacing a pod
necessarily drops its sockets. Kubernetes can't prevent that; what makes it
survivable is the SIGTERM snapshot plus client reconnect.

## Choosing between the three (the repo's own choices)

- **Polling** — simplest, no held connections; costs every layer waking at the
  poll rate for people with no news, and news arrives up to one interval late.
  The repo removed it for exactly those two costs.
- **SSE** — server-to-client push over an ordinary HTTP response. Right when
  the client only listens, and rarely: the match announcement.
- **WebSocket** — both directions, high rate, binary payloads, either side
  speaks first: the editor. The price is everything in the failure list above.

## Drills (answer out loud, then check)

1. What crosses the wire, in order, when the editor connects? *(HTTP GET with
   Upgrade headers → participant check → 101 → binary frames, sync step 1
   first.)*
2. Why is the token in the query string, and why doesn't that loosen auth for
   normal routes?
3. How can Collab answer 403 if WebSocket "isn't HTTP"? *(It is HTTP, until
   the 101 — refusal happens in the HTTP phase, so no socket ever exists.)*
4. Your partner's edits stop arriving but the socket reads "open." What are
   the two or three candidate causes, and what mechanism exists for each?
5. Why does ending a session involve Redis when a close code exists? *(The
   partner's socket may be attached to the other pod; the close code is the
   last step, the Redis publish is how every pod holding the room learns to
   perform it.)*
6. What does one WebSocket cost the Gateway, and what design change removes
   that cost? *(A descriptor and slot for the session's life; direct-to-Collab
   connections, at the price of Collab verifying tokens itself.)*
