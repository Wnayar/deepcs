# Cost exploration: what deploying this would have cost

**This project is not deployed, and this document is why.** It is kept because
the exploration is the useful part: it works out what a cloud deployment of this
exact system would cost, which meters it would be billed on, and where the money
would actually go. The decision it produced is recorded in the overview ADR-05.

It assumes you know none of the vocabulary. Every term is defined where it first
appears. Read it top to bottom once; the picture in Part 1 is what everything
else refers back to.

The short version: **the thing that costs money is time with a connection open,
not the number of people using the app.** That is a fact about how serverless
platforms meter work, and it stays true whether or not anything is ever
deployed. Why it is true takes about four pages to explain properly, and getting
it wrong is what produces a surprise bill.

Everything below is written in the present tense, as it was when the pricing was
checked (2026-08-11 and 2026-08-12). Read it as "what would happen if this were
deployed", not as a description of anything running.

---

# Part 1 — What you are renting, and what it looks like

Right now everything runs on your laptop. `make up` starts ten processes (a
process is one running program) inside Docker, and your laptop is already paid
for, so none of it costs anything. Deploying means those same processes run on
computers in a Google building instead, and you pay for the time they run.

Here is the whole deployed system. Keep this picture; the rest of the document
points at parts of it.

```
    A person's browser
          │
          │  (1) downloads the page: HTML, JavaScript, the editor
          ▼
  ┌───────────────────────────────────────┐
  │  the static files (Part 6)            │   a "static file" is one that never
  │  Firebase Hosting                     │   changes per visitor: the same
  └───────────────────────────────────────┘   bytes for everyone
          │
          │  (2) then the page starts calling the API, over and over
          ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  GOOGLE CLOUD RUN, in a Singapore data centre                │
  │                                                              │
  │   Gateway ──┬── Users          each box here is one of your  │
  │             ├── Questions      services: the same Docker     │
  │             ├── Matching       images `make up` runs locally │
  │             ├── Collab                                       │
  │             └── Stats-api                                    │
  │                                                              │
  │   Stats job: started on a timer, does its work, exits        │
  └─────────────────────────────────────────────────────────────┘
          │                              │
          │  (3) SQL queries             │  (4) Redis commands
          ▼                              ▼
  ┌──────────────────────┐      ┌──────────────────────┐
  │  Neon                │      │  Upstash             │
  │  rented Postgres     │      │  rented Redis        │
  │  (Singapore)         │      │  (Singapore)         │
  └──────────────────────┘      └──────────────────────┘
```

Four companies are involved and they bill on completely different things:

| Who | What you pay for |
|---|---|
| Google Cloud Run | seconds that one of your services has a request open |
| Neon | hours that the database is running at all |
| Upstash | the number of Redis commands you send |
| Firebase Hosting | bytes stored and bytes sent to visitors |

The rest of this document is about the first one, because it is the only one of
the four that keeps charging you instead of stopping.

---

# Part 2 — Cloud Run: what "an instance" is, and when you pay

**Cloud Run** is Google's service that takes a Docker image (a packaged
filesystem plus the command to run it — exactly what `docker compose up` uses
locally) and runs copies of it on their machines.

**An instance** is one running copy of one service. Locally you have exactly one
of each: `docker ps` shows `deepcs-collab-1`, and that is one instance of
Collab. On Cloud Run the number changes by itself: zero when nobody is using it,
more when many people are.

**Scaling to zero** is the part that makes this affordable. When no requests
have arrived for a while, Google stops your instance entirely. Zero instances
means zero cost. When the next request arrives, Google starts one — that takes
about a second, and it is called a **cold start**: the delay a visitor sees
because their request had to wait for a program to boot.

Now the billing rule. Google's own wording is the clearest, and it is worth
reading twice because two nearby statements that sound similar are both wrong:

> "Cloud Run pricing is per instance time. If you set request-based billing, the
> instance time is **the time each instance spends processing at least one
> request**."

So the meter runs on **wall-clock time during which the instance has at least
one request still open**, rounded up to the nearest 100 milliseconds.

Two things that rule is *not*:

- It is not the time the instance exists. An instance sitting there with nothing
  to do costs nothing.
