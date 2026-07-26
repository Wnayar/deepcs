# DeepCS — Design Q&A

Working notes on the parts of `DESIGN.md` I'm still going through. Everything
else that was here has been merged into the design doc itself; the full earlier
version is in git history.

**Contents**

- [**0. Foundations — read this first**](#0)
  - [0.1 The one fact everything follows from](#0-1)
  - [0.2 What a CPU core actually does](#0-2)
  - [0.3 Program, process, and memory](#0-3)
  - [0.4 Threads](#0-4)
  - [0.5 The kernel, and why you can't touch the network card](#0-5)
  - [0.6 Blocking vs non-blocking](#0-6)
  - [0.7 Concurrency vs parallelism](#0-7)
  - [0.8 Two ways to serve many users at once](#0-8)
  - [0.9 Race conditions and atomicity](#0-9)
  - [0.10 Little's Law — the formula behind `--concurrency`](#0-10)
  - [0.11 Percentiles](#0-11)
  - [0.12 Containers, and what a Cloud Run "instance" is](#0-12)
  - [0.13 Carry these into 33 / 37 / 47](#0-13)
- [33. max-instances vs concurrency](#33)
- [37. k6 + concurrency fundamentals](#37)
- [47. Threads, the event loop, and what Node actually does](#47)

---

<a id="0"></a>
# 0. Foundations — read this first

Everything in §33, §37 and §47 is built on about ten ideas. None of them is hard;
they're just usually taught with the jargon left in. This section defines every
term as it appears and draws the thing being described.

<a id="0-1"></a>
## 0.1 The one fact everything follows from

**A CPU is extraordinarily fast. Everything it might have to wait for is
extraordinarily slow.** That gap is the reason concurrency exists, the reason
event loops exist, and the reason `--concurrency=80` is a sensible number.

Approximate times for one operation. The exact values change with hardware — the
**ratios** are what matter:

```
  operation                          time        how many CPU
                                                 instructions
                                                 fit in that time
  ──────────────────────────────────────────────────────────────
  execute 1 instruction              ~0.3 ns     1
  read from L1 cache                 ~1 ns       ~3
  read from main memory (RAM)        ~100 ns     ~300
  read 4 KB from an SSD              ~150 µs     ~500,000
  network round trip, same DC        ~500 µs     ~1,700,000
  ► your Postgres query (Neon)       ~30 ms      ~100,000,000
  network round trip, cross-ocean    ~150 ms     ~500,000,000
```

Read the last two rows again. **While one Postgres query is in flight, the CPU
could have executed roughly a hundred million instructions.** If the CPU just
sits there, essentially all of its capacity is wasted.

```
  a "typical" DeepCS request, drawn to scale:

  |CPU 2ms|················ waiting on Postgres 30ms ················|
   ~6%                              ~94%
```

Everything that follows is one question: **what does the machine do during
that 94%?**

<a id="0-2"></a>
## 0.2 What a CPU core actually does

A **core** is one independent instruction-executing unit. A modern chip has
several — "8 cores" means eight of these.

A core does exactly one thing, forever: fetch the next instruction, decode it,
execute it, repeat. An **instruction** is a tiny operation — add two numbers,
copy a value from memory into a register, jump to a different place in the code.
A **register** is one of a few dozen tiny storage slots inside the core itself;
they're where arithmetic actually happens.

```
   ┌──────────────── ONE CORE ────────────────┐
   │                                          │
   │   fetch → decode → execute → repeat      │
   │                                          │
   │   registers: [r1][r2][r3][r4] …          │
   │   instruction pointer: "I'm at line 47"  │
   └──────────────────────────────────────────┘
```

**The rule to hold onto: one core executes one instruction stream at a time.**
Not two. Everything about "running many things at once" is either the core
switching between streams very fast, or there being more than one core.

The **instruction pointer** (also called the program counter) is the core's
record of where it is. Switching to different work means saving that pointer and
loading another — which is the whole idea behind threads, below.

<a id="0-3"></a>
## 0.3 Program, process, and memory

- A **program** is a file on disk. It does nothing.
- A **process** is a program that's running. It has its own private memory that
  no other process can read.

That privacy is enforced by hardware. Each process gets a **virtual address
space** — it sees addresses starting at zero and the hardware translates those to
real physical memory. Two processes can both use "address 1000" and get
completely different bytes. **This is why one Cloud Run instance crashing cannot
corrupt another**, and it's the foundation of every isolation guarantee below.

A process's memory is divided into regions. The two that matter here:

```
   ┌─────────────────────────────┐  high addresses
   │  STACK          ↓ grows down│   function calls and their local
   │                             │   variables — automatic, LIFO
   │                             │   (last in, first out)
   │        (unused space)       │
   │                             │
   │  HEAP           ↑ grows up  │   anything that must outlive the
   ├─────────────────────────────┤   function that made it —
   │  GLOBALS / static data      │   objects, arrays, buffers
   ├─────────────────────────────┤
   │  CODE (the instructions)    │
   └─────────────────────────────┘  low addresses
```

**Stack:** when you call a function, a **stack frame** is pushed on — its
arguments, its local variables, and the address to return to. When the function
returns, the frame is popped and that memory is instantly reusable. It's fast and
completely automatic. It's also *small* (commonly ~1–8 MB per thread) and strictly
ordered: you cannot keep a frame around after its function returns.

**Heap:** memory you allocate explicitly, which lives until it's freed (in C) or
garbage-collected (in JavaScript). Slower to allocate, but it can outlive the
function that created it, and it can be large.

**Why you need this distinction:** §47 says an `await`ed function "suspends onto
the heap and its stack frame unwinds." That sentence is the entire reason Node
can hold 80 requests at once — the paused functions are *heap objects*, not
parked stacks. Eighty stack frames waiting around would be expensive; eighty
small heap objects are nearly free.

<a id="0-4"></a>
## 0.4 Threads

A **thread** is one flow of execution through your code. It is what the operating
system schedules onto a core.

A thread owns exactly two things: **its own stack**, and **its own instruction
pointer**. Everything else — the heap, the code, open files — is shared with the
other threads in the same process.

```
   PROCESS  (one private memory space)
   ┌────────────────────────────────────────────────────┐
   │   CODE  +  HEAP        ← SHARED by all threads     │
   │                          (this is where the danger │
   │                           in §0.9 comes from)      │
   │                                                    │
   │   ┌──────────┐   ┌──────────┐   ┌──────────┐       │
   │   │ thread 1 │   │ thread 2 │   │ thread 3 │       │
   │   │  stack   │   │  stack   │   │  stack   │  ← private
   │   │   IP     │   │   IP     │   │   IP     │  ← private
   │   └──────────┘   └──────────┘   └──────────┘       │
   └────────────────────────────────────────────────────┘
```

**Context switch** — when the OS moves a core from thread A to thread B, it saves
A's registers and instruction pointer, then loads B's. It costs on the order of a
microsecond. That sounds tiny, and it is — until you have ten thousand threads,
at which point the machine spends a serious fraction of its time switching rather
than working.

**Two threads in the same process can genuinely run at the same instant**, on
different cores, both touching the same heap. That's the power and the hazard.

**Two separate processes cannot touch each other's memory at all** — which is
exactly the situation of two Cloud Run instances. Remember this: it's why the
rate-limit bug in §0.9 can't be fixed with a normal lock.

<a id="0-5"></a>
## 0.5 The kernel, and why you can't touch the network card

The **kernel** is the core of the operating system. It's the only code allowed to
talk to hardware directly, decide which thread runs on which core, and hand out
memory.

Your program runs in **user space** and cannot do those things. When it needs
one, it makes a **system call** (**syscall**) — a controlled transition into the
kernel. `read`, `write`, and opening a network connection are all syscalls.

```
   ┌────────────────────────────────────────┐
   │  YOUR PROGRAM        (user space)      │
   │  "please read from socket 7"           │
   │            │                           │
   │            │  syscall  ← the only door  │
   │            ▼                           │
   ├────────────────────────────────────────┤
   │  KERNEL              (kernel space)    │
   │  owns: CPU scheduling, memory,         │
   │        network cards, disks            │
   ├────────────────────────────────────────┤
   │  HARDWARE                              │
   └────────────────────────────────────────┘
```

A **socket** is the kernel's handle for one network connection. A **file
descriptor** is just an integer your program uses to name one — socket 7, socket
8. When §47 says "tell me when file descriptor 7 is readable," that's this.

Why it matters: **your program never waits for the network itself. It asks the
kernel to wait.** What differs between the two models below is only *what your
thread does while the kernel waits.*

<a id="0-6"></a>
## 0.6 Blocking vs non-blocking

Two ways to ask the kernel for data that hasn't arrived yet.

**Blocking:** "give me the data, and don't come back until you have it." The
kernel takes your thread off the core entirely and marks it not-runnable. Your
thread does nothing — it isn't even scheduled — until the data arrives.

**Non-blocking:** "give me the data if it's ready this instant, otherwise tell me
'not ready' immediately." Your thread keeps running either way.

```
  BLOCKING  — one thread, one request
  thread: [ 2ms work ]▓▓▓▓▓▓▓ parked 30ms ▓▓▓▓▓▓▓[ 1ms ]
                      └── thread is off the CPU, achieving nothing


  NON-BLOCKING — one thread, three requests
  thread: [r1 2ms][r2 2ms][r3 2ms]……[r1 resumes][r2 resumes][r3 …]
                                  ↑
          all three 30ms waits are happening inside the kernel,
          overlapping each other, while the thread stays busy
```

Blocking isn't *bad* — it's simple, and if you have one thread per request it
works fine. It only becomes a problem when one thread is serving many requests,
because then parking that thread parks everybody.

**`epoll`** is the syscall that makes non-blocking practical at scale. Checking a
thousand sockets one at a time would be a thousand syscalls. `epoll` is a single
call meaning *"here are a thousand descriptors — tell me which ones are ready,
and if none are, sleep until at least one is."* (`kqueue` on macOS, IOCP on
Windows — same idea.) This is the machinery underneath Node, nginx, and every
other high-connection server.

<a id="0-7"></a>
## 0.7 Concurrency vs parallelism

The single most confused pair of words in this whole area, and the difference is
genuinely simple:

- **Concurrency** — several tasks are *in progress* during the same period. They
  take turns. This is about how the program is **structured**.
- **Parallelism** — several tasks are *executing at the same instant*. This
  requires more than one core. This is about how it **runs**.

```
  CONCURRENCY — 1 core, 2 tasks
  core:   [A][B][A][B][A][B][A][B]
          └──────── time ────────►
          both tasks are "in progress"; never simultaneous


  PARALLELISM — 2 cores, 2 tasks
  core 1: [A][A][A][A][A][A][A][A]
  core 2: [B][B][B][B][B][B][B][B]
          └──────── time ────────►
          genuinely at the same instant
```

The full picture:

|  | **One thread** | **Multiple threads** |
|---|---|---|
| **One core** | Concurrency only — the event loop takes turns | Concurrency only — the OS takes turns |
| **Multiple cores** | Concurrency only — one thread uses one core | **Parallelism possible** |

Two cells people get wrong. **Bottom-left:** Node on a 16-core machine still runs
your JavaScript on one core; the other 15 do nothing for it. **Top-right:** two
threads on a single core are *not* parallel — they interleave, exactly like an
event loop, just with the OS choosing the switch points.

So: **threads make parallelism possible; cores make it actual; concurrency needs
neither.**

<a id="0-8"></a>
## 0.8 Two ways to serve many users at once

This is the design choice that explains why Node behaves the way it does.

```
  MODEL 1 — THREAD PER REQUEST        (Apache, classic Java/Spring)

    request 1 ──► thread 1  [work]▓▓ blocked on DB ▓▓[work] ──► response
    request 2 ──► thread 2  [work]▓▓ blocked on DB ▓▓[work] ──► response
    request 3 ──► thread 3  [work]▓▓ blocked on DB ▓▓[work] ──► response

    ✓ code reads top-to-bottom; blocking is fine, it only blocks one request
    ✓ uses many cores automatically
    ✗ every thread reserves stack space
    ✗ 10,000 threads = the OS spends its time context-switching
      (this has a name: the "C10K problem")


  MODEL 2 — EVENT LOOP                (Node, nginx, Redis)

    request 1 ┐
    request 2 ┼──► ONE thread ──► [r1][r2][r3][r1][r3][r2] ──► responses
    request 3 ┘                    └ switches at every await ┘

    ✓ a paused request is a small heap object, not a parked thread
    ✓ tens of thousands of connections on one thread
    ✗ ONE slow CPU-bound function freezes every other request
    ✗ one thread uses one core — parallelism needs more processes
```

The **event loop** itself is not mysterious. It is a loop, written in C, running
on that single thread:

```
  while (there is outstanding work) {

      run any timer callbacks that are now due;

      ask the kernel (epoll) which I/O finished;   ← sleeps here if idle
      for each finished one:
          run the JavaScript callback waiting on it;   ← YOUR CODE RUNS HERE

      run any close/cleanup callbacks;
  }
```

Two consequences fall straight out of that shape:

1. **Your JavaScript runs in bursts, and each burst runs to completion.** The
   loop cannot interrupt your function partway through. Nothing else can slip in
   between two of your lines. This is what makes single-threaded JS safe to write
   without locks.
2. **If one burst takes 250 ms, the loop is stuck for 250 ms.** Completed
   database results for every other request sit in kernel buffers, unread. That
   is what "blocking the event loop" means, and it's the failure §33 warns about.

<a id="0-9"></a>
## 0.9 Race conditions and atomicity

A **race condition** is when two things happening at once interleave on shared
data and produce a result neither would produce alone.

The shape to memorise is **read-modify-write**. In your source it's one line:

```js
tokens = tokens - 1;
```

The machine sees three separate steps:

```
   LOAD   tokens → register     (read)
   SUB    register, 1           (modify)
   STORE  register → tokens     (write)
```

Anything can happen between those steps. Here is the bug from the DeepCS rate
limiter:

```
   starting value: tokens = 1        (only ONE request should be allowed)

   Gateway instance A            Gateway instance B
   ──────────────────            ──────────────────
   LOAD  tokens → 1
                                 LOAD  tokens → 1     ← reads before A writes
   SUB               → 0
   STORE tokens = 0
                                 SUB               → 0
                                 STORE tokens = 0     ← A's write silently lost

   final: tokens = 0, but TWO requests were allowed through
```

This is called a **lost update**. Note carefully: **no threads were involved.**
Those are two separate Cloud Run instances — two processes, on two machines, with
no shared memory. That's why the usual fix doesn't apply.

**Atomic** means an operation that cannot be observed half-finished and cannot be
interleaved. It either has happened or it hasn't.

Three ways to get it, and which one applies where:

| Tool | How it works | Works across… |
|---|---|---|
| **Mutex / lock** (a flag one thread holds at a time) | other threads wait their turn | threads in **one process** |
| **Atomic CPU instruction** (e.g. compare-and-swap) | hardware guarantees indivisibility | threads in one process |
| **Atomic operation in a shared external store** | Redis executes one command at a time, and a Lua script start-to-finish | **separate machines** ← DeepCS needs this |

A mutex in the Gateway's memory would be useless: instance B has its own memory
and would never see instance A's lock. The shared state lives in Redis, so the
atomicity has to live in Redis too. **That's the entire reason for the Lua
script.**

<a id="0-10"></a>
## 0.10 Little's Law — the formula behind `--concurrency`

One formula, and it makes `--concurrency=80` stop being arbitrary:

```
      L        =        λ        ×        W

  average number      arrival rate      average time
  of requests    =    (requests     ×   each one spends
  in flight            per second)      in the system
```

For DeepCS: if 100 requests/second arrive and each takes 32 ms end-to-end:

```
   L = 100 × 0.032 = 3.2 requests in flight on average
```

So `--concurrency=80` isn't a guess about traffic — it's headroom of roughly 25×
over that average, sized for bursts. And it works on one thread because of §0.1:
of those 32 ms, only ~2 ms needs the CPU.

The same formula tells you when the model breaks. If `W` jumps — a slow query, a
CPU-bound function — then `L` rises for the *same* traffic, and you hit the
concurrency ceiling without any increase in load. **Latency problems become
capacity problems.** That's worth being able to say out loud.

<a id="0-11"></a>
## 0.11 Percentiles

With concurrency, an average actively misleads you.

```
   100 requests, sorted by duration:

     10ms  ████████████████████████████████████████████  95 requests
   2000ms  ██                                             5 requests

   average = 110 ms   ← NOT ONE REQUEST took anywhere near this
   p50     = 10 ms    ← the median: half were faster
   p95     = 10 ms    ← 95% were at least this fast
   p99     = 2000 ms  ← 1 user in 100 waited two seconds
```

**pN means: N% of requests were faster than this number.** The average sits
between the fast group and the slow group, describing neither.

Report **p95 and p99**, because the tail is what users actually feel, and the
tail is where contention, queueing, cold starts and garbage collection show up
first. A rising p99 with a flat p50 is the classic early warning that something
is starting to queue.

<a id="0-12"></a>
## 0.12 Containers, and what a Cloud Run "instance" is

A **container** is not a small computer. It is an ordinary process, isolated by
two kernel features:

- **Namespaces** control *what it can see* — its own view of the filesystem,
  process list, and network. It cannot see the host's other processes.
- **cgroups** (control groups) control *what it can use* — a cap on CPU and
  memory.

```
   VIRTUAL MACHINE — emulates a whole computer
   ┌───────────┐ ┌───────────┐      heavy: GBs, boots in ~minutes,
   │  your app │ │  your app │      each has its own full kernel
   │  full OS  │ │  full OS  │
   └───────────┘ └───────────┘
         hypervisor
         hardware

   CONTAINER — just a process the kernel is fencing in
   ┌───────────┐ ┌───────────┐      light: MBs, starts in ~ms–seconds,
   │  your app │ │  your app │      no kernel of its own
   └───────────┘ └───────────┘
      SHARED host kernel  ← namespaces + cgroups do the isolating
      hardware
```

So, precisely: **one Cloud Run instance = one running container = one Node
process = one main thread running your JavaScript.**

That chain is what ties this whole section to §33. `--max-instances=2` means at
most two of those processes exist. `--concurrency=80` means each one holds up to
80 requests in flight on its single JS thread. And **because they are separate
processes, they share no memory** — which is §0.9 again, and the reason the rate
limiter must live in Redis.

A **cold start** is this chain being built from nothing: pull image → start
container → boot Node → open DB pool → ready. Roughly a second or two, and it's
the price of `--min-instances=0`.

<a id="0-13"></a>
## 0.13 Carry these into 33 / 37 / 47

Ten sentences. If these are solid, the three sections are mostly consequences.

1. A CPU can execute ~100 million instructions in the time one Postgres query
   takes. Everything here is about not wasting that.
2. One core runs one instruction stream at a time.
3. A process has private memory; a thread is a flow of execution with its own
   stack and instruction pointer, sharing the heap with its siblings.
4. Only the kernel touches hardware; you ask it via syscalls.
5. Blocking parks your thread; non-blocking returns immediately and `epoll` lets
   one thread watch thousands of connections.
6. Concurrency is taking turns; parallelism is genuinely simultaneous and needs
   multiple cores.
7. Node = one thread + an event loop; your JS runs in uninterruptible bursts, so
   a 250 ms CPU burst freezes every other request.
8. Read-modify-write races lose updates; atomicity must live wherever the shared
   state lives — Redis, for separate machines.
9. `L = λW`: in-flight requests = arrival rate × time each spends. Latency
   problems become capacity problems.
10. One Cloud Run instance = one container = one process = one JS thread, sharing
    memory with nothing.

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

<a id="47"></a>
## 47. "one thread runs your JS and an event loop drives it" — what does that actually mean, does Node really have one thread, and does multiple threads mean parallelism?

Four questions. Taking them in the order that makes each one answerable.

### First, what a thread actually is

A **thread** is the unit the operating system schedules onto a CPU core. It carries two things: a **call stack** (which functions are currently part-way through, and their local variables) and an **instruction pointer** (which machine instruction is next). The OS decides which threads sit on which cores, and it can pause one mid-instruction-stream to run another — that's a **context switch**.

A **process** is a running program with its own isolated memory. A process contains one or more threads, and threads inside the same process **share that memory** — which is precisely why multi-threaded code is dangerous: two threads can touch the same variable at genuinely the same instant.

One core executes instructions from exactly one thread at a time. That single fact is what the rest of this rests on.

### "One thread runs your JavaScript"

When you start Node, the OS creates a process. Inside it, one thread — the **main thread** — executes your JavaScript. Every line of JS you write runs on it, one line at a time. **Two of your functions can never be executing simultaneously.** Not "rarely", not "usually not" — the runtime provides no way for it to happen.

That's why `tokens = tokens - 1` inside one Node process is safe from the lost-update race in §37, and why the same operation across two Cloud Run *instances* is not. Different processes, different machines, no shared memory, genuinely simultaneous.

Note the exact claim: **one thread runs your JS.** Not "Node has one thread". Those are different statements, and the second one is false — see below.

### What the event loop is

It's a loop. Written in C, inside a library Node uses called **libuv**, running on that same main thread. Stripped to its skeleton:

```
while (there is still work outstanding) {
    run any timer callbacks whose time has come      // setTimeout, setInterval
    ask the OS which pending I/O operations finished  // <- the loop waits here
    run the callback for each finished operation      // <- YOUR JS RUNS HERE
    run setImmediate callbacks
    run close callbacks (e.g. 'socket closed')
}
```

Each named step is a **phase**, and the loop visits them in that fixed order, over and over. (Node's real loop has a couple of extra internal phases; I'm trimming those because they never change how you reason about your own code.)

So "the event loop drives your JS" means: **your JavaScript does not run continuously.** It runs in bursts. Each burst starts because the loop pulled a finished event off a queue and called the callback attached to it. Your callback runs **to completion** — the loop cannot interrupt it — then returns, and the loop moves on.

Run-to-completion is the property that makes single-threaded JS safe to write. Nothing can interleave inside your function body, so `tokens = tokens - 1` can't be split in half by something else.

### What actually happens on `await db.query(...)`

This is the part that's usually hand-waved, and hand-waving it leaves you unable to predict behaviour. The concrete sequence, on Linux:

1. Your JS calls into Node's C++ layer, which writes the query to an already-open TCP socket. The socket is in **non-blocking mode**, so the write returns immediately rather than waiting for Postgres.
2. Node registers interest with the kernel: *"tell me when file descriptor 7 has data to read."* On Linux the mechanism is **`epoll`** (`kqueue` on macOS, IOCP on Windows).
3. Your `async` function **suspends**. Its local variables and its resume position are saved into a heap-allocated object, and the call stack unwinds — the function is no longer on the stack at all. Control returns to the event loop.
4. The loop carries on. Other callbacks run. Other requests progress.
5. When the loop reaches its polling phase it calls **`epoll_wait`** — a syscall meaning *"which of these hundreds of descriptors are ready? if none, sleep until one is."*
6. The kernel returns "descriptor 7 is readable". Node reads the bytes, parses the result, and **resolves the promise** your function was waiting on.
7. Resolving the promise queues your function's continuation as a **microtask**, which runs the instant the current callback finishes — before the loop advances to the next phase. Your function resumes at the line after the `await`, with its locals restored.

**Two things worth extracting from that.**

The loop *does* block — in step 5, inside `epoll_wait`. That's fine, because it's blocking on "*anything at all* becoming ready", not on one specific query. It sleeps only when there is genuinely nothing to do.

And `await` creates no thread. It means: *suspend this function, hand control back to the loop, resume when this promise settles.* Because a suspended function lives on the heap and not on the stack, you can have 80 of them suspended at once without 80 call stacks — which is exactly what makes `--concurrency=80` (§33) cheap.

### The scenario this predicts — and the failure

Your Core instance, `--concurrency=80`. A request costs ~2 ms of CPU (parse, route, serialise) and ~30 ms waiting on Postgres.

Working case: request 1 uses 2 ms of the thread, hits `await`, suspends. The loop immediately starts request 2. By the time request 1's rows come back, requests 2–80 have all had their 2 ms. The thread is busy roughly 160 ms total while 2,400 ms of waiting happens in the kernel, overlapped. One thread, 80 requests in flight, no parallelism anywhere.

**Failure case:** one request calls a pure-JavaScript password hash costing 250 ms of CPU. There is no `await` inside it that yields — it's a tight computation loop. For 250 ms the event loop **cannot reach step 5**. Postgres results for the other 79 requests arrive in kernel buffers and sit there unread. Every one of those requests stalls, not because they're slow but because nothing is available to process their completions. Your p95 latency spikes across the board, and `/health/ready` can't answer either — long enough and Cloud Run declares the instance unhealthy.

**The fix** is never "make it faster"; it's *get it off the main thread* — a native addon that runs it on the thread pool, a `worker_thread`, or moving the work out of the request path entirely. In DeepCS this became moot: hashing now happens inside Firebase (ADR-04), so no CPU-bound work sits on Core's request path at all.

### Does Node really have only one thread? No.

A Node process is genuinely multi-threaded. What's single is *your JavaScript*.

| Thread(s) | Count | What runs there |
|---|---|---|
| **Main thread** | 1 | All your JS, plus the event loop itself |
| **libuv thread pool** | 4 by default (`UV_THREADPOOL_SIZE`) | Work with no good non-blocking OS interface: **file system** calls, **DNS** resolution via `getaddrinfo`, and some **crypto** (`pbkdf2`, `randomBytes`, native `bcrypt`) |
| **V8 internal threads** | several | Garbage collection helpers, background JIT compilation |
| **`worker_threads`** | 0 unless you create them | Separate V8 isolates, each with its **own** event loop |

Two consequences that actually bite.

**Network I/O does not use the thread pool.** Sockets go through `epoll`, which is why one Node process can hold thousands of connections with four pool threads. **File** I/O does use the pool — so 5 concurrent file reads means one queues behind the other four.

**This corrects a compression in §37.** That section says a 250 ms bcrypt "blocks the event loop". True for `bcrypt.hashSync(...)` or the pure-JS `bcryptjs` package. But `await bcrypt.hash(...)` from the *native* `bcrypt` package runs the hash on a **pool thread**, so the event loop keeps serving — at the cost of occupying one of only four pool slots, meaning a fifth concurrent hash waits. The general lesson stands; the specific claim was too broad.

`worker_threads` deserve one line of precision: they do **not** share ordinary variables. Each has its own isolate and heap; they communicate by copying messages or through an explicitly shared `SharedArrayBuffer`. So spawning workers doesn't hand you the classic shared-memory data races — you have to opt into that.

### Does multiple threads mean parallelism? No — it enables it.

**Parallelism needs three things at once:** more than one thread, more than one core, and the OS actually scheduling those threads onto different cores in the same instant. Threads alone give you only the first.

|  | One thread | Multiple threads |
|---|---|---|
| **One core** | Concurrency only — the event loop interleaves at `await` points | Concurrency only — the OS time-slices, switching rapidly between threads |
| **Multiple cores** | Concurrency only — one thread can occupy just one core | **Parallelism possible** — genuinely simultaneous execution |

The cell people miss is bottom-left: Node on a 16-core machine still runs your JS on one core. The other 15 do nothing for your JavaScript. Scaling out means more processes or more instances, which is exactly what `--max-instances` governs — and exactly why the rate-limit bucket needs Redis rather than a variable in memory.

Top-right is the other easy mistake: two threads on a single core are *not* parallel. They interleave, same as the event loop, just with the OS choosing the switch points instead of your `await`s.

**The precise definitions**, now that the mechanics justify them:

- **Concurrency** is a property of how a program is *structured*: multiple tasks are in progress over the same period. It is achievable on one core, with one thread.
- **Parallelism** is a property of how it *executes*: instructions from different tasks retire in the same instant. It requires hardware.

Node is the clean proof that these are separable — massively concurrent, not remotely parallel.

### The five sentences worth keeping

1. A thread is what the OS schedules onto a core; one core runs one thread at a time.
2. Node runs all your JS on one thread, so two of your functions never execute simultaneously — but a Node *process* has other threads, and other Cloud Run *instances* are fully separate processes.
3. The event loop is a C loop on that thread that asks the kernel which I/O finished and calls the matching JS callback; your code runs in bursts, each burst uninterruptible.
4. `await` suspends a function to the heap and returns control to the loop; it starts no thread and costs no stack.
5. Threads make parallelism *possible*; cores make it *actual*; concurrency needs neither.
