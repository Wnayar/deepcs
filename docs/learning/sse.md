# Server-sent events, from the wire up

Read [`websockets.md`](./websockets.md) first if you haven't — this page
leans on it for contrast, because the fastest way to understand SSE is to see
how much less it is.

## The problem it solves, and the half it doesn't

Same starting point as WebSockets: HTTP's shape is client asks, server
answers once, done — the server can never speak first. The matching flow is
the textbook case: being matched is caused by *somebody else's* request, so
the person waiting has nothing to ask that has an answer yet.

But look at what the waiter actually needs: **one message, downstream only,
rarely.** No keystroke stream, nothing to send up. Opening a WebSocket for
that means paying for a protocol switch and two-way framing to deliver what
is essentially one sentence. SSE is the observation that plain HTTP can
already do this — the server just has to decline to finish its response.

## The whole mechanism

There is no new protocol. The client sends an ordinary GET. The server
writes response headers with `content-type: text/event-stream`, writes some
bytes, and then — this is the entire trick — **never ends the response.**
The connection stays open because HTTP allows a response body of unknown
length, and every event is just more body arriving.

```
 browser                  gateway                  matching           redis
┌────────┐  GET /match/events ┌────────┐  proxied  ┌─────────┐ SUBSCRIBE ┌───────┐
│ fetch()│ ─────────────────→ │  http  │ ────────→ │ open    │ ────────→ │ match:│
│ reader │ ←── bytes, forever │  proxy │ ←──────── │ response│ ←── msgs  │user:B │
└────────┘                    └────────┘           └─────────┘           └───────┘
```

Because it is just a response, everything ordinary applies with no special
cases: the Gateway proxies it like any request (no `websocket: true`, no
second connection type), `X-User-Id` arrives the normal way, logging works,
and the route can 401 before committing to anything. Compare the WebSocket
column: no upgrade handshake, no 101, no frames, no close codes.

What you give up is the other direction. The client can never send anything
down this connection — anything it wants to say is a separate, normal HTTP
request. For the matching flow that is not a limitation, because the client
has nothing to say; it is the reason SSE fits.

## The wire format

Plain text. An event is one or more `data:` lines ended by a **blank line**:

```
: open

data: {"type":"matched","id":"3f2e…","questionId":"9a1b…"}

: ping

```

Lines starting with `:` are comments — the receiver must skip them, which
makes them free heartbeats. That is the entire grammar deepcs uses. (Flagging
the trim: the standard also defines `event:` for named types, `id:` for
event ids, and `retry:` to tune reconnection — this repo uses none of them,
and the `id:` story returns at the end of this page.)

## The server side, line by line

`GET /match/events` in `services/matching/src/index.ts` is the whole thing:

1. **`reply.hijack()`** — tells Fastify "I own this socket now, send no
   response of your own." From here the handler writes raw bytes until the
   client goes away.
2. **The headers are half the battle:** `cache-control: no-cache,
   no-transform` and `x-accel-buffering: no`. Not decoration — see the
   failure list below; `no-transform` is called load-bearing in the comment
   because it is.
3. **`: open` immediately** — one comment line so the client knows bytes can
   flow before any real event exists.
4. **A dedicated Redis connection** subscribes to `match:user:<uid>`. It has
   to be a `duplicate()`: a subscribed ioredis connection can run no other
   commands, and the main one is shared with the queue and every route.
5. **Re-check Postgres and resend the current session, if any** — the race
   this closes is below.
6. **A `: ping` every 20 seconds**, and cleanup (stop the timer, disconnect
   the subscriber) when the request's `close` event fires.

When Redis delivers a message, the handler writes `data: <payload>\n\n` into
the response. That write *is* the delivery — no queue, no acknowledgement.

## The client side, and why it isn't `EventSource`

Browsers ship a built-in SSE client, `EventSource`, with automatic
reconnection. deepcs doesn't use it, for the same reason the WebSocket token
rides a query string: **`EventSource` cannot set request headers**, so it
cannot send `Authorization`. Rather than move the token into the URL,
`frontend/src/matchEvents.ts` does SSE by hand with `fetch`:

- Read the response body as a stream of chunks.
- **Buffer across chunk boundaries.** A chunk from the network is not an
  event: one read can deliver half an event or three of them. The parser
  accumulates text and cuts on the blank line — the same
  "bytes are not messages" lesson TCP teaches everywhere.