- It is not the sum of the individual requests. **One request open for a minute
  and 250 requests open for that same minute cost exactly the same**, because
  the meter is asking "is this instance busy at all right now?", not "how busy".
  That is what the `--concurrency` setting is for, and it is the single most
  useful fact in this document.

Drawn on a timeline, where `█` is billed and `·` is free:

```
   one request                        many requests, overlapping
        │                                   │ │ │  │ │
  ──────┼───────────────────────────────────┼─┼─┼──┼─┼──────────►  time
        ██·······························   ███████████··········
        ▲                                   ▲         ▲
   50 ms of work,                     the meter starts    and stops when
   then idle and free                 with the first      the last one
                                      request             finishes
```

The right-hand side is why five people using the app at once is not five times
the cost of one person. It is the same cost, until there are enough of them to
force Google to start a second instance.

**One addition, which does not follow from the rule above.** Google lists three
billable states, not one: "Cloud Run instances are only charged when they
process requests, **when they start, and when they shut down**." Starting and
stopping are billed because the instance is holding the CPU and memory Google
allocated to it while your program boots and while it exits, even though no
request is being handled — and for this app the shut-down is real work rather
than a formality, since Collab writes every open document to Postgres on the way
out. So cost is not purely a function of connected time; it also rises with
*how often* instances start. That is the hidden side of `--min-instances=0`,
which trades idle cost for a start-up charge, and a slow first request, every
time traffic returns after a quiet spell.

---

# Part 3 — The unit Google counts, and how much you get free

A **vCPU** ("virtual CPU") is one share of a processor core. Your laptop has 16
of them. A Cloud Run service is given a fixed amount — the default is 1 vCPU
per instance, which is what we will use.

Google measures usage in **vCPU-seconds**: one instance with 1 vCPU, with **at
least one** request open for one second, is one vCPU-second — one request or
forty, it is the same one vCPU-second. Memory is counted the same way in
GiB-seconds (a GiB is a gigabyte of memory).

Every month, free:

| | Free each month | What that is in plain terms |
|---|---|---|
| 180,000 vCPU-seconds | = 50 hours at 1 vCPU **in a Tier 1 region**, ≈ **36 hours** in ours | see the Tier 2 note below |
| 360,000 GiB-seconds | = 200 hours at 512 MiB | see below; it never runs out first |
| 2,000,000 requests | $0.40 per million after that | unreachable here, see below |

**The memory unit, since it is the confusing one.** You are renting two things
at once and each is metered separately, both as *amount × time*. A **GiB**
(gibibyte) is a unit of memory, about 1.07 gigabytes. One GiB held for one
second is one GiB-second — and Google's own example is that 256 MiB held for
four seconds is also one GiB-second, because it is the product that counts.

Our instances get 512 MiB, which is half a GiB, so every second with a request
open spends **1 vCPU-second and 0.5 GiB-seconds** at the same time. Dividing
each into its allowance: CPU gives 180,000 ÷ 1 = 50 hours, memory gives
360,000 ÷ 0.5 = 200 hours. Both clocks run together, so CPU reaches zero while
memory is still three-quarters full. That is the whole reason the memory row can
be ignored, and it stops being true only if the memory setting goes up.

**What "memory" means here, and what is in it.** Two different things get called
memory in this system and only one of them is this. This one is RAM on the
rented computer: the working space of a running program, erased when the program
stops. It is *not* the database — Neon keeps your questions, users and sessions
on disk, where they survive everything, and that is the separate 0.5 GB in
Part 5.

Phase 7 measured what the Collab service actually holds:

| | |
|---|---|
| 117 MB | just to exist: the Node runtime, Fastify, Yjs, the Postgres and Redis clients, all loaded before a single visitor arrives |
| 258 MB | peak, while holding 250 sockets and 125 live documents |

The 141 MB in between is the work itself. Every open WebSocket has buffers for
the bytes in flight, and every session's document sits in memory as its text
plus the history of every edit made to it. That is also why the measurement came
back down afterwards: the documents were released as the rooms closed.

**You pick the limit, and you pay for the limit rather than for what you use.**
512 MiB is a setting on the service, not a measurement of it. An instance using
258 MB of its 512 MiB bills exactly the same as one using 90 MB. So measuring
does not lower the bill — it tells you whether the setting is *safe*.

