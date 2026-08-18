# WebSockets, explained simply

## Start with what the editor needs

Two people share one document. When your partner types, your screen has to
change — even though *you* did nothing.

Normal web traffic cannot do that. A normal request works like this:

1. The browser opens a **connection** to the server. A connection means the
   two computers have agreed: bytes sent by one will arrive at the other, in
   order.
2. The browser sends one request over it: "GET /roadmap".
3. The server sends back one answer.
4. Done. If the browser wants anything else, it asks again.

The rule hiding in there is the whole problem: **the server can only ever
answer. It can never start.** So when your partner types, Collab has news for
you — and no way to hand it over, because you didn't ask anything.

## The one-sentence fix

A WebSocket is a normal connection where, after one special request, both
sides agree to drop the ask-and-answer rule — and from then on, either side
sends the other messages whenever it wants, in both directions, until one
side hangs up.

That is the entire idea. The rest of this page is the three phases: how it
starts, what it is like while open, and how it ends.

## Phase 1: how it starts

The browser sends what looks like a normal request, with one extra line.
(An extra line like this is called a **header** — a "name: value" note
attached to a request or answer.)

```
GET /collab/connect?sessionId=abc&token=xyz    ← a normal-looking request
Upgrade: websocket                             ← "after you answer, can we switch modes?"
```

If the server agrees, its answer is a special status code:

```
HTTP/1.1 101 Switching Protocols               ← "agreed — no more ask-and-answer"
```

After that 101, the connection stays open, and it stops being about requests.
It is now a two-way message channel.

The important thing: **until the 101, this is still a completely normal
request.** deepcs uses that fact three times:

- **It can carry your login token.** The browser's WebSocket feature cannot
  attach the usual login header, so the token rides in the URL instead —
  that's the `?token=xyz`. The Gateway accepts a token there *only* on this
  kind of request.
- **It travels through the Gateway like anything else.** The Gateway sees
  the `/collab` path and forwards it, same as any request.
- **It can be refused like anything else.** Before agreeing, Collab asks
  Matching: "is this person actually in this session?" If not, it just
  answers "403, no" — a normal answer to a normal request — and the message
  channel never comes into existence.

## Phase 2: while it is open

Both sides send **messages**: small chunks of data, whenever they want. A
message has no URL, no status code, no headers — none of that is needed,
because the connection already knows who is on each end.

Follow one keystroke through deepcs:

1. You type the letter `a`.
2. Your browser sends one small message up its connection.
3. Collab applies it to the shared document it holds in memory.
4. Collab sends a message down your partner's connection.
5. Their editor shows the `a`.

No requests anywhere in that. A few milliseconds, total.

One thing to notice: messages have no built-in replies. If you send one, you
get nothing back unless the other side *chooses* to send something. Any
"question and answer" behaviour (like the document sync when you first
connect) is built by the app on top, as pairs of ordinary messages.

## Phase 3: how it ends

Hanging up is also a message — a goodbye that carries a number, called a
**close code**, saying *why*.

deepcs uses that number to solve a real problem: when your connection dies,
was the session over, or was it an accident? These need opposite reactions.

- Code **4001** means "the session was ended". The browser must *not*
  reconnect.
- Any other close means "accident" — wifi blip, server restarted. The
  browser waits 1.5 seconds and reconnects.

Without the number, the browser cannot tell those apart, and it would either
give up on every wifi blip or keep reconnecting into a finished session.

## The map (draw this once)

```
 your browser ──── connection 1 ──── Gateway ──── connection 2 ──── Collab
```

Two connections, not one. The Gateway sits in the middle copying messages
between them. So every person in a session costs an open connection on the
Gateway *and* one on Collab, for the whole session.

## What goes wrong (the four failures)

**1. A dead connection looks exactly like a quiet one.** If your partner's
laptop loses power, nothing tells your side. The connection just goes
silent — and silent is also what "nobody is typing" looks like. You only find
out when you try to send and it fails. The fix: both sides regularly send a
tiny "still there?" message. WebSockets have this built in (called ping and
pong), and the library handles it.

**2. Machines in the middle hang up quiet connections.** Between the browser
and the server sit routers and proxies you don't control, and many of them
drop connections that carry no data for a while — without telling either
end. Same fix as 1: regular small traffic keeps the line visibly alive.

