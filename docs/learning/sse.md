# Server-sent events (SSE), explained simply

Read [`websockets.md`](./websockets.md) first. This page uses the same
starting problem, and the contrast between the two is most of the lesson.

## The situation

You clicked "find a partner". Now you wait. Nothing will happen until some
*other* person joins — and when they do, it is **their** request that creates
your news. You have nothing to ask that has an answer yet.

Same wall as before: a server can only answer, never start. So how does the
waiting person find out?

The old way was **polling**: ask "am I matched yet?" every couple of seconds.
It works, but every ask wakes the Gateway, Matching, and the database — for
thousands of asks whose answer is "no". And your partner's arrival is only
noticed at the *next* ask, so the news is always a little late. This repo
actually shipped polling first and then removed it for exactly those two
costs.

## The one-sentence idea

SSE: the browser asks **once**, and the server starts answering — and then
never finishes the answer. Every time there is news, the server just adds
more text to the answer that is still arriving.

That's it. There is no mode switch, no special protocol, no "101" moment
like WebSockets have. It is one normal request and one normal answer — the
answer just never ends.

## What the never-ending answer looks like

It is plain text, arriving in pieces over minutes:

```
: open

: ping

data: {"type":"matched","id":"3f2e…"}

```

Only two rules:

- A line starting with `data:` is an event. A blank line means "that event
  is complete".
- A line starting with `:` is a comment. The receiver ignores it. (You'll
  see below why the server sends comments at all.)

## The deepcs walkthrough

The waiting browser opens the stream, and here is each step:

1. Browser sends `GET /match/events` — a normal request, with the normal
   login token, through the Gateway like everything else.
2. Matching starts its answer with headers that say two things: "this answer
   is a stream" and "nobody along the way may collect it into a lump" (that
   second one matters — see failure 1). Then it writes `: open` so the
   browser knows bytes are flowing.
3. Matching subscribes to your personal channel in Redis. (Redis **pub/sub**:
   any part of the system can publish a message on a named channel, and
   whoever is subscribed *at that moment* receives it. Nothing is stored —
   miss it and it's gone.)
4. Matching also checks Postgres: are you somehow *already* matched? If yes,
   it writes that into the stream right now. (Why this line exists is
   failure 3, and it's the best part of this page.)
5. Every 20 seconds it writes `: ping` — a comment, ignored by the browser.
6. Now the actual event: your partner joins. **Their** join request creates
   the session and publishes "matched" on your channel. Matching receives it
   — because of step 3 — and writes `data: {...}` into your still-open
   answer. Your browser reads it and switches to the session screen.

Total messages sent to you while waiting five minutes: about fifteen pings
and one real event. Compare polling: 150 full request-answer round trips.

## The browser's side

Browsers have a built-in SSE reader called `EventSource`, which even
reconnects automatically. deepcs doesn't use it, for one reason: it cannot
attach the login token. So the frontend reads the stream by hand instead
(`frontend/src/matchEvents.ts`):

- It reads the answer as raw pieces, as they arrive.
- A piece is **not** an event — the network can hand you half an event, or
  three glued together. So the code collects text until it sees a blank
  line, and only then has one complete event.
- If the stream drops, it waits 2 seconds and opens a new one. A drop is
  treated as weather, not as an error.

## What goes wrong (and this is where SSE gets interesting)

**1. Anything that buffers, kills it — silently.** Lots of software between
the server and browser likes to *collect* an answer before passing it on
(to compress it, to send it efficiently). For a normal answer that's fine.
For a stream it is fatal: your "matched!" event sits in some middle box's
memory, and arrives minutes later in a lump with all the pings. Here is the
nasty part: **nothing errors.** The request succeeds. The headers look
right. The code is correct. It is the *path* that's broken, so no unit test
can catch it — which is why the repo's defence is a test that opens a real
stream through the real Gateway and asserts the event arrives within
milliseconds, by the clock.

**2. Quiet connections get hung up.** Same as WebSockets: middle machines
drop connections that carry no data. SSE has no built-in "still there?"
message — so the comment line is the trick. `: ping` every 20 seconds is
traffic that means nothing and exists only so the connection never looks
abandoned.

**3. The race: news can arrive before you're listening.** Look at the gap:
your join request was answered "waiting"... and your stream opens a moment
later. If your partner joins **inside that gap**, the "matched" message is
published to a channel with no subscriber. Redis doesn't store it. Gone
forever — you'd wait 15 minutes for news that already happened. The fix is
step 4 above: on connect, check the database and resend your current state.
Now trace both cases: partner arrived in the gap → the connect-check finds
the session and tells you. Partner arrives after → the subscription tells
you. The worst case is now hearing the same news *twice*, and that is
harmless — the browser acts on a session id, and the same id twice changes
nothing. **The design turns "possibly missed" into "possibly repeated", and
makes repeated safe.** That move — make the repeat harmless instead of
trying to prevent it — shows up all over this repo.

**4. Holding an answer open isn't free.** The connection occupies a slot on
the Gateway and on Matching for its whole life. So a stream is only opened
by someone actually waiting, and the browser gives up after 15 minutes
rather than hold a slot for someone who walked away.

**5. It is one-way.** The browser can't send anything down this stream —
ever. If it has something to say, that's a separate normal request. For the
match flow this costs nothing: the waiter has nothing to say.

## Choosing between the three

The repo's rule: **the browser is told, not asked.**

- **Polling** — browser asks repeatedly. Everything stays busy; news is
  late. Removed.
- **SSE** — browser asks once, server answers forever. One-way. Perfect for
  one rare piece of news to someone waiting: the match announcement.
- **WebSocket** — both directions, constant traffic. Needed for the editor.

Why not reuse the editor's WebSocket for the announcement? Because that
socket's URL and its permission check are both built around a **session
id** — and the announcement is the very thing that creates the session.
Before the match, there is nothing to connect *to*.

## Say it out loud (drills)

1. What is SSE, mechanically? *(One normal answer the server never
   finishes; news is more text appended to it; a blank line ends an event.)*
2. Why does the Gateway need zero special handling for it, when WebSockets
   needed two settings?
3. What's the silent failure, and why can't reading the code catch it?
   *(Buffering in the path; the code is correct — hence a wall-clock test
   through the real Gateway.)*
4. Walk the missed-news race and its fix. *(Published in the gap before
   subscribing; nothing stored; fix: resend current state on connect; missed
   becomes repeated, and repeated is harmless because it's the same session
   id.)*
5. What are the `: ping` lines for? *(Nothing reads them — they keep middle
   machines from hanging up a quiet connection.)*
6. Why is the client hand-written instead of using the browser's built-in
   `EventSource`? *(EventSource can't attach the login token.)*
7. Why not deliver the announcement over the collab WebSocket? *(That socket
   needs a session id to exist; the announcement is what creates it.)*