**What happens if it is too low.** The instance exceeds its limit and Cloud Run
kills the container on the spot. There is no SIGTERM, so the shutdown snapshot
in `services/collab/src/index.ts` never runs, and since documents are otherwise
written every 30 seconds, every session on that instance loses up to 30 seconds
of typing.

That is why the setting is 512 MiB and not 256 MiB. 256 MiB is 268 MB, and the
measured peak was 258 MB — about 10 MB of headroom, one large document away from
that kill. The larger setting costs nothing in practice, because CPU is what
runs out first (36 hours against 143), so the smaller one would buy nothing and
risk losing edits.

**The per-request charge.** Two million requests a month are free, then it is
$0.40 per million — 3 million requests in a month costs 40 cents. Reaching a
single dollar takes 150,000 requests a day, every day. It is also the meter that
suits this app least: a WebSocket counts as **one** request no matter how many
keystrokes travel through it, so the thing we do most does not register here at
all. Ignore this line.

Both CPU and memory are counted, and you pay for whichever you exceed. CPU runs
out four times sooner than memory, so there is only one number to think about —
but the free allowance is worth less to us than the table suggests, and this is
the single most expensive detail in this document.

**Our region is a Tier 2 region, and the free tier is priced at Tier 1.** Google
runs two price bands: Tier 1 regions are cheaper per second than Tier 2, and
`asia-southeast1` (Singapore), which DESIGN §7 chose, is **Tier 2**. Meanwhile
the pricing page says "the free tier is applied as a spending based discount
using **Tier 1** pricing". So the free allowance is really a *sum of money*
worth 180,000 seconds at the cheaper rate, spent at our more expensive one:

```
  the discount, valued at Tier 1:  180,000 × $0.000024  = $4.32 of CPU
  what it buys at Tier 2 rates:      $4.32 ÷ $0.0000336 = 128,571 vCPU-seconds
                                                        ≈ 36 hours, not 50
```

So the number to hold is:

> **About 36 hours a month of instance time** — Part 2's meter, wall-clock time
> during which one of your services has at least one request still open — after
> which it is **$0.127 per instance-hour** at 1 vCPU and 512 MiB.

That is roughly 1 hour 12 minutes a day, added up across all six services.
Notice what it is *not*: it is not 36 hours of *somebody using the app*, and it
is not a number of visitors. Ten people using it simultaneously spend the budget
at the same rate as one person, and one person who leaves a connection open
spends it at the same rate as ten.

Two consequences, both in the table in Part 10: moving to a Tier 1 region would
cut the rate by 29% *and* make the free allowance go the full 50 hours, and it
is the only change in this document that alters the dominant cost rather than a
rounding error.

---

# Part 4 — Why an editor session costs 120 times more than a page view

This is the part that decides everything, and it follows from Part 2's billing
rule plus one fact about how the app works.

**An ordinary API call is short.** The browser asks for the roadmap, Questions
answers in about 50 milliseconds, the request is over. Clicking around for ten
minutes might be 30 such calls: 30 × 50 ms is **1.5 seconds** of billing.

**A WebSocket is not short.** A WebSocket is a connection that stays open, so
both sides can send messages whenever they like without asking again — it is how
the shared editor sends your keystrokes to the other person. From Cloud Run's
point of view, that is *one request that lasts the entire session*. Google
states this directly: an instance with an open WebSocket has CPU allocated for
as long as the connection is open. Thirty minutes in the editor is **thirty
minutes** of billing.

**`/match/events` is the same shape.** When you sit on the "find a partner"
page, the browser opens one HTTP response that the server holds open, and writes
into it when something happens (this is called **SSE**, server-sent events).
Phase 6 replaced polling with it precisely because polling was waking everything
up constantly. It is cheaper than polling, but it is still an open request, so
it bills for as long as the page is open.

**And every socket keeps two services busy.** The browser does not talk to
Collab directly — it goes through the Gateway, which holds its own copy of the
connection open to Collab. DESIGN §5 already says one collab socket occupies a
slot on both. Both instances therefore have a request open, and both are on the
meter for the whole session.

