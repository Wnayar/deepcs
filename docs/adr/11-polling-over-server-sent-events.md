# ADR-11 — Polling `/match/status`, not a held-open response

**Decision:** a waiting browser learns it has been matched by asking
`GET /match/status` every three seconds, bounded to somebody actually waiting
and to one minute. Matching has no endpoint that holds a response open.

**Why the question exists at all:** being matched is caused by somebody else's
request, and HTTP gives a server no way to speak first. A client either asks
repeatedly or is told, and there is no third option.

**What being told would buy, because it is real:** an idle connection costs one
socket and no CPU, the news arrives in milliseconds instead of on average a
second and a half, and the interval stops being a latency knob. Server-sent
events — an ordinary HTTP response the server declines to finish — was built
here and worked, delivering in 23 ms end to end through the Gateway. Reaching
the browser from whichever instance made the match needs Redis pub/sub either
way, keyed by uid, because the instance holding a socket is not the instance
that pairs you.

**Why it was removed anyway:** a held-open response lives in the memory of one
process, and that turns operational events into user-visible ones.

- A polling instance can be terminated between two requests and nobody notices.
  An instance holding open responses cannot: shutting it down either severs them
  all at once or waits out a grace period it will be killed at the end of
  anyway, because those responses never finish on their own.
- Every rolling update severs every connection, and every reconnect is a
  thundering herd of the same size as the instance's connection count.
- **Load stops rebalancing.** A polling client re-lands on an instance every few
  seconds, so a new replica takes traffic as soon as it is ready. A held
  connection stays pinned until it breaks, so scaling up relieves nothing.
- The autoscaling signal lies. An instance holding thousands of idle
  connections uses almost no CPU, so a CPU-based rule scales it down and severs
  them to save nothing. Scaling on connection count is the fix, and it is a
  thing you have to know to go and do.

**Why that verdict is specific to this queue, not general:** connection lifetime
decides how much of the above bites. Something people hold for hours has all of
it badly. A matching queue is entered, answered within seconds, and abandoned
after a minute, so the window in which any of it can hurt anybody is a minute
wide — and the thing being bought with all that operational weight is a single
notification that can afford to be three seconds late.

**What it costs, and it is not nothing:** a waiting user spends 20 requests a
minute that mostly answer "no", each one a Gateway hop and a Postgres read, and
the news is up to three seconds late. That is affordable only because the asking
is bounded on three sides — only while queued, only for a minute, and inside a
rate-limit budget that already exists. An unbounded poll is the version of this
that was wrong, and it was wrong here first: an earlier one ran for everybody
signed in and kept a database and two services awake for readers who were not
waiting for anything.

**The bound needs a server-side half.** A browser that gives up cannot tell the
server, and there is no leave endpoint, so a queue entry outliving its owner is
claimable and pairs the next joiner with somebody who has gone. Entries are
therefore only claimable for 60 seconds, pruned inside the same Lua scripts that
read the queue, against Redis' own clock.

See [`../system/04-matching.md`](../system/04-matching.md) §5 and
[`03-reactive-matching-with-an-atomic-claim.md`](03-reactive-matching-with-an-atomic-claim.md).