**3. A new connection remembers nothing.** When the browser reconnects after
a drop, the new connection is blank — the server does not know it is "you,
continued". Whatever continuity you want, the app must rebuild. deepcs
rebuilds both halves: it re-checks who you are (the Matching check runs
again) and re-sends the document (from the copy saved in Postgres). This is
why a killed Collab server costs you a two-second reconnect and not your
work.

**4. Every machine in the path has to cooperate.** This one needs unpacking,
because it's really two separate settings with two separate failure modes.

First setting: *forward upgrades at all.* Remember what a proxy is: it reads
your request, then makes its own request onward. A proxy that has never
heard of "switch modes" treats the upgrade like any normal request — it
forwards it expecting one answer, then considers the exchange finished. The
endless two-way traffic that's supposed to follow has no place in its world,
so the connection dies or hangs. The Gateway's proxy library ignores upgrade
requests entirely unless told `websocket: true`, which means: "when one of
these arrives, complete the handshake, open your own connection to the
target, and run the copy loop."

Second setting: *put the identity header on the second connection too.*
Recall that connection 2 (Gateway to Collab) carries a request the Gateway
**writes itself** — it is not the browser's request sliding through. For
normal requests, one setting tells the proxy which headers to attach to its
onward request; that's where `X-User-Id` gets added after the token check.
But the upgrade path is a different piece of code with its **own** header
setting, and its default attaches almost nothing. Configure headers only
once — for the normal path — and here is the resulting bug: your token
verifies fine, the Gateway knows exactly who you are, and then it writes
Collab a request with no identity on it. Collab reads "no header" as
"anonymous", and anonymous is never in any session — so **every** socket
gets rejected as not-logged-in, while login itself is working perfectly.
The identity wasn't wrong; it was dropped in the middle.

## The cost, in one paragraph

A normal request occupies the server for milliseconds. A WebSocket occupies
it for the whole session: memory and one connection slot per person, even
while nobody types. One deepcs process comfortably held 250 of these — not
by using 250 threads, but by asking the operating system "wake me when *any*
of these connections has data" and sleeping the rest of the time.

## When to use what

- **Polling** (ask over and over): simplest, and the only one of the three
  that needs nothing held open, but everything stays busy serving people who
  have no news, and news arrives as late as the gap between asks. Right for
  the match announcement, which happens once and can afford to be seconds
  late, and only because the asking is bounded: while queued, and for a
  minute.
- **SSE** (one answer the server never finishes): the server can push to you,
  but you cannot send anything back on it. Cheaper while nothing is happening
  and instant when something is, at the price of a connection pinned to one
  process, which is what makes scaling down and rolling updates visible to
  users.
- **WebSocket**: both directions, binary, constant. Right for the editor,
  where the browser is sending as much as it receives, and more machinery
  than an announcement needs.

## Left out on purpose

Three real details I'm skipping because libraries handle them and they don't
change the picture: messages from the browser are lightly scrambled in
transit (an anti-tampering rule for old proxies), the 101 answer includes a
computed check value proving the server really speaks WebSocket, and big
messages get split and rejoined automatically. Know they exist; look them up
only if asked.

## Say it out loud (drills)

1. Why can't a normal request deliver your partner's keystroke to you?
   *(The server can only answer; your partner typing gives it news you never
   asked for.)*
2. What are the three phases of a WebSocket's life? *(A normal request asking
   to switch modes, answered with 101; two-way messages; a goodbye carrying a
   close code.)*
3. Why is the login token in the URL here, and nowhere else? *(A browser's
   WebSocket cannot attach the normal login header — but the handshake is
   still an HTTP request, and a request can carry a URL. The Gateway accepts
   a token from the URL only when the request asks to switch modes, so
   ordinary routes cannot be logged into that way.)*
4. How can Collab refuse a connection with a plain 403? *(Before the 101 it
   is still just a normal request.)*
5. Your partner stops receiving your edits but nothing errored. Name two
   possible causes and the shared fix. *(Dead peer, or a middle machine
   dropped the quiet line; regular tiny messages.)*
6. Why does deepcs need close code 4001? *(Reconnect-or-not needs a reason;
   "session over" and "accident" require opposite reactions.)*