```
   browser ══════════ Gateway ══════════ Collab
            socket 1            socket 2
            (billed)            (billed)
```

Here is what that costs. Read the right-hand column as instance time — Part 2's
meter — not as a number of people, because **every row costs the same whether
one person or forty are doing it**, right up until the load is heavy enough to
start a second instance:

| What is happening | What has a request open | Cost against the 36 hours |
|---|---|---|
| someone reads the roadmap for 10 minutes | Gateway + Questions, 50 ms at a time | ~3 seconds |
| one or more people wait on the queue page for 5 minutes | Gateway + Matching, held open | 10 minutes |
| one or more editor sessions run for 30 minutes | Gateway + Collab, held open | 60 minutes |
| one tab left open on the queue page overnight | Gateway + Matching, held open | **16 hours** |

The third row is worth pausing on: a demo where six people collaborate for half
an hour costs the same 60 minutes as a demo with two. What you pay for is the
*duration something was connected*, and the number of people barely enters into
it.

The last row is the one to care about. One forgotten browser tab spends a third
of the monthly budget while nobody is looking at it.

**What happens when the 36 hours run out?** Nothing breaks. You start paying,
at **$0.127 per instance-hour** (1 vCPU + 512 MiB at our region's Tier 2 rates:
3600 × $0.0000336 for CPU, plus 3600 × 0.5 × $0.0000035 for memory). Going 100
hours over is about $13. The danger is not a single catastrophe, it is a slow
leak nobody notices, which is exactly what a forgotten tab is.

---

# Part 5 — Neon and Upstash stop instead of charging you

The database and Redis are on free plans that **suspend service** when exhausted
rather than billing. That makes them an availability problem, not a money
problem, and there is one real trap.

## Neon (the rented Postgres)

Free plan: 0.5 GB of stored data, and **100 CU-hours** a month. A **CU**
("compute unit") is how much processor and memory the database gets; the free
plan runs at 0.25 CU. So 100 CU-hours ÷ 0.25 = **400 hours awake per month**.

Neon **sleeps after 5 minutes** with no queries, and sleeping is free. A month is
730 hours, so the database can be awake for a bit over half the month.

**Neon's meter is not Cloud Run's, and the difference matters.** Cloud Run
charges only while a request is open; Neon charges for every hour the database
is *running*, whether or not anything is querying it. So on Cloud Run the
question is "how long was something connected", and on Neon it is "how long did
we stop it going back to sleep". That second question is what the next paragraph
is about.

**The trap, and it is a real one.** DESIGN §5 has the Stats job running on a
timer every 5 minutes. Every run queries Postgres, and every query resets the
5-minute sleep countdown. A job every 5 minutes means the database never sleeps
at all: 730 hours needed against 400 available. Around day 17 of the month Neon
suspends the database, every service fails its health check, and the site is
down until the month rolls over.

**The fix:** run the job hourly. Each run wakes the database for about six
minutes, so 24 runs a day is roughly 72 hours a month — comfortably inside 400.
Statistics that are an hour old are fine; nobody is watching them live.

## Upstash (the rented Redis)

Free plan: **500,000 commands a month**. A command is one operation. Two things
spend them:

- every API request through the Gateway spends one, because the rate limiter
  checks your allowance in Redis;
- every keystroke batch in the editor spends one, because the edit is published
  to Redis so other instances can see it.

For scale: the load test in phase 7 sent 58,870 edits in six minutes, which is
about 12% of a month's commands. That is why the plan says the cloud load test
is the small one. When you run out, Upstash refuses commands rather than
charging — the app degrades, the bill does not move.

---

# Part 6 — The frontend, and what "hosting" even means

This is the box at the top of the Part 1 picture, and it works nothing like the
rest of the system.

**The frontend is not a program running on a server.** Locally it looks like one
because `make web` starts a development server on your laptop, but that server
exists only to rebuild the page while you edit it. In production there is
nothing running. `pnpm build` turns all the React source into a folder of
ordinary files — I just ran it, and this is the entire output:

```
dist/index.html                    1.15 kB
dist/assets/index-*.css           88.92 kB   (14.7 kB compressed)
dist/assets/index-*.js         3,110.09 kB   (822 kB compressed)   ← the whole app
dist/assets/editor.worker-*.js   300.37 kB   ← the code editor, loaded only in a session
```