- Skip `:` comment lines, parse `data:` payloads, call back on `"matched"`.
- On any error or drop: wait 2 seconds, reopen. Losing the stream is treated
  as ordinary weather, not an error.

## What breaks, and what the fixes look like

**1. Anything that buffers kills it silently.** A proxy, gzip layer, or
nginx default that collects the response body before forwarding turns the
stream into one long pause followed by everything at once. Nothing errors:
the request succeeds, the headers look right, the events just don't arrive
when they happened. That is why the failure is called *silent*, why the
server sends `no-transform` and `x-accel-buffering: no`, and why the only
real defence is `frontend/src/matchEvents.test.ts` — a wall-clock assertion
through the actual Gateway that a published event arrives within
milliseconds. You cannot catch this class of bug by reading code, because
the code is correct; the path is what's broken.

**2. Idle connections get reaped.** Same middlebox story as WebSockets: no
bytes flowing looks abandoned. WebSocket has `ping`/`pong` frames for this;
SSE has nothing built in, so the comment line is the improvised heartbeat —
`: ping` every 20 seconds, read by nobody, existing purely to be traffic.

**3. The missed-announcement race.** A partner can arrive in the gap between
your join response and your stream's subscribe — published to a channel with
no listener, gone. Redis pub/sub does not replay. The fix is on connect:
re-read Postgres and resend the current session if one exists. The
consequence is the delivery guarantee flips from "maybe missed" to "possibly
repeated," which is safe because the client acts on a session id — hearing
about the same session twice is a no-op. Turning a miss into a harmless
repeat is the same idempotency move the Stats pipeline makes.

**4. An open stream is not free.** It holds a connection — and therefore a
concurrency slot — on the Gateway and on Matching for its whole life. So one
is opened only by somebody actually waiting, and the client gives up after
15 minutes (`MAX_WAIT_MS` in `frontend/src/queue.ts`) rather than holding a
slot for someone who walked away.

**5. A drop loses whatever happened during it.** No connection, no
delivery — and unlike the standard `EventSource` + `id:`/`Last-Event-ID`
mechanism (where the browser reconnects and tells the server the last event
id it saw, so the server can replay), a hand-rolled client gets no replay.
deepcs doesn't need one: fix 3 already resends the current state on every
connect, which for a one-event stream is a complete substitute. That is the
trim flagged earlier, closed.

## Choosing, one more time

- **Polling** — the client speaks first, repeatedly. Costs every layer
  waking at the poll rate; news arrives up to one interval late. Removed
  from this repo for exactly those costs.
- **SSE** — server speaks first, one direction, plain HTTP. Right for one
  rare message to somebody waiting: the match announcement.
- **WebSocket** — either side speaks first, high rate, binary. Right for the
  editor, and overkill for the announcement.

The repo's rule of thumb in one line: **the browser is told, not asked** —
and SSE is the cheapest way to be told when there's nothing to say back.

## Drills

1. What is an SSE stream, mechanically? *(An ordinary HTTP response the
   server never finishes; events are more body bytes; blank line ends an
   event.)*
2. Why does the Gateway need nothing special to proxy it, when WebSockets
   needed `websocket: true` and a second header rewrite?
3. What does `no-transform` prevent, and why can't a unit test catch that
   failure? *(Buffering in the path; the code is correct, the path isn't —
   hence the wall-clock test through the Gateway.)*
4. A partner arrives in the instant between the join response and the stream
   opening. Walk the race and the fix. *(Publish hits a channel with no
   subscriber; on-connect resend from Postgres; miss becomes repeat; repeat
   is safe because the client acts on a session id.)*
5. Why a dedicated Redis connection per stream? *(A subscribed ioredis
   connection can run no other commands.)*
6. Why hand-roll the client instead of `EventSource`, and what standard
   feature did that cost? *(No request headers on EventSource, so no
   `Authorization`; cost automatic reconnect + `Last-Event-ID` replay —
   reconnect is rebuilt by hand, replay is replaced by resend-on-connect.)*
7. Why not just use the collab WebSocket for match announcements too?
   *(There is no session yet — the socket's room, auth, and URL all key off a
   session id that doesn't exist until the match happens. The announcement
   is what creates the thing the socket needs.)*