Four files. That folder *is* the frontend. A visitor's browser asks for
`index.html`, sees that it references the `.js` and `.css`, downloads those, and
from that moment everything you see happens inside their browser, on their
machine. Nothing on our side renders anything.

**So "hosting" here means one job:** a computer on the internet that hands back
a file when someone asks for a path. That is all Firebase Hosting is. It is not
running your code, it has no database, and it cannot be "flooded" into costing
CPU time the way Cloud Run can, because there is no CPU time — only bytes sent.

**Where the data comes from, then.** The downloaded JavaScript calls the Gateway
on Cloud Run for everything real. Two different addresses are involved:

```
   browser ──── files ────► Firebase Hosting        (HTML, JS, CSS: once, then cached)
      │
      └──────── data ─────► Gateway on Cloud Run    (questions, matching, the editor socket)
```

That split has one configuration consequence you will hit at deploy time.
Browsers refuse to let a page served from one address read responses from a
different address unless that other address explicitly allows it — this is
**CORS**. The Gateway already implements it and reads the allowed address from
`CORS_ORIGIN`, which is `http://localhost:5173` today. It has to become the
Firebase Hosting address, or every API call from the deployed site is blocked by
the browser while working perfectly in curl.

## Why Firebase Hosting rather than a Cloud Storage bucket

DESIGN §7 originally said bucket plus CDN. A **CDN** (content delivery network)
is a service that keeps copies of your files in data centres around the world so
each visitor downloads from a nearby one instead of from Singapore. Three
reasons to switch:

**It is free and the bucket is not.** Google Cloud Storage's free allowance is
US regions only, so a Singapore bucket bills from the first byte, and Cloud CDN
in front of it has no free tier at all. Firebase Hosting gives 10 GB stored and
10 GB transferred per month at no cost, with the CDN and the HTTPS certificate
included.

**The URL problem, which is the real reason.** Every screen in the app is a URL
— `/step/abc`, `/match`, `/session/xyz` — but there is only *one* HTML file. If
someone opens `/step/abc` directly, or refreshes on it, the host looks for a
file at that path, does not find one, and answers "404 not found". The app never
loads. Firebase Hosting solves this with a rewrite rule, one line of config:
*if you cannot find the file, send `index.html` anyway* — and the JavaScript
router then reads the address and shows the right screen. A storage bucket can
only be told "use index.html as the error page", which sends the right content
with a 404 status attached, so search engines and anything checking the status
code are told the page does not exist.

**It is not a new vendor.** The same Firebase project already issues your login
tokens, and the API is already switched on in `deepcs-will`.

## What it costs, measured

The build above reports each file twice, raw and compressed. **Only the
compressed size is ever sent**, because Firebase compresses before sending and
the browser decompresses on arrival, so the 3,110 kB figure never crosses the
network. Adding what one first visit fetches:

```
  822.03 kB   the app's JavaScript, compressed
+  14.70 kB   the CSS, compressed
+   0.65 kB   index.html, compressed
= 837.38 kB   ≈ 0.84 MB per first visit

  10 GB = 10,000 MB   ÷ 0.84 MB  ≈  12,000 first visits a month
```

Two things make that a ceiling rather than a promise:

- **The editor file.** 300 kB, and the build reports no compressed size for it.
  It downloads only when someone opens a session. If every visitor does and it
  compresses badly, a visit is 1.14 MB and the allowance is nearer **8,800**
  visits. Treat the real number as somewhere in 8,800–12,000.
- **Every deploy resets the caching.** The filename `index-CuimWudV.js` contains
  a hash of the file's contents, so changing any code changes the name, and a
  returning visitor fetches the whole bundle again rather than using the copy
  they already had. Ten deploys in a month turns one regular visitor into
  roughly ten visits.

**What happens if you exceed it depends on a detail that applies to us.** On
Firebase's no-cost Spark plan the site is disabled until the next month. But a
project with a billing account attached is on the Blaze plan, and `deepcs-will`
has one — so instead of stopping, it bills **$0.15 per extra GB transferred**
and $0.026 per extra GB stored. Firebase Hosting therefore belongs with Cloud
Run in the "keeps charging" column, not with Neon and Upstash.

---

# Part 7 — The small costs, so you can stop thinking about them

| Thing | Free amount | Ours | Verdict |
|---|---|---|---|
| Artifact Registry (where the Docker images are stored) | 0.5 GB | six images exceed it | cents a month; add a rule that keeps only the last few versions |
| Cloud Logging (the log lines every service writes) | 50 GB per month | a tiny fraction of that | ignore it, keep logging at `info` |
| Secret Manager (where passwords and connection strings live) | 6 secrets | about 6 | cents |
| Egress (bytes leaving Google's network to the internet) | 1 GB, **North America only** | ours is Singapore, so nothing is free | tiny for the API; the frontend files are the only large thing |

That last row is the reason for one recommendation in Part 8: the JavaScript
bundle is a few megabytes (the code editor is most of it), and every visitor
downloads it. Serving it from Firebase Hosting instead of from Google Cloud
Storage moves those bytes onto a free 10 GB-per-month allowance and includes a
**CDN** (copies of your files kept in data centres near the visitor, so the page
loads fast worldwide) and the HTTPS certificate, at no cost.

---

# Part 8 — The guard rails that already exist

You built these in phase 0 and they are still running. This is what each one
actually does:

**The kill switch.** A budget of $20 that, when reached, runs a small program
that disconnects the payment method from the project. Everything stops. Two
weaknesses worth knowing: billing data lags by hours, so a runaway can overshoot
before it fires, and disconnecting billing is destructive — resources can be
deleted, not paused. It is a backstop, not a control.

**Budget alerts at $10, $18, $20.** Emails. They do nothing except tell you.

**`--min-instances=0`.** Never keep an instance running when idle. This is the
flag that makes idle genuinely free, and it is the most important one.

**`--max-instances=2`.** Never run more than two copies of a service, no matter
how much traffic arrives. Beyond that, visitors get an error instead of you
getting a bill. This caps the worst case absolutely.

**`--concurrency`.** How many requests one instance handles at the same time —
80 for the simple services, 250 for the Gateway and Collab. This is why two
instances are enough: one instance serves 250 people at once rather than one
person at a time.

**Enabled APIs.** Google services that are switched off cannot be used and
therefore cannot be billed. Only the ones this system needs are on.

---

# Part 9 — The five decisions, in plain terms

**1. Serve the frontend from Firebase Hosting instead of a storage bucket?**
*Recommended: yes.* Free for 10 GB stored and 10 GB sent per month, includes the
CDN and the certificate, and it can serve `index.html` for any URL in one line
of config (which the app needs, because every screen is a URL). The alternative
in DESIGN §7, a Cloud Storage bucket plus Cloud CDN, has no free tier in
Singapore and needs a workaround for those URLs. *Cost of choosing it:* one line
of DESIGN §7 changes.

**2. Run the Stats job hourly instead of every 5 minutes?**
*Recommended: yes.* This is the Neon trap from Part 5. Every 5 minutes takes the
site down around day 17 of each month. *Cost of choosing it:* `/stats` numbers
can be up to an hour behind.

**3. Close the `/match/events` connection when the tab is hidden or idle?**
*Recommended: yes.* This is the forgotten-tab row in Part 4 — the largest
avoidable cost in the system. *Cost of choosing it:* a small frontend change,
and someone who leaves the queue page open in a background tab stops being
matched until they come back to it. That needs a visible "still looking?" state
rather than silence.

**4. Add the Cloud Run spend cap alongside the kill switch?**
*Recommended: yes.* It is a newer Google feature that blocks new Cloud Run usage
at a limit without deleting anything, and it reacts faster than the kill switch.
It only covers Cloud Run, so it adds to the kill switch rather than replacing
it. One caution already recorded in DESIGN §7: it must not be applied to "Cloud
Run functions", because the kill switch itself runs there and capping it would
disable the backstop.

**5. Are you still on the $300 free trial, or is this a paid account?**
This changes what happens at the ceiling. On the trial, Google cannot charge
your card — services simply stop when credits run out. On a paid account, the
kill switch detaching billing is the thing that stops them, and its lag becomes
your exposure. I need to know which before deploying.

---

# Part 10 — Every cost, in one table

Every line that can charge this project, including the ones earlier parts told
you to ignore — those are marked *ignore* rather than left out, so the table is
something you can vet rather than trust. Prices checked against each vendor's
own pricing page on 2026-08-12.

Region matters throughout: `asia-southeast1` is a **Tier 2** Cloud Run region,
and the free allowance is a spending discount valued at **Tier 1** rates. The
"our plan now" column describes the deployment as it was specified in the overview
§7, not anything that exists.

## Google Cloud

| What it is | What it costs | Our plan now | Worth changing to |
|---|---|---|---|
| **Cloud Run compute** — the six services, billed per second with at least one request open | Tier 2: $0.0000336/vCPU-s + $0.0000035/GiB-s = **$0.127 per instance-hour** at 1 vCPU/512 MiB. Free discount ≈ $4.32/month, worth **~36 instance-hours** here | 1 vCPU, 512 MiB, `min-instances=0`, `max-instances=2`, Singapore | **Move to a Tier 1 region** (asia-southeast3 Bangkok, asia-northeast1 Tokyo): $0.091/hour and the discount covers the full 50 hours. ~29% cheaper and 14 more free hours. Weigh against Neon/Upstash staying in Singapore |
| **Cloud Run requests** | $0.40 per million after 2M free | same | *ignore* — a WebSocket is one request however long it lives |
| **Cloud Run job** (Stats) — same meter, runs and exits | included above; seconds per run | every 5 minutes | **Hourly.** Not for the Cloud Run cost, which is trivial, but for Neon below |
| **Cloud Run functions** (the kill switch) | Cloud Run rates; fires at most once | deployed, idle | keep |
| **Internet egress** — bytes leaving Google to a browser | **$0.12/GiB** from Asia. The 1 GB free tier is North America only, so nothing here is free | API traffic only (the frontend is served elsewhere) | keep. Measured: the whole 250-socket load test moved 13 MB |
| **Artifact Registry** — the Docker images | **$0.10/GiB/month** after 0.5 GiB free. Pulls to Cloud Run in the same region are free | six images, no cleanup | **Add a keep-last-3 cleanup policy.** Without it this grows for ever; with it, cents |
| **Secret Manager** | **$0.06 per active secret version/month** after 6 free; 10,000 access operations/month free | ~6 secrets (5 database URLs + Redis) | keep, but delete old versions when rotating — each retained version bills |
| **Cloud Scheduler** | **3 jobs/month free per billing account** | 1 job | keep |
| **Cloud Logging** | 50 GiB/project/month free, then **$0.50/GiB** | `LOG_LEVEL=info`, six services | keep — *ignore*, we produce a tiny fraction of 50 GiB |
| **Pub/Sub** (kill-switch trigger) | 10 GiB/month free | a few bytes a month | *ignore* |
| **Cloud Build** | 2,500 build-minutes/month free | GitHub Actions builds our images, so this is only used when the kill-switch function is redeployed | *ignore* |
| **Firebase Hosting** — the frontend files | 10 GB stored + 10 GB/month transferred free. **On Blaze, which we are, overage bills $0.026/GB stored and $0.15/GB transferred** | not yet deployed | adopt it (DESIGN §7 currently says bucket + CDN, which has no free tier in Singapore) |
| **Firebase Auth** | 50,000 monthly active users free | in use | *ignore* |
| **Cloud Storage + Cloud CDN** — the alternative to the row above | Free tier is **US regions only**; Cloud CDN has none | not used | do not adopt |

## Neon (Postgres)

| What it is | What it costs | Our plan now | Worth changing to |
|---|---|---|---|
| **Compute** — hours the database is *running*, whether or not it is queried | Free: **100 CU-hours/month** ≈ 400 hours awake at 0.25 CU. Exceeded → the database is **suspended** until next month | Free plan, 5-minute autosuspend | keep the plan, but **run the Stats job hourly**. At every 5 minutes the database never sleeps: 730 hours needed against 400 available, so it suspends around day 17 and the site goes down |
| **Storage** | Free: 0.5 GB. Exceeded → writes fail | Free plan | keep. Watch it: every load test leaves users, sessions and document snapshots behind |
| **Network transfer** | Free: 5 GB/project/month | Free plan | keep |
| **Paid plan, if ever needed** | **$5/month minimum**, then $0.106/CU-hour and $0.35/GB-month | not on it | only if the free compute genuinely runs out after the hourly change |

## Upstash (Redis)

| What it is | What it costs | Our plan now | Worth changing to |
|---|---|---|---|
| **Commands** — one per API request (the rate limiter) and one per editor edit (the publish) | Free: **500,000/month**. Pay-as-you-go: **$0.20 per 100K** | Free plan | keep, and never point the load test at production: one 6-minute run spent 58,870 commands, about 12% of the month |
| **Storage** | Free: 256 MB; then $0.25/GB after the first GB | Free plan | keep |
| **Bandwidth** | Free to 200 GB, then $0.03/GB | Free plan | *ignore* |
| **Spend control** | A monthly budget cap is available on pay-as-you-go | not applicable on Free | set one if you ever move off Free |

## The three rows that actually move money

Everything else on this page is cents. In order:

1. **The region.** Being in Tier 2 costs 40% more per second *and* shrinks the
   free allowance from 50 hours to 36. Moving to Bangkok or Tokyo is the only
   change here that alters the dominant cost. The counter-argument is latency to
   Neon and Upstash, which live in Singapore — so this is a real trade, not a
   free win.
2. **Idle connections.** At $0.127/hour, one tab left open overnight on the
   queue page is 16 instance-hours, which is roughly $2 once the free allowance
   is gone — and it recurs.
3. **The Stats schedule.** Costs almost nothing on Cloud Run and takes the
   database down on Neon.

---

# What I have not verified

Everything in Part 10 was checked against the vendor's own pricing page on
2026-08-12. Three things remain open:

- **How the Cloud Run free discount is actually applied in a Tier 2 region.**
  Google says "the free tier is applied as a spending based discount using
  Tier 1 pricing", and the ~36 hours in Part 3 is my arithmetic from that
  sentence, not a worked example from Google. The other reading — 180,000
  seconds free wherever you run — would give 50 hours. The first invoice
  settles it; plan against 36.
- **Cloud Scheduler's price beyond the 3 free jobs**, which we do not reach.
- **Whether the load test's 13 MB scales linearly** into the egress estimate.
  It is small enough either way.

One claim I checked and rejected: several third-party pages say the Cloud Run
free tier applies only in us-central1, us-east1 and us-west1. Google's own
Always Free page attaches no region restriction to Cloud Run — only to Cloud
Storage — so those pages appear to be conflating the two products.

Sources, all checked 2026-08-11 and 2026-08-12:
[Cloud Run pricing](https://cloud.google.com/run/pricing) ·
[Cloud Run locations and pricing tiers](https://docs.cloud.google.com/run/docs/locations) ·
[Always Free features](https://docs.cloud.google.com/free/docs/free-cloud-features) ·
[WebSockets on Cloud Run](https://docs.cloud.google.com/run/docs/triggering/websockets) ·
[Cloud Run billing settings](https://docs.cloud.google.com/run/docs/configuring/billing-settings) ·
[Cloud Run concurrency](https://docs.cloud.google.com/run/docs/about-concurrency) ·
[Artifact Registry pricing](https://cloud.google.com/artifact-registry/pricing) ·
[Secret Manager pricing](https://cloud.google.com/secret-manager/pricing) ·
[Cloud Scheduler pricing](https://cloud.google.com/scheduler/pricing) ·
[Network pricing](https://cloud.google.com/vpc/network-pricing) ·
[Observability pricing](https://cloud.google.com/products/observability/pricing) ·
[Neon plans](https://neon.com/docs/introduction/plans) ·
[Neon free plan limits](https://neon.com/faqs/free-plan-limits-and-quotas) ·
[Upstash Redis pricing](https://upstash.com/pricing/redis) ·
[Firebase Hosting quotas and pricing](https://firebase.google.com/docs/hosting/usage-quotas-pricing) ·
[Firebase pricing plans](https://firebase.google.com/pricing)
